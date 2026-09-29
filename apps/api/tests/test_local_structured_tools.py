from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import pytest
from langchain_core.messages import AIMessage
from pydantic import BaseModel, ValidationError

from app.agent.runner import (
    ApplicationToolDispatcher,
    LangChainModelStages,
)
from app.agent.types import AgentTurnInput, ToolInvocation


class EchoArguments(BaseModel):
    value: str



class OptionalEchoArguments(BaseModel):
    value: str
    note: str | None = None

@dataclass
class StructuredRunnable:
    value: object

    async def ainvoke(self, _messages: object) -> object:
        return self.value


class LocalStructuredModel:
    def __init__(self, value: object) -> None:
        self.value = value
        self.structured_kwargs: dict[str, object] | None = None
        self.tool_kwargs: list[dict[str, object]] = []
        self.tool_definitions: list[list[object]] = []

    def with_structured_output(self, _schema: type[object], **kwargs: object) -> StructuredRunnable:
        self.structured_kwargs = kwargs
        return StructuredRunnable(self.value)

    def bind_tools(self, tools: list[object], **kwargs: object) -> StructuredRunnable:
        self.tool_definitions.append(tools)
        self.tool_kwargs.append(kwargs)
        return StructuredRunnable(
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "id": "call-1",
                        "name": "echo",
                        "args": {"value": "hello"},
                        "type": "tool_call",
                    }
                ],
            )
        )


    async def ainvoke(self, _messages: object) -> AIMessage:
        return AIMessage(content="")


def turn() -> AgentTurnInput:
    return AgentTurnInput(
        run_id="structured-run",
        messages=[{"role": "user", "content": "echo hello"}],
    )


