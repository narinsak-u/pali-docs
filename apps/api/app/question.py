from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
import threading
from collections import deque
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from time import monotonic
from typing import Annotated, Literal
from uuid import uuid4
from weakref import WeakKeyDictionary

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from .agent.runner import LangGraphAgentRunner, create_langgraph_agent_turn_runner
from .agent.types import AgentEvent, AgentTurnInput
from .config import Settings, get_settings, selected_provider
from .identity import IdentityValidationError, decode_principal_token
from .observability import metrics

router = APIRouter()
MAX_MESSAGES = 20
MAX_MESSAGE_CONTENT = 20_000
MAX_TOTAL_CONTENT = 20_000


class _SlidingWindowRateLimiter:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._windows: dict[str, deque[float]] = {}

    def allow(self, key: str, limit: int, *, now: float | None = None) -> bool:
        current = monotonic() if now is None else now
        cutoff = current - 60
        with self._lock:
            window = self._windows.setdefault(key, deque())
            while window and window[0] <= cutoff:
                window.popleft()
            if len(window) >= limit:
                return False
            window.append(current)
            return True


_LOCAL_RATE_LIMITER = _SlidingWindowRateLimiter()
_LOCAL_ADMISSIONS: WeakKeyDictionary[
    asyncio.AbstractEventLoop, dict[int, asyncio.Semaphore]
] = WeakKeyDictionary()


def _local_admission(limit: int) -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    admissions = _LOCAL_ADMISSIONS.setdefault(loop, {})
    return admissions.setdefault(limit, asyncio.Semaphore(limit))


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
    run_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=200,
        pattern=r"^[A-Za-z0-9._:-]+$",
        alias="runId",
    )
    thread_id: str | None = Field(default=None, min_length=1, max_length=200, alias="threadId")
    corpus_revision: str | None = Field(default=None, min_length=1, max_length=200, alias="corpusRevision")
    messages: list[QuestionMessage] = Field(min_length=1, max_length=MAX_MESSAGES)

    @model_validator(mode="after")
    def validate_messages(self) -> QuestionRequest:
        total_content = sum(len(message.content) for message in self.messages)
        if total_content > MAX_TOTAL_CONTENT:
            raise ValueError("message content is too large")
        if self.messages[-1].role != "user":
            raise ValueError("the final message must be user content")
        return self


async def request_validation_error_handler(_request: Request, _exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": "invalid_request", "message": "Invalid request"})


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


async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    if isinstance(exc.detail, dict):
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"error": "request_failed", "message": str(exc.detail)})


def _request_id(request: Request) -> str:
    supplied = request.headers.get("x-request-id", "")
    if supplied and len(supplied) <= 128 and re.fullmatch(r"[A-Za-z0-9._:-]+", supplied):
        return supplied
    return str(uuid4())

def _configured_principal_secret(settings: object | None = None) -> str | None:
    configured = os.environ.get("INTERNAL_PRINCIPAL_SECRET")
    if configured and configured.strip():
        return configured.strip()
    value = getattr(settings, "INTERNAL_PRINCIPAL_SECRET", None)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _authenticated_access_scope(
    request: Request, settings: object
) -> dict[str, object]:
    raw = request.headers.get("x-principal")
    if raw is None:
        raise _internal_error(401, "unauthorized", "Authentication required")
    secret = _configured_principal_secret(settings)
    expected_tenant = getattr(settings, "PILOT_TENANT_ID", None)
    expected_subject = getattr(settings, "PILOT_PRINCIPAL_ID", None)
    if secret is None or not isinstance(expected_tenant, str) or not expected_tenant.strip() or not isinstance(expected_subject, str) or not expected_subject.strip():
        raise _internal_error(503, "service_unavailable", "Question service unavailable")
    try:
        principal = decode_principal_token(raw, secret)
    except IdentityValidationError as error:
        raise _internal_error(401, "unauthorized", "Authentication required") from error
    if principal.subject != expected_subject.strip() or principal.access.tenant != expected_tenant.strip():
        raise _internal_error(401, "unauthorized", "Authentication required")
    return {"tenant": expected_tenant.strip()}


def _sse(event: AgentEvent) -> bytes:
    return f"data: {json.dumps(event.as_dict(), separators=(',', ':'))}\n\n".encode("utf-8")


