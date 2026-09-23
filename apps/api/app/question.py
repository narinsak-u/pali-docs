from __future__ import annotations

import asyncio
import json
import os
import secrets
from collections.abc import AsyncIterator
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from .agent.runner import LangGraphAgentRunner, create_langgraph_agent_turn_runner
from .agent.types import AgentEvent, AgentTurnInput
from .config import Settings, get_settings

router = APIRouter()

MAX_MESSAGES = 20
MAX_MESSAGE_CONTENT = 20_000
MAX_TOTAL_CONTENT = 20_000


class QuestionMessage(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CONTENT)

    @field_validator("content")
    @classmethod
    def require_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("message content must not be blank")
        return value


class QuestionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str | None = Field(default=None, min_length=1, max_length=200, alias="runId")
    thread_id: str | None = Field(default=None, min_length=1, max_length=200, alias="threadId")
    corpus_revision: str | None = Field(
        default=None, min_length=1, max_length=200, alias="corpusRevision"
    )
    messages: list[QuestionMessage] = Field(min_length=1, max_length=MAX_MESSAGES)

    @model_validator(mode="after")
    def validate_messages(self) -> QuestionRequest:
        total_content = sum(len(message.content) for message in self.messages)
        if total_content > MAX_TOTAL_CONTENT:
            raise ValueError("message content is too large")
        if self.messages[-1].role != "user":
            raise ValueError("the final message must be user content")
        return self



async def request_validation_error_handler(
    _request: Request, _exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"error": "invalid_request", "message": "Invalid request"},
    )


def _internal_error(status_code: int, error: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"error": error, "message": message})


def _configured_token() -> str | None:
    token = os.environ.get("INTERNAL_API_TOKEN")
    return token if token and token.strip() else None


def _authorize(authorization: str | None, expected: str | None) -> None:
    if expected is None:
        raise _internal_error(503, "service_unavailable", "Question service unavailable")
    if authorization is None or not authorization.startswith("Bearer "):
        raise _internal_error(401, "unauthorized", "Authentication required")
    supplied = authorization.removeprefix("Bearer ")
    if not supplied or not secrets.compare_digest(supplied, expected):
        raise _internal_error(403, "forbidden", "Authentication failed")


async def http_exception_handler(
    _request: Request, exc: HTTPException
) -> JSONResponse:
    if isinstance(exc.detail, dict):
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": "request_failed", "message": str(exc.detail)},
    )


def _sse(event: AgentEvent) -> bytes:
    return f"data: {json.dumps(event.as_dict(), separators=(',', ':'))}\n\n".encode(
        "utf-8"
    )


async def _cancel_on_disconnect(request: Request, cancellation: asyncio.Event) -> None:
    try:
        while not cancellation.is_set():
            if await request.is_disconnected():
                cancellation.set()
                return
            await asyncio.sleep(0.1)
    except asyncio.CancelledError:
        raise
    except Exception:
        cancellation.set()


async def _event_stream(
    request: Request,
    runner: LangGraphAgentRunner,
    turn: AgentTurnInput,
) -> AsyncIterator[bytes]:
    queue: asyncio.Queue[AgentEvent | None] = asyncio.Queue()
    cancellation = asyncio.Event()

    async def emit(event: AgentEvent) -> None:
        await queue.put(event)

    async def run() -> None:
        try:
            await runner.run_turn(turn, emit, cancellation)
        finally:
            await queue.put(None)

    runner_task = asyncio.create_task(run())
    watcher_task = asyncio.create_task(_cancel_on_disconnect(request, cancellation))
    terminal_seen = False
    try:
        while True:
            event = await queue.get()
            if event is None:
                if not terminal_seen and not cancellation.is_set():
                    raise RuntimeError("runner completed without a terminal event")
                break
            if terminal_seen:
                continue
            yield _sse(event)
            if event.event_type in {"run.completed", "run.failed"}:
                terminal_seen = True
    finally:
        cancellation.set()
        watcher_task.cancel()
        runner_task.cancel()
        await asyncio.gather(watcher_task, runner_task, return_exceptions=True)


@router.post("/v1/question", tags=["question"])
async def question(
    payload: QuestionRequest,
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    _authorize(authorization, _configured_token())

    try:
        settings: Settings = get_settings()
        if (
            payload.corpus_revision is not None
            and payload.corpus_revision != settings.PINECONE_CORPUS_REVISION
        ):
            raise _internal_error(400, "invalid_request", "Invalid request")
        runner = create_langgraph_agent_turn_runner(settings=settings)
    except (ValidationError, ValueError, OSError, RuntimeError):
        raise _internal_error(503, "service_unavailable", "Question service unavailable")

    turn = AgentTurnInput(
        run_id=payload.run_id or str(uuid4()),
        thread_id=payload.thread_id,
        messages=[
            {"role": message.role, "content": message.content}
            for message in payload.messages
        ],
    )
    return StreamingResponse(
        _event_stream(request, runner, turn),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