def test_local_structured_calls_use_strict_function_calling_and_reject_malformed_output() -> None:
    model = LocalStructuredModel({"needsRetrieval": True, "query": ""})
    stages = LangChainModelStages(
        model=model,
        settings=type("Settings", (), {"PROVIDER_NAME": "local"})(),
    )

    with pytest.raises(ValidationError):
        asyncio.run(stages.classify(turn()))

    assert model.structured_kwargs == {
        "method": "function_calling",
        "strict": True,
        "include_raw": True,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("choice", ["auto", "required", "none", "echo"])
async def test_tool_choice_is_request_level_and_parsed_without_model_execution(
    choice: str,
) -> None:
    model = LocalStructuredModel(None)
    stages = LangChainModelStages(
        model=model,
        settings=type("Settings", (), {"PROVIDER_NAME": "local"})(),
    )

    call = await stages.tool_call(turn(), [
        {
            "name": "echo",
            "description": "Echo a value",
            "args_schema": EchoArguments,
        }
    ], tool_choice=choice)

    if choice == "none":
        assert call is None
        assert model.tool_kwargs == []
        return
    assert isinstance(call, ToolInvocation)
    assert model.tool_definitions[-1][0]["function"]["strict"] is True
    assert model.tool_definitions[-1][0]["function"]["parameters"][
        "additionalProperties"
    ] is False
    assert model.tool_kwargs[-1]["parallel_tool_calls"] is False
    assert model.tool_kwargs[-1]["strict"] is True
    assert model.tool_kwargs[-1]["tool_choice"] == choice


@pytest.mark.asyncio
async def test_openai_named_tool_choice_is_validated_and_forwarded() -> None:
    model = LocalStructuredModel(None)
    stages = LangChainModelStages(
        model=model,
        settings=type("Settings", (), {"PROVIDER_NAME": "local"})(),
    )
    choice = {"type": "function", "function": {"name": "echo"}}
    call = await stages.tool_call(
        turn(),
        [{"name": "echo", "args_schema": EchoArguments}],
        tool_choice=choice,
    )
    assert isinstance(call, ToolInvocation)
    assert model.tool_kwargs[-1]["tool_choice"] == choice



@pytest.mark.asyncio
async def test_tool_schema_keeps_optional_values_explicit() -> None:
    model = LocalStructuredModel(None)
    stages = LangChainModelStages(
        model=model,
        settings=type("Settings", (), {"PROVIDER_NAME": "local"})(),
    )

    await stages.tool_call(
        turn(),
        [{"name": "echo", "args_schema": OptionalEchoArguments}],
        tool_choice="required",
    )

    parameters = model.tool_definitions[-1][0]["function"]["parameters"]
    assert parameters["required"] == ["value"]
    assert "note" in parameters["properties"]

@pytest.mark.asyncio
async def test_local_stage_invocations_are_serialized_for_the_pilot() -> None:
    class SerialRunnable:
        def __init__(self) -> None:
            self.active = 0
            self.max_active = 0

        async def ainvoke(self, _messages: object) -> dict[str, object]:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
            await asyncio.sleep(0.01)
            self.active -= 1
            return {"needsRetrieval": False, "query": "greeting"}

    class SerialModel:
        def __init__(self) -> None:
            self.runnable = SerialRunnable()

        def with_structured_output(self, _schema: type[object], **_kwargs: object) -> SerialRunnable:
            return self.runnable

    model = SerialModel()
    stages = LangChainModelStages(
        model=model,
        settings=type("Settings", (), {"PROVIDER_NAME": "local"})(),
    )
    await asyncio.gather(stages.classify(turn()), stages.classify(turn()))
    assert model.runnable.max_active == 1


@pytest.mark.asyncio
async def test_local_stage_invocations_are_serialized_across_stage_instances() -> None:
    class SerialRunnable:
        def __init__(self) -> None:
            self.active = 0
            self.max_active = 0

        async def ainvoke(self, _messages: object) -> dict[str, object]:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
            await asyncio.sleep(0.01)
            self.active -= 1
            return {"needsRetrieval": False, "query": "greeting"}

    class SerialModel:
        def __init__(self) -> None:
            self.runnable = SerialRunnable()

        def with_structured_output(self, _schema: type[object], **_kwargs: object) -> SerialRunnable:
            return self.runnable

    model = SerialModel()
    settings = type("Settings", (), {"PROVIDER_NAME": "local"})()
    first = LangChainModelStages(model=model, settings=settings)
    second = LangChainModelStages(model=model, settings=settings)
    await asyncio.gather(first.classify(turn()), second.classify(turn()))
    assert model.runnable.max_active == 1
@pytest.mark.asyncio
async def test_tool_dispatch_validates_arguments_and_authorization() -> None:
    seen: list[str] = []

    async def execute(arguments: EchoArguments) -> str:
        seen.append(arguments.value)
        return arguments.value.upper()

    dispatcher = ApplicationToolDispatcher(
        [
            {
                "name": "echo",
                "args_schema": EchoArguments,
                "handler": execute,
                "authorize": lambda _input: True,
            }
        ]
    )

    result = await dispatcher.dispatch(
        ToolInvocation(call_id="call-1", name="echo", arguments={"value": "hello"}),
        turn(),
    )

    assert result == "HELLO"
    assert seen == ["hello"]

    with pytest.raises(ValidationError):
        await dispatcher.dispatch(
            ToolInvocation(call_id="call-invalid", name="echo", arguments={}),
            turn(),
        )

    with pytest.raises(PermissionError):
        denied = ApplicationToolDispatcher(
            [
                {
                    "name": "echo",
                    "args_schema": EchoArguments,
                    "handler": execute,
                    "authorize": lambda _input: False,
                }
            ]
        )
        await denied.dispatch(
            ToolInvocation(call_id="call-2", name="echo", arguments={"value": "hello"}),
            turn(),
        )


@pytest.mark.asyncio
async def test_tool_dispatch_rejects_unexpected_properties() -> None:
    dispatcher = ApplicationToolDispatcher(
        [
            {
                "name": "echo",
                "args_schema": EchoArguments,
                "handler": lambda args: args.value,
            }
        ]
    )

    with pytest.raises(ValueError, match="unexpected"):
        await dispatcher.dispatch(
            ToolInvocation(
                callId="call-extra",
                name="echo",
                arguments={"value": "hello", "extra": "reject"},
            ),
            turn(),
        )


@pytest.mark.asyncio
async def test_tool_dispatch_rejects_malformed_or_unknown_model_calls() -> None:
    class MalformedModel(LocalStructuredModel):
        def bind_tools(self, _tools: list[object], **kwargs: object) -> StructuredRunnable:
            self.tool_kwargs.append(kwargs)
            return StructuredRunnable(AIMessage(content="", tool_calls=[]))

    stages = LangChainModelStages(
        model=MalformedModel(None),
        settings=type("Settings", (), {"PROVIDER_NAME": "local"})(),
    )

    with pytest.raises(ValueError, match="tool call"):
        await stages.tool_call(
            turn(),
            [{"name": "echo", "args_schema": EchoArguments}],
            tool_choice="required",
        )

    with pytest.raises(ValueError, match="tool call"):
        stages.parse_tool_call(
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "id": "call-1",
                        "name": "other",
                        "args": {},
                        "type": "tool_call",
                    }
                ],
            ),
            ["echo"],
            tool_choice="auto",
        )

    with pytest.raises(ValueError, match="required tool call"):
        stages.parse_tool_call(
            AIMessage(content="", tool_calls=[]),
            ["echo"],
            tool_choice={"type": "function", "function": {"name": "echo"}},
        )

    with pytest.raises(ValueError, match="invalid tool"):
        stages.parse_tool_call(
            AIMessage(
                content="",
                invalid_tool_calls=[
                    {"id": "bad", "name": "echo", "args": "not-json", "error": "bad"}
                ],
            ),
            ["echo"],
            tool_choice="auto",
        )

    with pytest.raises(ValueError, match="tool_calls"):
        stages.parse_tool_call(
            type("MalformedResponse", (), {"tool_calls": "not-a-list"})(),
            ["echo"],
            tool_choice="auto",
        )



