from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

from .question import (
    http_exception_handler,
    request_validation_error_handler,
    router,
)

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
    """Return service-local health without contacting external dependencies."""
    return {"status": "ok", "service": "api"}