def _failure_event(run_id: str, sequence: int, code: str) -> AgentEvent:
    return AgentEvent(
        run_id=run_id,
        event_id=str(uuid4()),
        sequence=sequence,
        event_type="run.failed",
        timestamp=datetime.now(timezone.utc),
        payload={"runId": run_id, "code": code},
    )


def _timeout_event(run_id: str, sequence: int) -> AgentEvent:
    return _failure_event(run_id, sequence, "timeout")


class _TimeoutMarker:
    def __init__(self, run_id: str) -> None:
        self.run_id = run_id


class _RunnerFailureMarker:
    def __init__(self, run_id: str) -> None:
        self.run_id = run_id

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
    *,
    request_id: str | None = None,
    provider: str = "hosted",
    timeout_seconds: float | None = None,
) -> AsyncIterator[bytes]:
    request_id = request_id or getattr(request.state, "request_id", str(uuid4()))
    provider = getattr(request.state, "provider", provider)
    timeout_seconds = getattr(request.state, "timeout_seconds", timeout_seconds)
    max_inflight = getattr(request.state, "max_inflight", None)
    queue: asyncio.Queue[AgentEvent | _TimeoutMarker | _RunnerFailureMarker | None] = asyncio.Queue()
    cancellation = asyncio.Event()
    next_sequence = 0
    emitted_terminal = False

    async def emit(event: AgentEvent) -> None:
        nonlocal emitted_terminal
        if event.event_type in {"run.completed", "run.failed"}:
            emitted_terminal = True
        await queue.put(event)

    async def run() -> None:
        try:
            await runner.run_turn(turn, emit, cancellation)
        except asyncio.CancelledError:
            raise
        except Exception:
            if not emitted_terminal and not cancellation.is_set():
                await queue.put(_RunnerFailureMarker(turn.run_id))
        finally:
            await queue.put(None)

    async def timeout_watch() -> None:
        if timeout_seconds is None:
            return
        await asyncio.sleep(timeout_seconds)
        if not cancellation.is_set():
            cancellation.set()
            await queue.put(_TimeoutMarker(turn.run_id))


    admission: asyncio.Semaphore | None = None
    admission_acquired = False
    if provider == "local" and isinstance(max_inflight, int):
        admission = _local_admission(max_inflight)
        await admission.acquire()
        admission_acquired = True
    runner_task = asyncio.create_task(run())
    watcher_task = asyncio.create_task(_cancel_on_disconnect(request, cancellation))
    timeout_task = asyncio.create_task(timeout_watch())
    terminal_seen = False
    try:
        while True:
            item = await queue.get()
            if item is None:
                if not terminal_seen and not cancellation.is_set():
                    raise RuntimeError("runner completed without a terminal event")
                break
            if terminal_seen:
                continue
            if isinstance(item, _TimeoutMarker):
                event = _timeout_event(item.run_id, next_sequence)
            elif isinstance(item, _RunnerFailureMarker):
                event = _failure_event(item.run_id, next_sequence, "runner_error")
            else:
                event = item
            next_sequence = max(next_sequence, event.sequence + 1)
            yield _sse(event)
            if event.event_type in {"run.completed", "run.failed"}:
                terminal_seen = True
            if event.event_type in {"run.completed", "run.failed"}:
                prompt_tokens = event.payload.get("promptTokens")
                completion_tokens = event.payload.get("completionTokens")
                total_tokens = event.payload.get("totalTokens")
                generation_ms = event.payload.get("generationMs")
                queue_ms = event.payload.get("queueMs")
                ttft_ms = event.payload.get("ttftMs")
                inter_token_latency_ms = event.payload.get("interTokenLatencyMs")
                kv_cache_usage = event.payload.get("kvCacheUsage")
                preemptions = event.payload.get("preemptions")
                oom_signals = event.payload.get("oomSignals")
                restart_signals = event.payload.get("restartSignals")
                metrics.observe_usage(
                    provider=provider,
                    prompt_tokens=(
                        prompt_tokens
                        if isinstance(prompt_tokens, int) and not isinstance(prompt_tokens, bool)
                        else None
                    ),
                    completion_tokens=(
                        completion_tokens
                        if isinstance(completion_tokens, int) and not isinstance(completion_tokens, bool)
                        else None
                    ),
                    total_tokens=(
                        total_tokens
                        if isinstance(total_tokens, int) and not isinstance(total_tokens, bool)
                        else None
                    ),
                    generation_ms=(
                        generation_ms
                        if isinstance(generation_ms, (int, float)) and not isinstance(generation_ms, bool)
                        else None
                    ),
                    queue_ms=(
                        queue_ms
                        if isinstance(queue_ms, (int, float)) and not isinstance(queue_ms, bool)
                        else None
                    ),
                    ttft_ms=(
                        ttft_ms
                        if isinstance(ttft_ms, (int, float)) and not isinstance(ttft_ms, bool)
                        else None
                    ),
                    inter_token_latency_ms=(
                        inter_token_latency_ms
                        if isinstance(inter_token_latency_ms, (int, float)) and not isinstance(inter_token_latency_ms, bool)
                        else None
                    ),
                    kv_cache_usage=(
                        kv_cache_usage
                        if isinstance(kv_cache_usage, (int, float))
                        and not isinstance(kv_cache_usage, bool)
                        else None
                    ),
                    preemptions=(
                        preemptions
                        if isinstance(preemptions, int) and not isinstance(preemptions, bool)
                        else None
                    ),
                    oom_signals=(
                        oom_signals
                        if isinstance(oom_signals, int) and not isinstance(oom_signals, bool)
                        else None
                    ),
                    restart_signals=(
                        restart_signals
                        if isinstance(restart_signals, int) and not isinstance(restart_signals, bool)
                        else None
                    ),
                )
                code = event.payload.get("code")
                outcome = "completed" if event.event_type == "run.completed" else "timeout" if code == "timeout" else "cancelled" if code == "aborted" else "failed"
                metrics.observe_request(provider=provider, outcome=outcome, code=str(code) if code else None)
    finally:
        cancellation.set()
        watcher_task.cancel()
        timeout_task.cancel()
        runner_task.cancel()
        await asyncio.gather(watcher_task, timeout_task, runner_task, return_exceptions=True)
        if admission_acquired and admission is not None:
            admission.release()


