from __future__ import annotations

import base64
import asyncio
import hashlib
import hmac
import json
import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import BaseModel, ValidationError
from starlette.requests import Request

from app import question as question_module
from app.agent.runner import ApplicationToolDispatcher, LangGraphAgentRunner
from app.agent.types import AgentTurnInput, ToolInvocation
from app.config import Settings
from app.rag.retriever import PineconeRetriever
from app.rag.types import GroundedBundle


def _principal_header(tenant: str = "tenant-a") -> tuple[bytes, bytes]:
    now = int(time.time())
    payload = {
        "iss": "pali-docs-bff",
        "aud": "pali-docs-api",
        "sub": "pilot-principal",
        "tenantId": tenant,
        "roles": ["reader"],
        "permissions": ["document:read"],
        "documentIds": ["doc-1"],
        "visibility": "private",
        "iat": now - 1,
        "exp": now + 60,
    }
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    ).rstrip(b"=").decode()
    body = f"v1.{encoded}"
    signature = hmac.new(b"identity-secret", body.encode(), hashlib.sha256).digest()
    return b"x-principal", f"{body}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode()}".encode()


def base_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "PINECONE_API_KEY": "pinecone-key",
        "PINECONE_INDEX_NAME": "pali",
        "PINECONE_CORPUS_REVISION": "corpus-1",
        "PROVIDER_NAME": "local",
        "LOCAL_LLM_BASE_URL": "http://vllm.internal:8000/v1",
        "LOCAL_LLM_API_KEY": "server-key",
        "LOCAL_LLM_MODEL": "Qwen/Qwen3-8B",
        "INTERNAL_PRINCIPAL_SECRET": "identity-secret",
    }
    values.update(overrides)
    return Settings(**values)


def payload() -> question_module.QuestionRequest:
    return question_module.QuestionRequest.model_validate(
        {"messages": [{"role": "user", "content": "Explain dhamma."}]}
    )


@pytest.mark.asyncio
async def test_question_boundary_maps_signed_principal_to_turn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, AgentTurnInput] = {}

    async def event_stream(_request: Request, _runner: object, turn: AgentTurnInput):
        captured["turn"] = turn
        if False:
            yield b""

    monkeypatch.setenv("INTERNAL_PRINCIPAL_SECRET", "identity-secret")
    monkeypatch.setattr(question_module, "_authorize", lambda *_args: None)
    monkeypatch.setattr(
        question_module,
        "get_settings",
        lambda: SimpleNamespace(PILOT_TENANT_ID="tenant-a", PILOT_PRINCIPAL_ID="pilot-principal"),
    )
    monkeypatch.setattr(
        question_module,
        "create_langgraph_agent_turn_runner",
        lambda **_kwargs: object(),
    )
    monkeypatch.setattr(question_module, "_event_stream", event_stream)

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/v1/question",
            "headers": [
                _principal_header(),
                (b"x-access-scope", b'{"tenant":"tenant-b"}'),
            ],
        }
    )
    response = await question_module.question(payload(), request)
    _ = [chunk async for chunk in response.body_iterator]

    assert captured["turn"].access_scope == {
        "tenant": "tenant-a",
        "roles": ["reader"],
        "permissions": ["document:read"],
        "documentIds": ["doc-1"],
        "visibility": "private",
    }


@pytest.mark.asyncio
async def test_question_boundary_rejects_forged_principal_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("INTERNAL_PRINCIPAL_SECRET", "identity-secret")
    monkeypatch.setattr(question_module, "_authorize", lambda *_args: None)
    monkeypatch.setattr(
        question_module,
        "get_settings",
        lambda: SimpleNamespace(PILOT_TENANT_ID="tenant-a", PILOT_PRINCIPAL_ID="pilot-principal"),
    )

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/v1/question",
            "headers": [(b"x-principal", b"v1.invalid.invalid")],
        }
    )
    with pytest.raises(HTTPException) as error:
        await question_module.question(payload(), request)
    assert error.value.status_code == 401


@pytest.mark.parametrize(
    "field,value",
    [
        ("LOCAL_LLM_MODEL", "other/model"),
        ("LOCAL_LLM_MODEL", "   "),
        ("LOCAL_LLM_API_KEY", "   "),
        ("LOCAL_LLM_BASE_URL", "   "),
    ],
)
def test_local_settings_reject_unpinned_or_blank_values(field: str, value: str) -> None:
    with pytest.raises((ValidationError, ValueError)):
        base_settings(**{field: value})


