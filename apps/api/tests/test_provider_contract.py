from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError
from starlette.requests import Request

from app import question as question_module
from app.agent.runner import LangChainModelStages, LangGraphAgentRunner
from app.agent.types import AgentEvent
from app.config import Settings
from app.question import QuestionRequest


def _settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "PINECONE_API_KEY": "pinecone-key",
        "PINECONE_INDEX_NAME": "pali",
        "PINECONE_CORPUS_REVISION": "corpus-1",
        "PROVIDER_NAME": "local",
        "LOCAL_LLM_BASE_URL": "http://vllm.internal:8000/v1",
        "LOCAL_LLM_API_KEY": "vllm-key",
        "LOCAL_LLM_MODEL": "Qwen/Qwen3-8B",
        "LOCAL_LLM_TIMEOUT_SECONDS": 45,
        "LOCAL_LLM_MAX_OUTPUT_TOKENS": 768,
    }
    values.update(overrides)
    return Settings(**values)


def test_local_settings_validate_the_private_model_contract() -> None:
    settings = _settings()

    assert settings.PROVIDER_NAME == "local"
    assert settings.LOCAL_LLM_BASE_URL == "http://vllm.internal:8000/v1"
    assert settings.LOCAL_LLM_API_KEY == "vllm-key"
    assert settings.LOCAL_LLM_MODEL == "Qwen/Qwen3-8B"
    assert settings.LOCAL_LLM_TIMEOUT_SECONDS == 45
    assert settings.LOCAL_LLM_MAX_OUTPUT_TOKENS == 768


