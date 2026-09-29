from typing import Annotated

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse

from .config import get_settings, selected_provider
from .observability import metrics
from .question import (
    _authorize,
    _configured_token,
    http_exception_handler,
    request_validation_error_handler,
    router,
)
from .vllm_profile import QWEN3_VLLM_PROFILE, VllmReadinessError, check_vllm_readiness

app = FastAPI(title="Pali Docs API", version="0.1.0")

MAX_QUESTION_BODY_BYTES = 256 * 1024


class _QuestionBodyTooLarge(Exception):
    pass


@app.middleware("http")
async def limit_question_body(request: Request, call_next):
    if request.url.path != "/v1/question":
        return await call_next(request)

    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) > MAX_QUESTION_BODY_BYTES:
                return JSONResponse(
                    status_code=413,
                    content={"error": "request_too_large", "message": "Request body too large"},
                )
        except ValueError:
            pass

    received = 0
    receive = request.receive

    async def bounded_receive():
        nonlocal received
        message = await receive()
        if message["type"] == "http.request":
            received += len(message.get("body", b""))
            if received > MAX_QUESTION_BODY_BYTES:
                raise _QuestionBodyTooLarge
        return message

    request._receive = bounded_receive
    try:
        return await call_next(request)
    except _QuestionBodyTooLarge:
        return JSONResponse(
            status_code=413,
            content={"error": "request_too_large", "message": "Request body too large"},
        )


app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, request_validation_error_handler)
app.include_router(router)


@app.get("/healthz", tags=["health"])
def healthz() -> dict[str, str]:
    """Return service-local liveness without contacting external dependencies."""
    return {"status": "ok", "service": "api"}


@app.get("/readyz", tags=["health"])
def readyz() -> JSONResponse:
    """Check the selected provider without exposing endpoint or credential details."""
    try:
        settings = get_settings()
        provider = selected_provider(settings)
        if provider == "local":
            check_vllm_readiness(
                settings.LOCAL_LLM_BASE_URL or "",
                api_key=settings.LOCAL_LLM_API_KEY,
                expected_model=QWEN3_VLLM_PROFILE.model_id,
                timeout=min(float(settings.LOCAL_LLM_TIMEOUT_SECONDS), 5.0),
            )
        metrics.set_readiness(provider=provider, ready=True)
        return JSONResponse(
            status_code=200,
            content={"status": "ready", "service": "api", "provider": provider},
        )
    except VllmReadinessError as error:
        metrics.set_readiness(provider="local", ready=False)
        state = getattr(error, "state", "model_failed")
        return JSONResponse(
            status_code=503,
            content={
                "status": "loading" if state == "model_loading" else "not_ready",
                "service": "api",
                "reason": state,
            },
        )
    except (OSError, RuntimeError, ValueError, TypeError):
        provider = "unknown"
        try:
            provider = get_settings().PROVIDER_NAME
        except Exception:
            pass
        metrics.set_readiness(provider=provider, ready=False)
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "service": "api"},
        )


@app.get("/internal/readyz", tags=["health"])
def internal_readyz(
    authorization: Annotated[str | None, Header()] = None,
) -> JSONResponse:
    """Return authenticated, server-safe serving identity for evaluation runners."""
    _authorize(authorization, _configured_token())
    readiness = readyz()
    if readiness.status_code != 200:
        return readiness
    settings = get_settings()
    if selected_provider(settings) != "local":
        return JSONResponse(status_code=503, content={"status": "not_ready", "service": "api"})
    return JSONResponse(
        status_code=200,
        content={
            "status": "ready",
            "service": "api",
            "model": QWEN3_VLLM_PROFILE.model_id,
            "servingRevision": QWEN3_VLLM_PROFILE.model_revision,
            "tokenizer": QWEN3_VLLM_PROFILE.tokenizer_id,
            "tokenizerRevision": QWEN3_VLLM_PROFILE.tokenizer_revision,
            "imageDigest": QWEN3_VLLM_PROFILE.image,
            "parser": QWEN3_VLLM_PROFILE.tool_call_parser,
            "chatTemplate": QWEN3_VLLM_PROFILE.chat_template,
            "precision": QWEN3_VLLM_PROFILE.precision,
            "servingLimits": {
                "maxModelLen": QWEN3_VLLM_PROFILE.max_model_len,
                "maxNumSeqs": QWEN3_VLLM_PROFILE.max_num_seqs,
                "maxNumBatchedTokens": QWEN3_VLLM_PROFILE.max_num_batched_tokens,
                "gpuMemoryUtilization": QWEN3_VLLM_PROFILE.gpu_memory_utilization,
                "maxOutputTokens": QWEN3_VLLM_PROFILE.max_output_tokens,
            },
        },
    )


@app.get("/metrics", tags=["health"], response_class=PlainTextResponse)
def protected_metrics(
    authorization: Annotated[str | None, Header()] = None,
) -> PlainTextResponse:
    _authorize(authorization, _configured_token())
    return PlainTextResponse(metrics.render(), media_type="text/plain; version=0.0.4")
