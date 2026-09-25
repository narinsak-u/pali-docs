from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from app.agent.runner import LangGraphAgentRunner
from app.agent.types import (
    AgentMessage,
    AgentTurnInput,
    AnsweredResult,
    CitationRepair,
    DirectAnswer,
    GroundedAnswer,
    QueryRewrite,
    RetrievalDecision,
    Suggestions,
    TerminalResult,
)
from app.rag.types import (
    Citation,
    GroundedBundle,
    GroundingBundle,
    GroundingPassage,
    InsufficientEvidenceBundle,
)


@dataclass
class FakeRetriever:
    bundles: list[GroundingBundle]
    calls: list[tuple[str, int, dict[str, object] | None]] = field(default_factory=list)

    async def retrieve(
        self,
        query: str,
        attempt: int,
        access_scope: dict[str, object] | None = None,
    ) -> GroundingBundle:
        self.calls.append((query, attempt, access_scope))
        return self.bundles[min(attempt - 1, len(self.bundles) - 1)]


@dataclass
class FakeStages:
    decision: RetrievalDecision
    direct: DirectAnswer = DirectAnswer(answer="A direct response.")
    grounded: GroundedAnswer = GroundedAnswer(answer="Grounded response.", citationIds=["p-1"])
    repaired: CitationRepair = CitationRepair(answer="Repaired response.", citationIds=["p-1"])
    follow_ups: Suggestions = Suggestions(suggestions=["What next?"])
    rewrites: list[str] = field(default_factory=lambda: ["rewritten query"])
    rewrite_calls: list[tuple[str, int]] = field(default_factory=list)
    grounded_calls: int = 0
    repair_calls: int = 0
    direct_calls: int = 0
    suggestion_calls: int = 0

    async def classify(self, _input: AgentTurnInput) -> RetrievalDecision:
        return self.decision

    async def rewrite(
        self, _input: AgentTurnInput, query: str, attempt: int
    ) -> QueryRewrite:
        self.rewrite_calls.append((query, attempt))
        return QueryRewrite(query=self.rewrites[min(attempt - 2, len(self.rewrites) - 1)])

    async def direct_answer(self, _input: AgentTurnInput) -> DirectAnswer:
        self.direct_calls += 1
        return self.direct

    async def grounded_answer(
        self, _input: AgentTurnInput, _grounding: GroundedBundle
    ) -> GroundedAnswer:
        self.grounded_calls += 1
        return self.grounded

    async def repair_citations(
        self,
        _input: AgentTurnInput,
        _grounding: GroundedBundle,
        _draft: GroundedAnswer,
    ) -> CitationRepair:
        self.repair_calls += 1
        return self.repaired

    async def suggestions(self, _input: AgentTurnInput, _answer: str) -> Suggestions:
        self.suggestion_calls += 1
        return self.follow_ups


def turn(run_id: str = "run-1") -> AgentTurnInput:
    return AgentTurnInput(
        run_id=run_id,
        messages=[AgentMessage(role="user", content="What is this passage?")],
    )


def grounded_bundle() -> GroundedBundle:
    citation = Citation(id="p-1", source="book-1", title="Chapter 1", section="§1")
    return GroundedBundle(
        status="grounded",
        query="passage",
        corpus_revision="rev-1",
        passages=[
            GroundingPassage(
                id=citation.id,
                source=citation.source,
                title=citation.title,
                section=citation.section,
                text="Evidence.",
                score=0.9,
            )
        ],
        citations=[citation],
        context="<retrieved-passages><passage id=\"p-1\">Evidence.</passage></retrieved-passages>",
    )


def insufficient_bundle(query: str = "passage") -> InsufficientEvidenceBundle:
    return InsufficientEvidenceBundle(
        status="insufficient-evidence",
        query=query,
        corpus_revision="rev-1",
        passages=[],
        citations=[],
    )