@pytest.mark.parametrize(
    "field,value",
    [
        ("LOCAL_LLM_BASE_URL", "not-a-url"),
        ("LOCAL_LLM_API_KEY", ""),
        ("LOCAL_LLM_MODEL", ""),
        ("LOCAL_LLM_TIMEOUT_SECONDS", 0),
        ("LOCAL_LLM_MAX_OUTPUT_TOKENS", 0),
    ],
)
def test_local_settings_fail_closed_for_invalid_values(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        _settings(**{field: value})


def test_local_provider_uses_the_existing_chat_model_seam() -> None:
    model = LangChainModelStages(settings=_settings())._chat()

    assert model.model_name == "Qwen/Qwen3-8B"
    assert str(model.openai_api_base).rstrip("/") == "http://vllm.internal:8000/v1"
    assert model.openai_api_key.get_secret_value() == "vllm-key"
    assert model.request_timeout == 45
    assert model.max_tokens == 768


def test_hosted_provider_remains_selectable_for_rollback() -> None:
    settings = Settings(
        PINECONE_API_KEY="pinecone-key",
        PINECONE_INDEX_NAME="pali",
        PINECONE_CORPUS_REVISION="corpus-1",
        PROVIDER_NAME="openrouter",
        OPENROUTER_API_KEY="hosted-key",
        OPENROUTER_LLM_MODEL="hosted/model",
    )

    model = LangChainModelStages(settings=settings)._chat()

    assert model.model_name == "hosted/model"
    assert str(model.openai_api_base).rstrip("/") == "https://openrouter.ai/api/v1"
    assert model.openai_api_key.get_secret_value() == "hosted-key"


@pytest.mark.parametrize(
    "endpoint",
    ["http://host:bad/v1", "http://:8000/v1"],
)
def test_local_settings_reject_malformed_endpoint_ports(endpoint: str) -> None:
    with pytest.raises(ValidationError):
        _settings(LOCAL_LLM_BASE_URL=endpoint)


@pytest.mark.parametrize(
    "timeout,max_output_tokens",
    [(301, 768), (45, 32769)],
)
def test_local_model_seam_rejects_values_above_safety_limits(
    timeout: int, max_output_tokens: int
) -> None:
    settings = SimpleNamespace(
        PROVIDER_NAME="local",
        LOCAL_LLM_BASE_URL="http://vllm.internal:8000/v1",
        LOCAL_LLM_API_KEY="vllm-key",
        LOCAL_LLM_MODEL="Qwen/Qwen3-8B",
        LOCAL_LLM_TIMEOUT_SECONDS=timeout,
        LOCAL_LLM_MAX_OUTPUT_TOKENS=max_output_tokens,
    )

    with pytest.raises(ValueError):
        LangChainModelStages(settings=settings)._chat()


def _route_request() -> Request:
    return Request(
        {"type": "http", "method": "POST", "path": "/v1/question", "headers": []}
    )


def _patch_runner(
    monkeypatch: pytest.MonkeyPatch, captured: dict[str, object]
) -> None:
    async def run_turn(
        self: LangGraphAgentRunner,
        turn: object,
        event_sink: object,
        _cancellation: object,
    ) -> None:
        emit = event_sink
        timestamp = datetime.now(timezone.utc)
        await emit(
            AgentEvent(
                run_id=turn.run_id,
                event_id=str(uuid4()),
                sequence=0,
                event_type="run.started",
                timestamp=timestamp,
                payload={"runId": turn.run_id},
            )
        )
        try:
            captured["model"] = self._stage_instance()._chat()
        except Exception:
            await emit(
                AgentEvent(
                    run_id=turn.run_id,
                    event_id=str(uuid4()),
                    sequence=1,
                    event_type="run.failed",
                    timestamp=timestamp,
                    payload={"runId": turn.run_id, "code": "runner_error"},
                )
            )
            return
        await emit(
            AgentEvent(
                run_id=turn.run_id,
                event_id=str(uuid4()),
                sequence=1,
                event_type="run.completed",
                timestamp=timestamp,
                payload={"runId": turn.run_id},
            )
        )

    monkeypatch.setattr(LangGraphAgentRunner, "run_turn", run_turn)


@pytest.mark.asyncio
async def test_question_route_streams_with_local_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings()
    captured: dict[str, object] = {}

    monkeypatch.setattr(question_module, "_authorize", lambda *_args: None)
    monkeypatch.setattr(question_module, "get_settings", lambda: settings)
    _patch_runner(monkeypatch, captured)

    response = await question_module.question(
        QuestionRequest.model_validate(
            {"runId": "local-run", "messages": [{"role": "user", "content": "Hi"}]}
        ),
        _route_request(),
    )
    body = b"".join([chunk async for chunk in response.body_iterator])
    model = captured["model"]

    assert response.media_type == "text/event-stream"
    assert b'"eventType":"run.started"' in body
    assert b'"eventType":"run.completed"' in body
    assert model.model_name == "Qwen/Qwen3-8B"


@pytest.mark.asyncio
async def test_question_route_keeps_hosted_provider_as_rollback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        PINECONE_API_KEY="pinecone-key",
        PINECONE_INDEX_NAME="pali",
        PINECONE_CORPUS_REVISION="corpus-1",
        PROVIDER_NAME="openrouter",
        OPENROUTER_API_KEY="hosted-key",
        OPENROUTER_LLM_MODEL="hosted/model",
    )
    captured: dict[str, object] = {}

    monkeypatch.setattr(question_module, "_authorize", lambda *_args: None)
    monkeypatch.setattr(question_module, "get_settings", lambda: settings)
    _patch_runner(monkeypatch, captured)

    response = await question_module.question(
        QuestionRequest.model_validate(
            {"runId": "hosted-run", "messages": [{"role": "user", "content": "Hi"}]}
        ),
        _route_request(),
    )
    body = b"".join([chunk async for chunk in response.body_iterator])
    model = captured["model"]

    assert response.media_type == "text/event-stream"
    assert b'"eventType":"run.completed"' in body
    assert model.model_name == "hosted/model"


@pytest.mark.asyncio
async def test_question_route_streams_runner_error_for_invalid_local_limits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = SimpleNamespace(
        PROVIDER_NAME="local",
        PINECONE_CORPUS_REVISION="corpus-1",
        LOCAL_LLM_BASE_URL="http://vllm.internal:8000/v1",
        LOCAL_LLM_API_KEY="vllm-key",
        LOCAL_LLM_MODEL="Qwen/Qwen3-8B",
        LOCAL_LLM_TIMEOUT_SECONDS=301,
        LOCAL_LLM_MAX_OUTPUT_TOKENS=768,
    )
    captured: dict[str, object] = {}

    monkeypatch.setattr(question_module, "_authorize", lambda *_args: None)
    monkeypatch.setattr(question_module, "get_settings", lambda: settings)
    _patch_runner(monkeypatch, captured)

    response = await question_module.question(
        QuestionRequest.model_validate(
            {"runId": "invalid-local", "messages": [{"role": "user", "content": "Hi"}]}
        ),
        _route_request(),
    )
    body = b"".join([chunk async for chunk in response.body_iterator])

    assert response.media_type == "text/event-stream"
    assert b'"eventType":"run.failed"' in body
    assert b'"code":"runner_error"' in body