@pytest.mark.asyncio
async def test_local_structured_output_rejects_multiple_tool_calls() -> None:
    model = LocalStructuredModel(
        {
            "raw": AIMessage(
                content="",
                tool_calls=[
                    {
                        "id": "call-1",
                        "name": "RetrievalDecision",
                        "args": {"needsRetrieval": False, "query": "hello"},
                        "type": "tool_call",
                    },
                    {
                        "id": "call-2",
                        "name": "RetrievalDecision",
                        "args": {"needsRetrieval": False, "query": "hello"},
                        "type": "tool_call",
                    },
                ],
            ),
            "parsed": {"needsRetrieval": False, "query": "hello"},
            "parsing_error": None,
        }
    )
    stages = LangChainModelStages(
        model=model,
        settings=type("Settings", (), {"PROVIDER_NAME": "local"})(),
    )
    with pytest.raises(ValueError, match="multiple structured tool"):
        await stages.classify(turn())

@pytest.mark.asyncio
async def test_tool_call_rejects_arguments_that_fail_the_registered_schema() -> None:
    class InvalidArgumentsModel(LocalStructuredModel):
        def bind_tools(self, _tools: list[object], **kwargs: object) -> StructuredRunnable:
            self.tool_kwargs.append(kwargs)
            return StructuredRunnable(
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "call-invalid",
                            "name": "echo",
                            "args": {},
                            "type": "tool_call",
                        }
                    ],
                )
            )

    stages = LangChainModelStages(
        model=InvalidArgumentsModel(None),
        settings=type("Settings", (), {"PROVIDER_NAME": "local"})(),
    )
    with pytest.raises(ValidationError):
        await stages.tool_call(
            turn(),
            [{"name": "echo", "args_schema": EchoArguments}],
            tool_choice="required",
        )


@pytest.mark.asyncio
async def test_tool_call_rejects_unexpected_arguments_before_dispatch() -> None:
    class ExtraArgumentsModel(LocalStructuredModel):
        def bind_tools(self, _tools: list[object], **kwargs: object) -> StructuredRunnable:
            self.tool_kwargs.append(kwargs)
            return StructuredRunnable(
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "call-extra",
                            "name": "echo",
                            "args": {"value": "hello", "extra": "reject"},
                            "type": "tool_call",
                        }
                    ],
                )
            )

    stages = LangChainModelStages(
        model=ExtraArgumentsModel(None),
        settings=type("Settings", (), {"PROVIDER_NAME": "local"})(),
    )

    with pytest.raises(ValueError, match="unexpected"):
        await stages.tool_call(
            turn(),
            [{"name": "echo", "args_schema": EchoArguments}],
            tool_choice="required",
        )


def test_tool_call_id_is_bounded_for_public_lifecycle_events() -> None:
    with pytest.raises(ValidationError):
        ToolInvocation(call_id="x" * 201, name="echo", arguments={"value": "hello"})
