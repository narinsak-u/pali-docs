from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from starlette.requests import Request

from app.agent.types import AgentTurnInput
from app import question as question_module
from app.question import QuestionRequest


def valid_payload() -> dict[str, object]:
    return {
        "runId": "client-run",
        "threadId": "thread-1",
        "messages": [{"role": "user", "content": "Explain dependent origination."}],
    }

def _principal_token(subject: str = "principal-1", tenant: str = "tenant-1") -> str:
    now = int(time.time())
    payload = json.dumps({
        "iss": "pali-docs-bff", "aud": "pali-docs-api", "sub": subject,
        "tenantId": tenant, "roles": ["admin"], "permissions": ["document:read"],
        "documentIds": ["all"], "visibility": "private",
        "iat": now - 1, "exp": now + 60,
    }, separators=(",", ":")).encode()
    encoded = base64.urlsafe_b64encode(payload).rstrip(b"=").decode()
    signing_input = f"v1.{encoded}"
    signature = hmac.new(b"identity-secret", signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode()}"


def test_question_request_rejects_invalid_final_role() -> None:
    payload = valid_payload()
    payload["messages"] = [{"role": "assistant", "content": "not a user turn"}]

    with pytest.raises(ValidationError):
        QuestionRequest.model_validate(payload)


def test_question_request_rejects_oversized_content() -> None:
    payload = valid_payload()
    payload["messages"] = [{"role": "user", "content": "x" * 20_001}]

    with pytest.raises(ValidationError):
        QuestionRequest.model_validate(payload)

def test_question_request_rejects_oversized_total_content() -> None:
    payload = valid_payload()
    payload["messages"] = [
        {"role": "assistant", "content": "a" * 10_001},
        {"role": "user", "content": "b" * 10_001},
    ]

    with pytest.raises(ValidationError):
        QuestionRequest.model_validate(payload)


def test_question_request_rejects_client_access_scope() -> None:
    payload = valid_payload()
    payload["accessScope"] = {"volume": "1"}

    with pytest.raises(ValidationError):
        QuestionRequest.model_validate(payload)

def test_question_request_accepts_private_corpus_revision() -> None:
    payload = valid_payload()
    payload["corpusRevision"] = "corpus-1"

    assert QuestionRequest.model_validate(payload).corpus_revision == "corpus-1"




@pytest.mark.asyncio
@pytest.mark.parametrize(
    "headers",
    [
        [],
        [(b"x-principal", b"malformed")],
        [(b"x-principal", _principal_token(subject="other").encode())],
    ],
)
async def test_question_endpoint_rejects_missing_malformed_or_mismatched_identity_before_runner(
    monkeypatch: pytest.MonkeyPatch, headers: list[tuple[bytes, bytes]]
) -> None:
    runner_created = False

    def create_runner(**_kwargs: object) -> object:
        nonlocal runner_created
        runner_created = True
        return object()

    monkeypatch.setenv("INTERNAL_PRINCIPAL_SECRET", "identity-secret")
    monkeypatch.setattr(question_module, "_authorize", lambda *_args: None)
    monkeypatch.setattr(
        question_module,
        "get_settings",
        lambda: SimpleNamespace(
            PROVIDER_NAME="openrouter",
            PINECONE_CORPUS_REVISION="corpus-1",
            PILOT_TENANT_ID="tenant-1",
            PILOT_PRINCIPAL_ID="principal-1",
        ),
    )
    monkeypatch.setattr(question_module, "create_langgraph_agent_turn_runner", create_runner)
    http_request = Request(
        {"type": "http", "method": "POST", "path": "/v1/question", "headers": headers}
    )

    with pytest.raises(HTTPException) as error:
        await question_module.question(QuestionRequest.model_validate(valid_payload()), http_request)

    assert error.value.status_code == 401
    assert not runner_created


@pytest.mark.asyncio
async def test_question_endpoint_passes_only_configured_pilot_scope_to_runner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token = _principal_token()

    captured: dict[str, AgentTurnInput] = {}

    async def fake_event_stream(_request: Request, _runner: object, turn: AgentTurnInput):
        captured["turn"] = turn
        if False:
            yield b""
    monkeypatch.setenv("INTERNAL_PRINCIPAL_SECRET", "identity-secret")
    monkeypatch.setattr(question_module, "_authorize", lambda *_args: None)
    monkeypatch.setattr(
        question_module,
        "get_settings",
        lambda: SimpleNamespace(
            PROVIDER_NAME="openrouter",
            PINECONE_CORPUS_REVISION="corpus-1",
            PILOT_TENANT_ID="tenant-1",
            PILOT_PRINCIPAL_ID="principal-1",
        ),
    )
    monkeypatch.setattr(question_module, "create_langgraph_agent_turn_runner", lambda **_kwargs: object())
    monkeypatch.setattr(question_module, "_event_stream", fake_event_stream)
    http_request = Request({
        "type": "http", "method": "POST", "path": "/v1/question",
        "headers": [(b"x-principal", token.encode()), (b"x-access-scope", b'{"tenant":"other"}')],
    })

    response = await question_module.question(
        QuestionRequest.model_validate(valid_payload()), http_request
    )
    _ = [chunk async for chunk in response.body_iterator]

    assert captured["turn"].access_scope == {
        "tenant": "tenant-1",
        "roles": ["admin"],
        "permissions": ["document:read"],
        "documentIds": ["all"],
        "visibility": "private",
    }
