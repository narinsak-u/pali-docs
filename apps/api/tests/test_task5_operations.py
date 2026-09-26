from __future__ import annotations

import json
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from app import main as main_module
from app import question as question_module
from app.agent.runner import LangGraphAgentRunner
from app.agent.types import AgentEvent
from app.config import Settings


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
            "headers": [(b"x-request-id", b"req-123")],
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
            {"type": "http", "method": "POST", "path": "/v1/question", "headers": []}
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