@router.post("/v1/question", tags=["question"])
async def question(
    payload: QuestionRequest,
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    _authorize(authorization, _configured_token())
    request_id = _request_id(request)
    try:
        settings: Settings = get_settings()
        configured_provider = getattr(settings, "PROVIDER_NAME", "openrouter")
        provider = selected_provider(settings)
        access_scope = _authenticated_access_scope(request, settings)
        if payload.corpus_revision is not None and (
            not settings.PINECONE_CORPUS_REVISION
            or payload.corpus_revision != settings.PINECONE_CORPUS_REVISION
        ):
            raise _internal_error(400, "invalid_request", "Invalid request")
        if not access_scope:
            raise _internal_error(401, "unauthorized", "Authenticated access scope is required")
        if provider == "local":
            tenant = str(access_scope.get("tenant", "unknown"))
            if not _LOCAL_RATE_LIMITER.allow(
                tenant,
                getattr(settings, "LOCAL_LLM_RATE_LIMIT_PER_MINUTE", 60),
            ):
                metrics.observe_request(provider=provider, outcome="failed", code="rate_limited")
                raise _internal_error(429, "rate_limited", "Too many requests")
        runner_settings = settings
        if provider != configured_provider:
            model_copy = getattr(settings, "model_copy", None)
            if not callable(model_copy):
                raise ValueError("Provider rollback requires validated settings")
            runner_settings = model_copy(update={"PROVIDER_NAME": provider})
        runner = create_langgraph_agent_turn_runner(settings=runner_settings)
    except (ValidationError, ValueError, OSError, RuntimeError):
        raise _internal_error(503, "service_unavailable", "Question service unavailable")
    turn = AgentTurnInput(
        run_id=payload.run_id or str(uuid4()),
        thread_id=payload.thread_id,
        messages=[{"role": message.role, "content": message.content} for message in payload.messages],
        access_scope=access_scope,
    )
    timeout_seconds = getattr(settings, "LOCAL_LLM_TIMEOUT_SECONDS", None) if provider == "local" else None
    request.state.request_id = request_id
    request.state.provider = provider
    request.state.timeout_seconds = timeout_seconds
    request.state.max_inflight = (
        getattr(settings, "LOCAL_LLM_MAX_INFLIGHT", 1)
        if provider == "local"
        else None
    )
    return StreamingResponse(
        _event_stream(request, runner, turn),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Request-ID": request_id,
        },
    )
