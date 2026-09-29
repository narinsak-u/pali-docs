from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.agent.runner import LangChainModelStages


class _Runnable:
    def __init__(self) -> None:
        self.config: object = None

    async def ainvoke(
        self, _messages: object, *, config: object = None
    ) -> dict[str, object]:
        self.config = config
        return {
            "raw": SimpleNamespace(
                usage_metadata={
                    "input_tokens": 12,
                    "output_tokens": 7,
                    "total_tokens": 19,
                },
                invalid_tool_calls=[],
                tool_calls=[],
            ),
            "parsed": {"needsRetrieval": False, "query": "hello"},
            "parsing_error": None,
        }


class _Model:
    def __init__(self) -> None:
        self.runnable = _Runnable()

    def with_structured_output(self, _schema: type[object], **_kwargs: object) -> _Runnable:
        return self.runnable


@pytest.mark.asyncio
async def test_local_model_stage_exposes_non_sensitive_usage_telemetry() -> None:
    model = _Model()
    stages = LangChainModelStages(
        model=model,
        settings=SimpleNamespace(PROVIDER_NAME="local"),
    )

    await stages.classify(
        SimpleNamespace(
            run_id="telemetry-run",
            messages=[],
        )
    )

    await stages.classify(
        SimpleNamespace(
            run_id="telemetry-run-2",
            messages=[],
        )
    )

    assert stages.telemetry["promptTokens"] == 24
    assert stages.telemetry["completionTokens"] == 14
    assert stages.telemetry["totalTokens"] == 38
    assert stages.telemetry["generationMs"] >= 0
    assert model.runnable.config == {
        "metadata": {"runId": "telemetry-run-2"},
        "run_name": "pali-agent-telemetry-run-2",
    }
    assert "prompt" not in stages.telemetry
