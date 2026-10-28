from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from app import main as main_module
from app import question as question_module
from app.agent.runner import LangGraphAgentRunner
from app.vllm_profile import VllmReadinessError
from app.agent.types import AgentEvent
from app.config import Settings


def _principal_header(tenant: str = "tenant-test") -> tuple[bytes, bytes]:
    now = int(time.time())
    payload = {
        "iss": "pali-docs-bff",
        "aud": "pali-docs-api",
        "sub": "test-principal",
        "tenantId": tenant,
        "iat": now - 1,
        "exp": now + 60,
    }
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    ).rstrip(b"=").decode()
    body = f"v1.{encoded}"
    signature = hmac.new(b"identity-secret", body.encode(), hashlib.sha256).digest()
    return b"x-principal", f"{body}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode()}".encode()


def _settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "PINECONE_API_KEY": "pinecone-key",
        "PINECONE_INDEX_NAME": "pali",
        "PINECONE_CORPUS_REVISION": "corpus-1",
        "PROVIDER_NAME": "local",
        "LOCAL_LLM_BASE_URL": "http://vllm.internal:8000/v1",
        "LOCAL_LLM_API_KEY": "server-only-key",
        "LOCAL_LLM_MODEL": "Qwen/Qwen3-8B",
        "LOCAL_LLM_TIMEOUT_SECONDS": 1,
        "LOCAL_LLM_MAX_OUTPUT_TOKENS": 768,
        "INTERNAL_API_TOKEN": "internal-token",
        "INTERNAL_PRINCIPAL_SECRET": "identity-secret",
        "PILOT_TENANT_ID": "tenant-test",
        "PILOT_PRINCIPAL_ID": "test-principal",
    }
    values.update(overrides)
    return Settings(**values)


