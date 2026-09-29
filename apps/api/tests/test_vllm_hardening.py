from __future__ import annotations

from pathlib import Path

from app.vllm_profile import QWEN3_VLLM_PROFILE, check_vllm_readiness


def test_vllm_profile_pins_bounded_serving_limits_and_cache_paths() -> None:
    assert QWEN3_VLLM_PROFILE.max_model_len == 8_192
    assert QWEN3_VLLM_PROFILE.max_num_seqs == 4
    assert QWEN3_VLLM_PROFILE.max_num_batched_tokens == 8_192
    assert QWEN3_VLLM_PROFILE.gpu_memory_utilization == 0.9
    assert QWEN3_VLLM_PROFILE.max_output_tokens == 768
    assert QWEN3_VLLM_PROFILE.cache_roots == (
        "/root/.cache/huggingface",
        "/root/.cache/vllm",
        "/root/.cache/torch",
        "/root/.cache/triton",
    )

    compose = (Path(__file__).parents[3] / "deploy" / "vllm" / "docker-compose.yml").read_text()
    for argument in (
        "--max-model-len",
        "--max-num-seqs",
        "--max-num-batched-tokens",
        "--gpu-memory-utilization",
    ):
        assert argument in compose
    assert "vllm-compile-cache" in compose
    assert "torch-compile-cache" in compose
    assert "triton-cache" in compose


def test_readiness_requires_a_bounded_non_thinking_completion(monkeypatch) -> None:
    class Response:
        def __init__(self, body: bytes, status: int = 200) -> None:
            self.body = body
            self.status = status

        def __enter__(self):
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def read(self) -> bytes:
            return self.body

    responses = iter(
        [
            Response(b""),
            Response(b'{"data":[{"id":"Qwen/Qwen3-8B"}]}'),
            Response(b'{"choices":[{"message":{"content":"ok"}}]}'),
            Response(
                b'{"choices":[{"message":{"tool_calls":[{"function":{"name":"retrieve","arguments":"{\\"query\\":\\"dhamma\\"}"}}]}}]}'
            ),
            Response(
                b'{"choices":[{"message":{"tool_calls":[{"function":{"name":"retrieve","arguments":"{\\"query\\":\\"dhamma\\"}"}}]}}]}'
            ),
        ]
    )
    requests = []

    def fake_urlopen(request, timeout):
        requests.append(request)
        return next(responses)

    monkeypatch.setattr("app.vllm_profile.urlopen", fake_urlopen)

    assert check_vllm_readiness(
        "http://vllm.internal:8000/v1",
        api_key="vllm-key",
    ) == "Qwen/Qwen3-8B"
    assert requests[2].full_url == "http://vllm.internal:8000/v1/chat/completions"

def test_readiness_completion_check_explicitly_disables_streaming(monkeypatch) -> None:
    import json

    class Response:
        def __init__(self, body: bytes) -> None:
            self.body = body
            self.status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def read(self) -> bytes:
            return self.body

    responses = iter(
        [
            Response(b""),
            Response(b'{"data":[{"id":"Qwen/Qwen3-8B"}]}'),
            Response(b'{"choices":[{"message":{"content":"ok"}}]}'),
            Response(
                b'{"choices":[{"message":{"tool_calls":[{"function":{"name":"retrieve","arguments":"{\\"query\\":\\"dhamma\\"}"}}]}}]}'
            ),
            Response(
                b'{"choices":[{"message":{"tool_calls":[{"function":{"name":"retrieve","arguments":"{\\"query\\":\\"dhamma\\"}"}}]}}]}'
            ),
        ]
    )
    requests = []

    def fake_urlopen(request, timeout):
        requests.append(request)
        return next(responses)

    monkeypatch.setattr("app.vllm_profile.urlopen", fake_urlopen)

    assert check_vllm_readiness("http://vllm.internal:8000/v1", api_key="vllm-key")
    completion = json.loads(requests[2].data)
    assert completion["stream"] is False
    assert requests[2].headers["Authorization"] == "Bearer vllm-key"