@pytest.mark.asyncio
async def test_retriever_scope_mismatch_cannot_return_private_passage() -> None:
    def query(
        _embedding: list[float],
        _top_k: int,
        _namespace: str,
        _metadata_filter: dict[str, object] | None,
    ) -> dict[str, object]:
        return {
            "matches": [
                {
                    "id": "private",
                    "score": 0.99,
                    "metadata": {
                        "text": "private",
                        "source": "source-1",
                        "sourceVersion": "v1",
                        "title": "Private",
                        "corpusRevision": "corpus-1",
                        "tenant": "tenant-b",
                    },
                }
            ]
        }

    retriever = PineconeRetriever(
        settings=SimpleNamespace(
            PINECONE_CORPUS_REVISION="corpus-1",
            PINECONE_NAMESPACE="pali",
            RAG_CANDIDATE_TOP_K=10,
            RAG_ACCEPTED_TOP_K=8,
            RAG_MIN_SCORE=0,
            RAG_HIERARCHY_EXPANSION=False,
            RAG_RERANKER_ENABLED=False,
            RAG_RERANKER_MAX_CANDIDATES=10,
            RAG_RERANKER_TIMEOUT_MS=100,
            RAG_MAX_PARENT_CONTEXT_CHARS=100,
            RAG_MAX_CONTEXT_CHARS=1000,
        ),
        embedder=lambda _query: [1.0],
        query_fn=query,
    )

    result = await retriever.retrieve("dhamma", 1, {"tenant": "tenant-a"})

    assert result.status == "insufficient-evidence"


class EchoArgs(BaseModel):
    value: str


class ToolStages:
    seen_inputs: list[AgentTurnInput] = []

    async def tool_call(self, _input: AgentTurnInput, _tools: object, *, tool_choice: object):
        return ToolInvocation(callId="call-1", name="echo", arguments={"value": "hello"})

    async def classify(self, input: AgentTurnInput):
        self.seen_inputs.append(input)
        return {"needsRetrieval": False, "query": "greeting"}

    async def direct_answer(self, _input: AgentTurnInput):
        return {"answer": "hello"}

    async def grounded_answer(self, _input: AgentTurnInput, _grounding: object):
        raise AssertionError

    async def repair_citations(self, _input: AgentTurnInput, _grounding: object, _draft: object):
        raise AssertionError

    async def suggestions(self, _input: AgentTurnInput, _answer: str):
        return {"suggestions": []}
    async def rewrite(self, _input: AgentTurnInput, _query: str, _attempt: int):
        return {"query": "greeting"}


@pytest.mark.asyncio
async def test_langgraph_runner_executes_application_tool_and_emits_lifecycle() -> None:
    seen: list[str] = []
    dispatcher = ApplicationToolDispatcher(
        [
            {
                "name": "echo",
                "args_schema": EchoArgs,
                "handler": lambda args: seen.append(args.value) or {"echo": args.value},
                "authorize": lambda turn: turn.access_scope == {"tenant": "tenant-a"},
            }
        ]
    )
    events = []
    runner = LangGraphAgentRunner(
        retriever=object(),
        stages=ToolStages(),
        tools=dispatcher,
        tool_choice="required",
    )

    result = await runner.run_turn(
        AgentTurnInput(
            runId="tool-run",
            messages=[{"role": "user", "content": "echo"}],
            access_scope={"tenant": "tenant-a"},
        ),
        events.append,
    )

    assert result.outcome == "answered", [
        (event.event_type, event.payload) for event in events
    ]
    assert seen == ["hello"]
    assert ToolStages.seen_inputs[0].tool_results[0].result == {"echo": "hello"}
    assert [event.event_type for event in events] == [
        "run.started",
        "tool.started",
        "tool.completed",
        "generation.started",
        "answer.completed",
        "citations.completed",
        "run.completed",
    ]
    assert [events[1].payload, events[2].payload] == [
        {"runId": "tool-run", "toolId": "call-1"},
        {"runId": "tool-run", "toolId": "call-1"},
    ]
@pytest.mark.asyncio
async def test_required_tool_without_dispatcher_fails_closed() -> None:
    events = []
    runner = LangGraphAgentRunner(
        retriever=object(),
        stages=ToolStages(),
        tool_choice="required",
    )

    result = await runner.run_turn(
        AgentTurnInput(
            runId="missing-tool-run",
            messages=[{"role": "user", "content": "echo"}],
        ),
        events.append,
    )

    assert result.outcome == "failed"
    assert [event.event_type for event in events] == [
        "run.started",
        "tool.failed",
        "run.failed",
    ]
    assert events[1].payload == {
        "runId": "missing-tool-run",
        "toolId": "tool-dispatcher",
        "code": "tool_unavailable",
    }


def test_dispatcher_still_rejects_unauthorized_tool_calls() -> None:
    dispatcher = ApplicationToolDispatcher(
        [
            {
                "name": "echo",
                "args_schema": EchoArgs,
                "handler": lambda args: args.value,
                "authorize": lambda _turn: False,
            }
        ]
    )
    with pytest.raises(PermissionError):
        asyncio.run(
            dispatcher.dispatch(
                ToolInvocation(callId="call-1", name="echo", arguments={"value": "x"}),
                AgentTurnInput(runId="run", messages=[{"role": "user", "content": "x"}]),
            )
        )
