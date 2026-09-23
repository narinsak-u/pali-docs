from __future__ import annotations

from uuid import UUID, uuid4

import pytest
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
    monkeypatch.setattr(question_module, "get_settings", lambda: object())
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
