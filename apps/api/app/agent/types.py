from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Literal, Protocol, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.rag.types import Citation, GroundedBundle, GroundingBundle


class AgentMessage(BaseModel):
    """The only message shape allowed to cross the runner boundary."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1)


class AgentTurnInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid", frozen=True, populate_by_name=True
    )

    run_id: str = Field(min_length=1, alias="runId")
    thread_id: str | None = Field(default=None, min_length=1, alias="threadId")
    messages: list[AgentMessage] = Field(min_length=1)
    access_scope: dict[str, object] | None = None


class RetrievalDecision(BaseModel):
    model_config = ConfigDict(
        extra="forbid", frozen=True, populate_by_name=True
    )

    needs_retrieval: bool = Field(alias="needsRetrieval")
    query: str = Field(min_length=1, max_length=500)

class QueryRewrite(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    query: str = Field(min_length=1, max_length=500)


class DirectAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    answer: str = Field(min_length=1)

class GroundedAnswer(BaseModel):
    model_config = ConfigDict(
        extra="forbid", frozen=True, populate_by_name=True
    )

    answer: str = Field(min_length=1)
    citation_ids: list[str] = Field(default_factory=list, alias="citationIds")

    @field_validator("citation_ids")
    @classmethod
    def non_empty_ids(cls, value: list[str]) -> list[str]:
        if any(not citation_id.strip() for citation_id in value):
            raise ValueError("citation IDs must be non-empty")
        return value


class CitationRepair(GroundedAnswer):
    pass


class Suggestions(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    suggestions: list[str] = Field(default_factory=list, max_length=3)

    @field_validator("suggestions")
    @classmethod
    def non_empty_suggestions(cls, value: list[str]) -> list[str]:
        if any(not suggestion.strip() for suggestion in value):
            raise ValueError("suggestions must be non-empty")
        return value


class AnsweredResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    outcome: Literal["answered"] = "answered"
    answer: str = Field(min_length=1)
    citations: list[Citation]
    suggestions: list[str]


class TerminalResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    outcome: Literal["insufficient-evidence", "retrieval-unavailable", "failed"]
    code: str | None = Field(default=None, min_length=1)


AgentTurnResult: TypeAlias = AnsweredResult | TerminalResult
AgentTurnOutcome: TypeAlias = Literal[
    "answered", "insufficient-evidence", "retrieval-unavailable", "failed"
]


class AgentEvent(BaseModel):
    """Versioned, framework-neutral event envelope exposed by the runner."""

    model_config = ConfigDict(
        alias_generator=lambda name: {
            "schema_version": "schemaVersion",
            "run_id": "runId",
            "event_id": "eventId",
            "event_type": "eventType",
        }.get(name, name),
        populate_by_name=True,
        extra="forbid",
        frozen=True,
    )

    schema_version: Literal["v1"] = "v1"
    run_id: str = Field(min_length=1)
    event_id: str = Field(min_length=1)
    sequence: int = Field(ge=0)
    event_type: Literal[
        "run.started",
        "retrieval.started",
        "retrieval.completed",
        "retrieval.failed",
        "query.rewritten",
        "generation.started",
        "answer.completed",
        "citations.completed",
        "suggestions.completed",
        "run.completed",
        "run.failed",
    ]
    timestamp: datetime
    payload: dict[str, object]

    def as_dict(self) -> dict[str, object]:
        return self.model_dump(by_alias=True, mode="json")

    def __getitem__(self, key: str) -> object:
        return self.as_dict()[key]

    def get(self, key: str, default: object = None) -> object:
        return self.as_dict().get(key, default)


EventSinkCallback: TypeAlias = Callable[[AgentEvent], Awaitable[None] | None]


class EventSink(Protocol):
    def emit(self, event: AgentEvent) -> Awaitable[None] | None: ...


CancellationObservation: TypeAlias = (
    Callable[[], bool] | object
)


class AgentModelStages(Protocol):
    async def classify(self, input: AgentTurnInput) -> RetrievalDecision: ...

    async def rewrite(
        self, input: AgentTurnInput, current_query: str, attempt: int
    ) -> QueryRewrite: ...

    async def direct_answer(self, input: AgentTurnInput) -> DirectAnswer: ...

    async def grounded_answer(
        self, input: AgentTurnInput, grounding: GroundedBundle
    ) -> GroundedAnswer: ...

    async def repair_citations(
        self,
        input: AgentTurnInput,
        grounding: GroundedBundle,
        draft: GroundedAnswer,
    ) -> CitationRepair: ...

    async def suggestions(self, input: AgentTurnInput, answer: str) -> Suggestions: ...


class AgentTurnRunner(Protocol):
    async def run_turn(
        self,
        input: AgentTurnInput | Mapping[str, object],
        event_sink: EventSink | EventSinkCallback | None = None,
        cancellation: CancellationObservation | None = None,
    ) -> AgentTurnResult: ...


AgentEventSink = EventSink
DirectAnswerDraft = DirectAnswer
GroundedAnswerDraft = GroundedAnswer
SuggestionDraft = Suggestions


class AgentRetriever(Protocol):
    async def retrieve(
        self,
        query: str,
        attempt: int,
        access_scope: Mapping[str, object] | None = None,
    ) -> GroundingBundle: ...


# Compatibility aliases for callers ported from the TypeScript runner.
RetrievalDecisionOutput = RetrievalDecision
QueryRewriteOutput = QueryRewrite
DirectAnswerOutput = DirectAnswer
GroundedAnswerOutput = GroundedAnswer
CitationRepairOutput = CitationRepair
SuggestionsOutput = Suggestions
