from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError
from starlette.requests import Request

from app import question as question_module
from app.agent import runner as runner_module
from app.agent.runner import LangChainModelStages, LangGraphAgentRunner
from app.config import Settings, selected_provider
from app.question import QuestionRequest
from app.agent.types import AgentEvent, AgentMessage, AgentTurnInput
from app.rag.types import Citation, GroundedBundle, GroundingPassage


def _principal_header(tenant: str = "tenant-test") -> tuple[bytes, bytes]:
    now = int(datetime.now(timezone.utc).timestamp())
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
        "LOCAL_LLM_API_KEY": "vllm-key",
        "LOCAL_LLM_MODEL": "Qwen/Qwen3-8B",
        "LOCAL_LLM_TIMEOUT_SECONDS": 45,
        "LOCAL_LLM_MAX_OUTPUT_TOKENS": 768,
        "INTERNAL_PRINCIPAL_SECRET": "identity-secret",
        "PILOT_TENANT_ID": "tenant-test",
        "PILOT_PRINCIPAL_ID": "test-principal",
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
    assert model.extra_body == {"chat_template_kwargs": {"enable_thinking": False}}


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




def test_server_owned_local_switch_selects_hosted_rollback() -> None:
    settings = _settings(
        LOCAL_LLM_ENABLED=False,
        OPENROUTER_API_KEY="hosted-key",
        OPENROUTER_LLM_MODEL="hosted/model",
    )

    assert selected_provider(settings) == "openrouter"
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
        {"type": "http", "method": "POST", "path": "/v1/question", "headers": [_principal_header()]}
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
    assert model.extra_body == {"chat_template_kwargs": {"enable_thinking": False}}


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
        INTERNAL_PRINCIPAL_SECRET="identity-secret",
        PILOT_TENANT_ID="tenant-test",
        PILOT_PRINCIPAL_ID="test-principal",
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
        INTERNAL_PRINCIPAL_SECRET="identity-secret",
        PILOT_TENANT_ID="tenant-test",
        PILOT_PRINCIPAL_ID="test-principal",
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


@pytest.mark.asyncio
async def test_grounded_question_route_runs_local_provider_end_to_end(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    class StructuredCall:
        def __init__(self, schema: type[object]) -> None:
            self.schema = schema

        async def ainvoke(self, messages: object) -> dict[str, object]:
            contents = "\n".join(
                str(getattr(message, "content", "")) for message in messages
            )
            calls.append({"schema": self.schema.__name__, "contents": contents})
            if self.schema.__name__ == "RetrievalDecision":
                assert "Explain dependent origination." in contents
                return {"needsRetrieval": True, "query": "dependent origination"}
            if self.schema.__name__ == "GroundedAnswer":
                assert "Explain dependent origination." in contents
                assert 'corpus-revision="corpus-1"' in contents
                assert "Dependent origination passage." in contents
                assert 'Allowed citation IDs: ["p-1"]' in contents
                return {"answer": "Grounded local answer.", "citationIds": ["p-1"]}
            if self.schema.__name__ == "Suggestions":
                assert "Grounded local answer." in contents
                return {"suggestions": ["Ask about dependent origination."]}
            raise AssertionError(f"unexpected schema: {self.schema.__name__}")

    class LocalChat:
        instances: list[LocalChat] = []

        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs
            self.__class__.instances.append(self)

        def with_structured_output(
            self, schema: type[object], **_kwargs: object
        ) -> StructuredCall:
            return StructuredCall(schema)

    class LocalRetriever:
        def __init__(self, settings: object) -> None:
            self.settings = settings
            self.scopes: list[object] = []

        async def retrieve(
            self,
            _query: str,
            _attempt: int,
            access_scope: object = None,
        ) -> GroundedBundle:
            self.scopes.append(access_scope)
            citation = Citation(
                id="p-1",
                source="book-1",
                title="Chapter 1",
                source_version="source-v1",
                section="§1",
            )
            passage = GroundingPassage(
                id="p-1",
                source="book-1",
                title="Chapter 1",
                source_version="source-v1",
                section="§1",
                text="Dependent origination passage.",
                score=0.99,
            )
            return GroundedBundle(
                status="grounded",
                query="dependent origination",
                corpus_revision="corpus-1",
                passages=[passage],
                citations=[citation],
                context='<retrieved-passages corpus-revision="corpus-1">\n'
                "Dependent origination passage.\n</retrieved-passages>",
            )

    settings = _settings()

    async def receive() -> dict[str, str]:
        return {"type": "http.request"}

    monkeypatch.setattr(runner_module, "ChatOpenAI", LocalChat)
    monkeypatch.setattr(runner_module, "PineconeRetriever", LocalRetriever)
    monkeypatch.setattr(question_module, "_authorize", lambda *_args: None)
    monkeypatch.setattr(question_module, "get_settings", lambda: settings)

    async def no_disconnect(_request: Request, _cancellation: object) -> None:
        return None

    monkeypatch.setattr(question_module, "_cancel_on_disconnect", no_disconnect)

    response = await question_module.question(
        QuestionRequest.model_validate(
            {
                "runId": "local-grounded-run",
                "corpusRevision": "corpus-1",
                "messages": [
                    {"role": "user", "content": "Explain dependent origination."}
                ],
            }
        ),
        Request(
            {
                "type": "http",
                "method": "POST",
                "path": "/v1/question",
                "headers": [_principal_header()],
                "receive": receive,
            }
        ),
    )
    body = b"".join([chunk async for chunk in response.body_iterator])
    events = [
        json.loads(line.removeprefix("data: "))
        for line in body.decode().splitlines()
        if line.startswith("data: ")
    ]

    assert response.media_type == "text/event-stream"
    assert [event["eventType"] for event in events] == [
        "run.started",
        "retrieval.started",
        "retrieval.completed",
        "generation.started",
        "answer.completed",
        "citations.completed",
        "suggestions.completed",
        "run.completed",
    ]
    assert events[2]["payload"]["acceptedProvenance"] == [
        {
            "id": "p-1",
            "source": "book-1",
            "sourceVersion": "source-v1",
            "title": "Chapter 1",
            "section": "§1",
        }
    ]
    assert events[4]["payload"]["text"] == "Grounded local answer."
    assert events[5]["payload"]["citations"][0]["id"] == "p-1"
    assert events[-1]["payload"]["outcome"] == "answered"
    assert events[-1]["runId"] == "local-grounded-run"
    assert LocalChat.instances[0].kwargs == {
        "model": "Qwen/Qwen3-8B",
        "api_key": "vllm-key",
        "base_url": "http://vllm.internal:8000/v1",
        "temperature": 0,
        "max_retries": 0,
        "timeout": 45,
        "max_tokens": 768,
        "extra_body": {"chat_template_kwargs": {"enable_thinking": False}},
    }
    assert [call["schema"] for call in calls] == [
        "RetrievalDecision",
        "GroundedAnswer",
        "Suggestions",
    ]
    scoped_retriever = LocalRetriever(settings)
    scoped_runner = runner_module.create_langgraph_agent_turn_runner(
        retriever=scoped_retriever,
        settings=settings,
    )
    scoped_result = await scoped_runner.run_turn(
        AgentTurnInput(
            run_id="scoped-local-run",
            messages=[
                {"role": "user", "content": "Explain dependent origination."}
            ],
            access_scope={"tenant": "tenant-1"},
        )
    )

    assert scoped_result.outcome == "answered"
    assert scoped_retriever.scopes == [{"tenant": "tenant-1"}]
