from __future__ import annotations

import pytest

from app.vllm_profile import (
    QWEN3_VLLM_PROFILE,
    VllmReadinessError,
    validate_model_identity,
)


def test_qwen3_profile_is_pinned_for_private_non_thinking_single_gpu() -> None:
    assert QWEN3_VLLM_PROFILE.model_id == "Qwen/Qwen3-8B"
    assert QWEN3_VLLM_PROFILE.model_revision == "b968826d9c46dd6066d109eabc6255188de91218"
    assert QWEN3_VLLM_PROFILE.tokenizer_id == "Qwen/Qwen3-8B"
    assert QWEN3_VLLM_PROFILE.tokenizer_revision == "b968826d9c46dd6066d109eabc6255188de91218"
    assert QWEN3_VLLM_PROFILE.image_tag == "v0.9.0"
    assert QWEN3_VLLM_PROFILE.image == (
        "vllm/vllm-openai@sha256:df2c55e5107afea09ea1a50f9dd96c99ebf97a795334c4d08f691f3d79b2ab12"
    )
    assert QWEN3_VLLM_PROFILE.reasoning_parser == "qwen3"
    assert QWEN3_VLLM_PROFILE.tool_call_parser == "hermes"
    assert QWEN3_VLLM_PROFILE.enable_auto_tool_choice is True
    assert QWEN3_VLLM_PROFILE.chat_template_kwargs == {"enable_thinking": False}
    assert QWEN3_VLLM_PROFILE.tensor_parallel_size == 1


def test_compose_profile_keeps_vllm_private_and_matches_pinned_profile() -> None:
    from pathlib import Path

    compose = (
        Path(__file__).parents[3] / "deploy" / "vllm" / "docker-compose.yml"
    ).read_text()

    assert f"image: {QWEN3_VLLM_PROFILE.image}" in compose
    assert f"--model\n      - {QWEN3_VLLM_PROFILE.model_id}" in compose
    assert f"--revision\n      - {QWEN3_VLLM_PROFILE.model_revision}" in compose
    assert f"--tokenizer-revision\n      - {QWEN3_VLLM_PROFILE.tokenizer_revision}" in compose
    assert '127.0.0.1:8000:8000' in compose
    assert '--reasoning-parser\n      - qwen3' in compose
    assert "--enable-auto-tool-choice" in compose
    assert "--tool-call-parser\n      - hermes" in compose
    assert "--default-chat-template-kwargs" not in compose

def test_model_identity_accepts_only_the_expected_served_model() -> None:
    assert validate_model_identity(
        {"data": [{"id": "Qwen/Qwen3-8B", "object": "model"}]},
        expected_model="Qwen/Qwen3-8B",
    ) == "Qwen/Qwen3-8B"


def test_readiness_checks_health_then_exact_model_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Response:
        def __init__(self, body: bytes, status: int = 200) -> None:
            self.body = body
            self.status = status

        def __enter__(self) -> Response:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def read(self) -> bytes:
            return self.body

    responses = iter(
        [
            Response(b""),
            Response(b'{"data":[{"id":"Qwen/Qwen3-8B"}]}'),
        ]
    )
    seen: list[object] = []

    def fake_urlopen(request: object, timeout: float) -> Response:
        seen.append(request)
        return next(responses)

    monkeypatch.setattr("app.vllm_profile.urlopen", fake_urlopen)

    from app.vllm_profile import check_vllm_readiness

    assert (
        check_vllm_readiness(
            "http://vllm.internal:8000/v1",
            api_key="vllm-key",
        )
        == "Qwen/Qwen3-8B"
    )
    assert len(seen) == 2
    assert seen[0].full_url == "http://vllm.internal:8000/health"
    assert seen[1].full_url == "http://vllm.internal:8000/v1/models"

def test_readiness_cli_rejects_non_pinned_model_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import sys
    from pathlib import Path
    from runpy import run_path

    main = run_path(
        str(Path(__file__).parents[1] / "scripts" / "check_vllm.py")
    )["main"]

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "check_vllm.py",
            "--base-url",
            "http://vllm.internal:8000/v1",
            "--api-key",
            "vllm-key",
            "--model",
            "other-model",
        ],
    )

    assert main() == 2


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"data": []},
        {"data": [{"id": "other-model"}]},
        {"data": [{"id": "Qwen/Qwen3-8B"}, {"id": "other-model"}]},
        {"data": [{"object": "model"}]},
    ],
)
def test_model_identity_fails_closed_for_invalid_responses(payload: object) -> None:
    with pytest.raises(VllmReadinessError):
        validate_model_identity(payload, expected_model="Qwen/Qwen3-8B")
