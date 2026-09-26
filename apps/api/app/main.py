from typing import Annotated

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse

from .config import get_settings
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
        if settings.PROVIDER_NAME == "local":
            check_vllm_readiness(
                settings.LOCAL_LLM_BASE_URL or "",
                api_key=settings.LOCAL_LLM_API_KEY,
                expected_model=QWEN3_VLLM_PROFILE.model_id,
                timeout=min(float(settings.LOCAL_LLM_TIMEOUT_SECONDS), 5.0),
            )
        metrics.set_readiness(provider=settings.PROVIDER_NAME, ready=True)
        return JSONResponse(
            status_code=200,
            content={"status": "ready", "service": "api", "provider": settings.PROVIDER_NAME},
        )
    except (VllmReadinessError, OSError, RuntimeError, ValueError, TypeError):
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


@app.get("/metrics", tags=["health"], response_class=PlainTextResponse)
def protected_metrics(
    authorization: Annotated[str | None, Header()] = None,
) -> PlainTextResponse:
    _authorize(authorization, _configured_token())
    return PlainTextResponse(metrics.render(), media_type="text/plain; version=0.0.4")