@pytest.mark.asyncio
async def test_question_endpoint_rejects_mismatched_corpus_revision_before_runner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner_created = False

    def create_runner(**_kwargs: object) -> object:
        nonlocal runner_created
        runner_created = True
        return object()

    monkeypatch.setenv("INTERNAL_PRINCIPAL_SECRET", "identity-secret")
    monkeypatch.setattr(question_module, "_authorize", lambda *_args: None)
    monkeypatch.setattr(
        question_module,
        "get_settings",
        lambda: SimpleNamespace(
            PINECONE_CORPUS_REVISION="corpus-1",
            INTERNAL_PRINCIPAL_SECRET="identity-secret",
            PILOT_TENANT_ID="tenant-1",
            PILOT_PRINCIPAL_ID="principal-1",
        ),
    )
    monkeypatch.setattr(question_module, "create_langgraph_agent_turn_runner", create_runner)

    payload = valid_payload()
    payload["corpusRevision"] = "corpus-2"
    request = QuestionRequest.model_validate(payload)
    http_request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/v1/question",
            "headers": [(b"x-principal", _principal_token().encode())],
        }
    )

    with pytest.raises(HTTPException) as error:
        await question_module.question(request, http_request)

    assert error.value.status_code == 400
    assert error.value.detail == {"error": "invalid_request", "message": "Invalid request"}
    assert not runner_created


def test_question_request_rejects_malformed_roles() -> None:
    payload = valid_payload()
    payload["messages"] = [{"role": "moderator", "content": "invalid role"}]

    with pytest.raises(ValidationError):
        QuestionRequest.model_validate(payload)


@pytest.mark.asyncio
async def test_question_endpoint_maps_bounded_request_to_runner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, AgentTurnInput] = {}

    async def fake_event_stream(
        _request: Request, _runner: object, turn: AgentTurnInput
    ):
        captured["turn"] = turn
        if False:
            yield b""

    monkeypatch.setattr(question_module, "_authorize", lambda *_args: None)
    monkeypatch.setattr(question_module, "_authenticated_access_scope", lambda *_args: {"tenant": "tenant-test"})
    monkeypatch.setattr(question_module, "get_settings", lambda: object())
    monkeypatch.setattr(
        question_module,
        "create_langgraph_agent_turn_runner",
        lambda **_kwargs: object(),
    )
    monkeypatch.setattr(question_module, "_event_stream", fake_event_stream)

    request = QuestionRequest.model_validate(valid_payload())
    http_request = Request(
        {"type": "http", "method": "POST", "path": "/v1/question", "headers": []}
    )

    response = await question_module.question(request, http_request)
    _ = [chunk async for chunk in response.body_iterator]

    mapped = captured["turn"]
    assert mapped.run_id == "client-run"
    assert mapped.thread_id == "thread-1"
    assert mapped.messages[-1].role == "user"
    assert mapped.messages[-1].content == "Explain dependent origination."

@pytest.mark.asyncio
async def test_question_endpoint_generates_run_id_for_valid_request(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, AgentTurnInput] = {}

    async def fake_event_stream(
        _request: Request, _runner: object, turn: AgentTurnInput
    ):
        captured["turn"] = turn
        if False:
            yield b""

    monkeypatch.setattr(question_module, "_authorize", lambda *_args: None)
    monkeypatch.setattr(
        question_module,
        "get_settings",
        lambda: SimpleNamespace(PROVIDER_NAME="openrouter"),
    )
    monkeypatch.setattr(question_module, "_authenticated_access_scope", lambda *_args: {"tenant": "tenant-test"})
    monkeypatch.setattr(
        question_module,
        "create_langgraph_agent_turn_runner",
        lambda **_kwargs: object(),
    )
    monkeypatch.setattr(question_module, "_event_stream", fake_event_stream)

    request = QuestionRequest.model_validate({"messages": [{"role": "user", "content": "Hi"}]})
    http_request = Request(
        {"type": "http", "method": "POST", "path": "/v1/question", "headers": []}
    )

    response = await question_module.question(request, http_request)
    _ = [chunk async for chunk in response.body_iterator]

    generated = captured["turn"]
    assert UUID(generated.run_id).version == 4
    assert generated.messages[-1].role == "user"
    assert generated.messages[-1].content == "Hi"
