from __future__ import annotations

import json
from time import perf_counter
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


def _check_structured_completion(
    url: str,
    *,
    api_key: str,
    model: str,
    timeout: float,
) -> None:
    body = json.dumps(
        {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": "Use the retrieval tool for the query dhamma.",
                }
            ],
            "temperature": 0,
            "max_tokens": 64,
            "stream": False,
            "parallel_tool_calls": False,
            "tool_choice": {
                "type": "function",
                "function": {"name": "retrieve"},
            },
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "retrieve",
                        "description": "Retrieve grounded passages.",
                        "parameters": {
                            "type": "object",
                            "properties": {"query": {"type": "string", "minLength": 1}},
                            "required": ["query"],
                            "additionalProperties": False,
                        },
                        "strict": True,
                    },
                }
            ],
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
                    f"vLLM structured readiness returned HTTP {response.status}"
                )
            payload = json.load(response)
    except HTTPError as error:
        raise VllmReadinessError(
            f"vLLM structured readiness returned HTTP {error.code}"
        ) from error
    except (TimeoutError, URLError, OSError) as error:
        raise VllmReadinessError("vLLM structured readiness is unavailable") from error
    except (TypeError, ValueError) as error:
        raise VllmReadinessError(
            "vLLM structured readiness returned invalid JSON"
        ) from error
    if not isinstance(payload, dict):
        raise VllmReadinessError("vLLM structured readiness response is invalid")
    choices = payload.get("choices")
    message = choices[0].get("message") if isinstance(choices, list) and choices else None
    calls = message.get("tool_calls") if isinstance(message, dict) else None
    call = calls[0] if isinstance(calls, list) and len(calls) == 1 else None
    function = call.get("function") if isinstance(call, dict) else None
    arguments = function.get("arguments") if isinstance(function, dict) else None
    if (
        not isinstance(function, dict)
        or function.get("name") != "retrieve"
        or not isinstance(arguments, str)
    ):
        raise VllmReadinessError("vLLM structured readiness returned no valid tool call")
    try:
        parsed_arguments = json.loads(arguments)
    except (TypeError, ValueError) as error:
        raise VllmReadinessError(
            "vLLM structured readiness returned invalid tool arguments"
        ) from error
    if (
        not isinstance(parsed_arguments, dict)
        or set(parsed_arguments) != {"query"}
        or not isinstance(parsed_arguments["query"], str)
        or not parsed_arguments["query"].strip()
    ):
        raise VllmReadinessError("vLLM structured readiness returned invalid tool arguments")


def check_vllm_structured_contract(
    base_url: str,
    *,
    api_key: str,
    model: str = QWEN3_VLLM_PROFILE.model_id,
    timeout: float = 2,
) -> tuple[float, float]:
    """Exercise serialized strict tool calls and return warm-up/steady-state latency."""
    normalized_url = _validate_base_url(base_url)
    if model != QWEN3_VLLM_PROFILE.model_id:
        raise VllmReadinessError("vLLM structured readiness requires the pinned model")
    completion_url = (
        f"{normalized_url}/chat/completions"
        if normalized_url.endswith("/v1")
        else f"{normalized_url}/v1/chat/completions"
    )
    started = perf_counter()
    _check_structured_completion(
        completion_url,
        api_key=api_key,
        model=model,
        timeout=timeout,
    )
    warmup_ms = (perf_counter() - started) * 1000
    started = perf_counter()
    _check_structured_completion(
        completion_url,
        api_key=api_key,
        model=model,
        timeout=timeout,
    )
    steady_state_ms = (perf_counter() - started) * 1000
    return round(warmup_ms, 3), round(steady_state_ms, 3)


def check_vllm_readiness(
    base_url: str,
    *,
    api_key: str,
    expected_model: str = QWEN3_VLLM_PROFILE.model_id,
    timeout: float = 2,
) -> str:
    """Check health, exact model identity, plain completion, and structured tool calls."""
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
    check_vllm_structured_contract(
        normalized_url,
        api_key=api_key,
        model=model,
        timeout=timeout,
    )
    return model