@pytest.mark.asyncio
async def test_readiness_is_explicit_and_fails_closed_when_local_vllm_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings()
    monkeypatch.setattr(main_module, "get_settings", lambda: settings)
    monkeypatch.setattr(
        main_module,
        "check_vllm_readiness",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("offline")),
    )
    transport = httpx.ASGITransport(app=main_module.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        liveness = await client.get("/healthz")
        readiness = await client.get("/readyz")
    assert liveness.status_code == 200
    assert liveness.json() == {"status": "ok", "service": "api"}
    assert readiness.status_code == 503
    assert readiness.json() == {"status": "not_ready", "service": "api"}


@pytest.mark.asyncio
async def test_readiness_distinguishes_model_loading_from_application_liveness(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings()
    monkeypatch.setattr(main_module, "get_settings", lambda: settings)
    monkeypatch.setattr(
        main_module,
        "check_vllm_readiness",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            VllmReadinessError("loading", state="model_loading")
        ),
    )
    transport = httpx.ASGITransport(app=main_module.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        liveness = await client.get("/healthz")
        readiness = await client.get("/readyz")

    assert liveness.json() == {"status": "ok", "service": "api"}
    assert readiness.status_code == 503
    assert readiness.json() == {
        "status": "loading",
        "service": "api",
        "reason": "model_loading",
    }


@pytest.mark.asyncio
async def test_internal_readiness_requires_bearer_and_returns_pinned_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings()
    monkeypatch.setenv("INTERNAL_API_TOKEN", "internal-token")
    monkeypatch.setattr(main_module, "get_settings", lambda: settings)
    monkeypatch.setattr(main_module, "check_vllm_readiness", lambda *args, **kwargs: "Qwen/Qwen3-8B")
    transport = httpx.ASGITransport(app=main_module.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        denied = await client.get("/internal/readyz")
        allowed = await client.get(
            "/internal/readyz", headers={"Authorization": "Bearer internal-token"}
        )
    assert denied.status_code == 401
    assert allowed.status_code == 200
    assert allowed.json() == {
        "status": "ready",
        "service": "api",
        "model": "Qwen/Qwen3-8B",
        "servingRevision": "b968826d9c46dd6066d109eabc6255188de91218",
        "imageDigest": "vllm/vllm-openai@sha256:df2c55e5107afea09ea1a50f9dd96c99ebf97a795334c4d08f691f3d79b2ab12",
        "tokenizer": "Qwen/Qwen3-8B",
        "tokenizerRevision": "b968826d9c46dd6066d109eabc6255188de91218",
        "parser": "hermes",
        "chatTemplate": "qwen3-pinned",
        "precision": "bfloat16",
        "servingLimits": {
            "maxModelLen": 8192,
            "maxNumSeqs": 4,
            "maxNumBatchedTokens": 8192,
            "gpuMemoryUtilization": 0.9,
            "maxOutputTokens": 768,
        },
    }


@pytest.mark.asyncio
async def test_metrics_requires_internal_bearer_and_contains_only_operational_labels(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("INTERNAL_API_TOKEN", "internal-token")
    transport = httpx.ASGITransport(app=main_module.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        denied = await client.get("/metrics")
        allowed = await client.get(
            "/metrics", headers={"Authorization": "Bearer internal-token"}
        )
    assert denied.status_code == 401
    assert allowed.status_code == 200
    body = allowed.text
    assert "vllm_requests_total" in body
    assert "server-only-key" not in body
    assert "Explain dependent origination" not in body
    assert "# HELP" in body


@pytest.mark.asyncio
async def test_question_response_correlates_request_and_run_without_exposing_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings()
    monkeypatch.setattr(question_module, "_authorize", lambda *_args: None)
    monkeypatch.setattr(question_module, "get_settings", lambda: settings)

    async def run_turn(
        self: LangGraphAgentRunner,
        turn: object,
        event_sink: object,
        _cancellation: object,
    ) -> None:
        now = datetime.now(timezone.utc)
        await event_sink(
            AgentEvent(
                run_id=turn.run_id,
                event_id=str(uuid4()),
                sequence=0,
                event_type="run.started",
                timestamp=now,
                payload={"runId": turn.run_id},
            )
        )
        await event_sink(
            AgentEvent(
                run_id=turn.run_id,
                event_id=str(uuid4()),
                sequence=1,
                event_type="run.completed",
                timestamp=now,
                payload={"runId": turn.run_id},
            )
        )

    monkeypatch.setattr(LangGraphAgentRunner, "run_turn", run_turn)
    request = main_module.Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/v1/question",
            "headers": [
                (b"x-request-id", b"req-123"),
                _principal_header(),
            ],
        }
    )
    response = await question_module.question(
        question_module.QuestionRequest.model_validate(
            {
                "runId": "run-123",
                "messages": [{"role": "user", "content": "secret prompt"}],
            }
        ),
        request,
    )
    body = b"".join([chunk async for chunk in response.body_iterator])
    assert response.headers["x-request-id"] == "req-123"
    event = json.loads(body.decode().strip().split("\n\n")[0].removeprefix("data: "))
    assert "requestId" not in event["payload"]
    assert b"secret prompt" not in body


@pytest.mark.asyncio
async def test_question_timeout_allocates_sequence_after_queued_prior_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(LOCAL_LLM_TIMEOUT_SECONDS=0.01)
    monkeypatch.setattr(question_module, "_authorize", lambda *_args: None)
    monkeypatch.setattr(question_module, "get_settings", lambda: settings)

    async def run_turn(
        self: LangGraphAgentRunner,
        turn: object,
        event_sink: object,
        _cancellation: object,
    ) -> None:
        await event_sink(
            AgentEvent(
                run_id=turn.run_id,
                event_id=str(uuid4()),
                sequence=0,
                event_type="run.started",
                timestamp=datetime.now(timezone.utc),
                payload={"runId": turn.run_id},
            )
        )
        await __import__("asyncio").sleep(1)

    monkeypatch.setattr(LangGraphAgentRunner, "run_turn", run_turn)
    monkeypatch.setattr(
        question_module,
        "_cancel_on_disconnect",
        lambda *_args: __import__("asyncio").sleep(100),
    )
    response = await question_module.question(
        question_module.QuestionRequest.model_validate(
            {"runId": "timeout-run", "messages": [{"role": "user", "content": "hello"}]}
        ),
        main_module.Request(
            {
                "type": "http",
                "method": "POST",
                "path": "/v1/question",
                "headers": [_principal_header()],
            }
        ),
    )
    body = b"".join([chunk async for chunk in response.body_iterator])
    events = [
        json.loads(part.removeprefix("data: "))
        for part in body.decode().strip().split("\n\n")
    ]
    assert events[-1]["sequence"] == events[0]["sequence"] + 1
    assert b'"eventType":"run.failed"' in body
    assert b'"code":"timeout"' in body


@pytest.mark.asyncio
@pytest.mark.parametrize("after_stream", [False, True])
async def test_question_stream_emits_terminal_failure_for_unexpected_runner_error(
    monkeypatch: pytest.MonkeyPatch,
    after_stream: bool,
) -> None:
    async def no_disconnect(_request: object, _cancellation: object) -> None:
        return None

    async def run_turn(_turn: object, event_sink: object, _cancellation: object) -> None:
        if after_stream:
            await event_sink(
                AgentEvent(
                    run_id="stream-error-run",
                    event_id=str(uuid4()),
                    sequence=0,
                    event_type="run.started",
                    timestamp=datetime.now(timezone.utc),
                    payload={"runId": "stream-error-run"},
                )
            )
            await event_sink(
                AgentEvent(
                    run_id="stream-error-run",
                    event_id=str(uuid4()),
                    sequence=1,
                    event_type="answer.completed",
                    timestamp=datetime.now(timezone.utc),
                    payload={"runId": "stream-error-run", "text": "partial"},
                )
            )
        raise RuntimeError("unexpected runner failure")

    monkeypatch.setattr(question_module, "_cancel_on_disconnect", no_disconnect)
    request = main_module.Request(
        {"type": "http", "method": "POST", "path": "/v1/question"}
    )
    turn = question_module.AgentTurnInput(
        runId="stream-error-run",
        messages=[{"role": "user", "content": "hello"}],
    )
    body = b"".join(
        [
            chunk
            async for chunk in question_module._event_stream(
                request,
                SimpleNamespace(run_turn=run_turn),
                turn,
            )
        ]
    )
    events = [
        json.loads(part.removeprefix("data: "))
        for part in body.decode().strip().split("\n\n")
    ]

    assert events[-1]["eventType"] == "run.failed"
    assert events[-1]["payload"]["code"] == "runner_error"
    if after_stream:
        assert events[-2]["eventType"] == "answer.completed"


def test_question_request_limits_remain_bounded() -> None:
    with pytest.raises(Exception):
        question_module.QuestionRequest.model_validate(
            {
                "messages": [
                    {"role": "user", "content": str(index)}
                    for index in range(question_module.MAX_MESSAGES + 1)
                ]
            }
        )
    with pytest.raises(Exception):
        question_module.QuestionRequest.model_validate(
            {
                "messages": [
                    {"role": "user", "content": "x"},
                ],
                "unexpected": "nope",
            }
        )


def test_local_rate_limiter_is_bounded_per_tenant() -> None:
    limiter = question_module._SlidingWindowRateLimiter()

    assert limiter.allow("tenant-a", 1, now=100.0)
    assert not limiter.allow("tenant-a", 1, now=101.0)
    assert limiter.allow("tenant-b", 1, now=101.0)
    assert limiter.allow("tenant-a", 1, now=161.0)


@pytest.mark.asyncio
async def test_question_rejects_empty_access_scope_for_local_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(question_module, "_authorize", lambda *_args: None)
    monkeypatch.setattr(question_module, "get_settings", lambda: _settings())
    request = main_module.Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/v1/question",
            "headers": [(b"x-principal", b"v1.invalid.invalid")],
        }
    )
    with pytest.raises(HTTPException) as error:
        await question_module.question(
            question_module.QuestionRequest.model_validate(
                {"messages": [{"role": "user", "content": "hello"}]}
            ),
            request,
        )
    assert error.value.status_code == 401
