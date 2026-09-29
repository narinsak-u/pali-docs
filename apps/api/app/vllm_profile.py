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
    tool_call_parser: str
    enable_auto_tool_choice: bool
    chat_template_kwargs: Mapping[str, bool]
    tensor_parallel_size: int
    max_model_len: int
    max_num_seqs: int
    max_num_batched_tokens: int
    gpu_memory_utilization: float
    max_output_tokens: int
    precision: str
    chat_template: str
    cache_roots: tuple[str, ...]


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
    tool_call_parser="hermes",
    enable_auto_tool_choice=True,
    chat_template_kwargs=MappingProxyType({"enable_thinking": False}),
    tensor_parallel_size=1,
    max_model_len=8_192,
    max_num_seqs=4,
    max_num_batched_tokens=8_192,
    gpu_memory_utilization=0.9,
    max_output_tokens=768,
    precision="bfloat16",
    chat_template="qwen3-pinned",
    cache_roots=(
        "/root/.cache/huggingface",
        "/root/.cache/vllm",
        "/root/.cache/torch",
        "/root/.cache/triton",
    ),
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


def _check_non_thinking_completion(
    url: str,
    *,
    api_key: str,
    model: str,
    timeout: float,
) -> None:
    body = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": "Reply with one word: ready"}],
            "temperature": 0,
            "max_tokens": 1,
            "stream": False,
            "chat_template_kwargs": dict(QWEN3_VLLM_PROFILE.chat_template_kwargs),
        }
    ).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            if response.status != 200:
                raise VllmReadinessError(
                    f"vLLM completion readiness returned HTTP {response.status}"
                )
            payload = json.load(response)
    except HTTPError as error:
        raise VllmReadinessError(
            f"vLLM completion readiness returned HTTP {error.code}"
        ) from error
    except (TimeoutError, URLError, OSError) as error:
        raise VllmReadinessError("vLLM completion readiness is unavailable") from error
    except (TypeError, ValueError) as error:
        raise VllmReadinessError("vLLM completion readiness returned invalid JSON") from error
    if not isinstance(payload, dict):
        raise VllmReadinessError("vLLM completion readiness response is invalid")
    choices = payload.get("choices")
    message = choices[0].get("message") if isinstance(choices, list) and choices else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str) or not content.strip():
        raise VllmReadinessError("vLLM completion readiness returned no content")


def check_vllm_readiness(
    base_url: str,
    *,
    api_key: str,
    expected_model: str = QWEN3_VLLM_PROFILE.model_id,
    timeout: float = 2,
) -> str:
    """Check health, exact model identity, and a non-thinking completion."""
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
    model = validate_model_identity(payload, expected_model=expected_model)
    completion_url = (
        f"{normalized_url}/chat/completions"
        if normalized_url.endswith("/v1")
        else f"{normalized_url}/v1/chat/completions"
    )
    _check_non_thinking_completion(
        completion_url,
        api_key=api_key,
        model=model,
        timeout=timeout,
    )
    return model