@pytest.mark.asyncio
async def test_direct_route_avoids_retrieval() -> None:
    retriever = FakeRetriever([grounded_bundle()])
    stages = FakeStages(RetrievalDecision(needsRetrieval=False, query="greeting"))
    events: list[Any] = []

    result = await LangGraphAgentRunner(retriever, stages).run_turn(turn(), events.append)

    assert isinstance(result, AnsweredResult)
    assert result.answer == "A direct response."
    assert result.citations == []
    assert retriever.calls == []
    assert stages.direct_calls == 1
    assert any(event.event_type == "run.completed" for event in events)


@pytest.mark.asyncio
async def test_runner_preserves_quota_failure_code() -> None:
    class QuotaStages(FakeStages):
        async def direct_answer(self, _input: AgentTurnInput) -> DirectAnswer:
            raise RuntimeError("insufficient_quota")

    retriever = FakeRetriever([grounded_bundle()])
    stages = QuotaStages(RetrievalDecision(needsRetrieval=False, query="greeting"))
    events: list[Any] = []

    result = await LangGraphAgentRunner(retriever, stages).run_turn(turn(), events.append)

    assert isinstance(result, TerminalResult)
    assert result.code == "insufficient_quota"
    assert events[-1].event_type == "run.failed"


@pytest.mark.asyncio
async def test_insufficient_evidence_retries_once_then_returns_typed_outcome() -> None:
    retriever = FakeRetriever([insufficient_bundle(), insufficient_bundle("rewritten query")])
    stages = FakeStages(RetrievalDecision(needsRetrieval=True, query="passage"))
    events: list[Any] = []

    result = await LangGraphAgentRunner(retriever, stages).run_turn(turn(), events.append)

    assert isinstance(result, TerminalResult)
    assert result.outcome == "insufficient-evidence"
    assert retriever.calls == [("passage", 1, None), ("rewritten query", 2, None)]
    assert stages.rewrite_calls == [("passage", 2)]
    assert not any(event.event_type == "answer.completed" for event in events)
    assert events[-1].event_type == "run.completed"


@pytest.mark.asyncio
async def test_invalid_citations_repair_once_then_fails_without_answer_events() -> None:
    retriever = FakeRetriever([grounded_bundle()])
    stages = FakeStages(
        RetrievalDecision(needsRetrieval=True, query="passage"),
        grounded=GroundedAnswer(answer="Unsafe response.", citationIds=["not-allowed"]),
        repaired=CitationRepair(answer="Still unsafe.", citationIds=["still-not-allowed"]),
    )
    events: list[Any] = []

    result = await LangGraphAgentRunner(retriever, stages).run_turn(turn(), events.append)

    assert isinstance(result, TerminalResult)
    assert result.outcome == "failed"
    assert result.code == "invalid_citations"
    assert stages.grounded_calls == 1
    assert stages.repair_calls == 1
    assert not any(event.event_type == "answer.completed" for event in events)
    assert not any(event.event_type == "citations.completed" for event in events)
    assert events[-1].event_type == "run.failed"


@pytest.mark.asyncio
async def test_valid_citations_answer_and_emit_monotonic_v1_envelopes() -> None:
    retriever = FakeRetriever([grounded_bundle()])
    stages = FakeStages(RetrievalDecision(needsRetrieval=True, query="passage"))
    events: list[Any] = []

    result = await LangGraphAgentRunner(retriever, stages).run_turn(
        turn("run-valid"), events.append
    )

    assert isinstance(result, AnsweredResult)
    assert result.answer == "Grounded response."
    assert [citation.id for citation in result.citations] == ["p-1"]
    assert result.suggestions == ["What next?"]

    envelopes = [event.as_dict() for event in events]
    assert envelopes[-1]["eventType"] == "run.completed"
    assert all(envelope["schemaVersion"] == "v1" for envelope in envelopes)
    assert all(envelope["runId"] == "run-valid" for envelope in envelopes)
    assert [envelope["sequence"] for envelope in envelopes] == list(range(len(envelopes)))
    assert any(envelope["eventType"] == "citations.completed" for envelope in envelopes)
    retrieval_completed = next(
        envelope
        for envelope in envelopes
        if envelope["eventType"] == "retrieval.completed"
    )
    assert retrieval_completed["payload"]["acceptedSourceIds"] == ["book-1"]
