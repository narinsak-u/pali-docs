from __future__ import annotations

import json
from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

@dataclass(frozen=True, slots=True)
class VllmProfile:
    image: str
    image_tag: str
    model_id: str
    model_revision: str
    tokenizer_id: str
    tokenizer_revision: str
    reasoning_parser: str
    chat_template_kwargs: Mapping[str, bool]
    tensor_parallel_size: int


QWEN3_VLLM_PROFILE = VllmProfile(
    image=(
        "vllm/vllm-openai@sha256:"
        "df2c55e5107afea09ea1a50f9dd96c99ebf97a795334c4d08f691f3d79b2ab12"
    ),
    image_tag="v0.9.0",
    model_id="Qwen/Qwen3-8B",
    model_revision="b968826d9c46dd6066d109eabc6255188de91218",
    tokenizer_id="Qwen/Qwen3-8B",
    tokenizer_revision="b968826d9c46dd6066d109eabc6255188de91218",
    reasoning_parser="qwen3",
    chat_template_kwargs=MappingProxyType({"enable_thinking": False}),
    tensor_parallel_size=1,
)


class VllmReadinessError(RuntimeError):
    """Raised when the private vLLM endpoint is not ready for the pinned model."""


def _validate_base_url(base_url: str) -> str:
    if not isinstance(base_url, str) or not base_url.strip():
        raise VllmReadinessError("vLLM base URL is required")
    try:
        endpoint = urlsplit(base_url.strip())
        hostname = endpoint.hostname
        port = endpoint.port
    except ValueError as error:
        raise VllmReadinessError("vLLM base URL must be an absolute http(s) URL") from error
    if (
        endpoint.scheme not in {"http", "https"}
        or not hostname
        or (port is not None and not 1 <= port <= 65535)
        or endpoint.query
        or endpoint.fragment
    ):
        raise VllmReadinessError("vLLM base URL must be an absolute http(s) URL")
    return urlunsplit((endpoint.scheme, endpoint.netloc, endpoint.path.rstrip("/"), "", ""))


def validate_model_identity(payload: object, *, expected_model: str) -> str:
    """Return the served model ID only when /v1/models is an exact match."""
    if not isinstance(expected_model, str) or not expected_model.strip():
        raise VllmReadinessError("expected vLLM model ID is required")
    if not isinstance(payload, dict):
        raise VllmReadinessError("vLLM model identity response is invalid")
    models = payload.get("data")
    if not isinstance(models, list) or len(models) != 1:
        raise VllmReadinessError("vLLM model identity response must contain one model")
    model = models[0]
    if not isinstance(model, dict) or model.get("id") != expected_model:
        raise VllmReadinessError("vLLM served model does not match the pinned model")
    return expected_model


def _get_status(url: str, *, timeout: float) -> None:
    request = Request(url, headers={"Accept": "application/json"}, method="GET")
    try:
        with urlopen(request, timeout=timeout) as response:
            if response.status != 200:
                raise VllmReadinessError(f"vLLM readiness returned HTTP {response.status}")
    except HTTPError as error:
        raise VllmReadinessError(f"vLLM readiness returned HTTP {error.code}") from error
    except (TimeoutError, URLError, OSError) as error:
        raise VllmReadinessError("vLLM readiness endpoint is unavailable") from error


def _get_json(url: str, *, api_key: str | None, timeout: float) -> object:
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = Request(url, headers=headers, method="GET")
    try:
        with urlopen(request, timeout=timeout) as response:
            if response.status != 200:
                raise VllmReadinessError(f"vLLM readiness returned HTTP {response.status}")
            try:
                return json.load(response)
            except (TypeError, ValueError) as error:
                raise VllmReadinessError("vLLM readiness returned invalid JSON") from error
    except HTTPError as error:
        raise VllmReadinessError(f"vLLM readiness returned HTTP {error.code}") from error
    except (TimeoutError, URLError, OSError) as error:
        raise VllmReadinessError("vLLM readiness endpoint is unavailable") from error


def check_vllm_readiness(
    base_url: str,
    *,
    api_key: str,
    expected_model: str = QWEN3_VLLM_PROFILE.model_id,
    timeout: float = 2,
) -> str:
    """Check health and exact model identity for the private vLLM endpoint."""
    normalized_url = _validate_base_url(base_url)
    if not isinstance(api_key, str) or not api_key.strip():
        raise VllmReadinessError("vLLM API key is required")
    if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or timeout <= 0:
        raise VllmReadinessError("vLLM readiness timeout must be positive")

    if normalized_url.endswith("/v1"):
        health_url = normalized_url[:-3] + "/health"
        models_url = f"{normalized_url}/models"
    else:
        health_url = f"{normalized_url}/health"
        models_url = f"{normalized_url}/v1/models"
    _get_status(health_url, timeout=timeout)
    payload = _get_json(models_url, api_key=api_key, timeout=timeout)
    return validate_model_identity(payload, expected_model=expected_model)
