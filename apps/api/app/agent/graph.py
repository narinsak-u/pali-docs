from __future__ import annotations

import asyncio
import inspect
import operator
from collections.abc import Awaitable, Callable, Mapping
from typing import Annotated, Literal, cast
from typing_extensions import TypedDict
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from app.rag.types import GroundedBundle, GroundingBundle

from .types import (
    AgentModelStages,
    AgentRetriever,
    AgentTurnInput,
    AgentTurnResult,
    AnsweredResult,
    CitationRepair,
    DirectAnswer,
    GroundedAnswer,
    QueryRewrite,
    RetrievalDecision,
    Suggestions,
    TerminalResult,
)

MAX_RETRIEVAL_ATTEMPTS = 2
MAX_CITATION_REPAIRS = 1

EventType = Literal[
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


class GraphEvent(TypedDict):
    event_type: EventType
    payload: dict[str, object]


class AgentGraphState(TypedDict, total=False):
    input: AgentTurnInput
    decision: RetrievalDecision
    query: str
    retrieval_attempt: int
    grounding: GroundingBundle
    retrieval_failed: bool
    answer_draft: GroundedAnswer
    answer: str
    citations: list[object]
    suggestions: list[str]
    citation_repair_count: int
    citation_valid: bool
    result: AgentTurnResult
    events: Annotated[list[GraphEvent], operator.add]


class RunAborted(Exception):
    """Internal control flow used to stop graph execution on cancellation."""


def _configurable(config: object) -> dict[str, object]:
    if not isinstance(config, Mapping):
        return {}
    value = config.get("configurable", {})
    return dict(value) if isinstance(value, Mapping) else {}


def _cancel_observation(config: object) -> object | None:
    return _configurable(config).get("cancellation")


def is_cancelled(observation: object | None) -> bool:
    if observation is None:
        return False
    if callable(observation):
        try:
            return bool(observation())
        except TypeError:
            return False
    for method_name in ("is_cancelled", "is_set", "cancelled"):
        method = getattr(observation, method_name, None)
        if callable(method):
            return bool(method())
        if method is not None:
            return bool(method)
    return bool(observation) if isinstance(observation, bool) else False


def check_cancelled(config: object) -> None:
    if is_cancelled(_cancel_observation(config)):
        raise RunAborted


def _async_event(observation: object | None) -> asyncio.Event | None:
    return observation if isinstance(observation, asyncio.Event) else None


async def await_with_cancellation(
    awaitable: Awaitable[object], observation: object | None
) -> object:
    check_cancelled({"configurable": {"cancellation": observation}})
    task = asyncio.ensure_future(awaitable)
    event = _async_event(observation)
    if event is None:
        try:
            result = await task
        finally:
            check_cancelled({"configurable": {"cancellation": observation}})
        return result

    if event.is_set():
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        raise RunAborted

    cancellation_task = asyncio.create_task(event.wait())
    done, _ = await asyncio.wait(
        (task, cancellation_task), return_when=asyncio.FIRST_COMPLETED
    )
    if cancellation_task in done and task not in done:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        raise RunAborted
    cancellation_task.cancel()
    await asyncio.gather(cancellation_task, return_exceptions=True)
    result = await task
    check_cancelled({"configurable": {"cancellation": observation}})
    return result


async def _call(
    function: Callable[..., Awaitable[object] | object],
    *args: object,
    config: object,
) -> object:
    check_cancelled(config)
    try:
        parameters = inspect.signature(function).parameters
    except (TypeError, ValueError):
        parameters = {}
    if "config" in parameters:
        result = function(*args, config=config)
    else:
        result = function(*args)
    if inspect.isawaitable(result):
        result = await await_with_cancellation(result, _cancel_observation(config))
    check_cancelled(config)
    return result




async def _emit_immediate(config: object, event: GraphEvent) -> None:
    callback = _configurable(config).get("event_emitter")
    if not callable(callback):
        return
    result = callback(event)
    if inspect.isawaitable(result):
        await result

def _event(run_id: str, event_type: EventType, **payload: object) -> GraphEvent:
    return {"event_type": event_type, "payload": {"runId": run_id, **payload}}


def _input(state: AgentGraphState) -> AgentTurnInput:
    return state["input"]


def _run_id(state: AgentGraphState) -> str:
    return _input(state).run_id


def _cited_sources(grounding: GroundedBundle, citation_ids: list[str]) -> list[object] | None:
    if not citation_ids:
        return None
    citations_by_id = {citation.id: citation for citation in grounding.citations}
    selected: list[object] = []
    seen: set[str] = set()
    for citation_id in citation_ids:
        citation = citations_by_id.get(citation_id)
        if citation is None:
            return None
        if citation_id not in seen:
            seen.add(citation_id)
            selected.append(citation)
    return selected


def _unavailable_code(bundle: GroundingBundle | None) -> str:
    if bundle is not None and bundle.status == "unavailable":
        return bundle.error_code
    return "retrieval_error"
async def _classify(
    state: AgentGraphState, config: object
) -> RetrievalDecision:
    stages = _configurable(config)["stages"]
    return cast(RetrievalDecision, await stages.classify(_input(state)))



async def classify_node(state: AgentGraphState, config: object) -> dict[str, object]:
    raw = await _call(_classify, state, config=config)
    decision = (
        raw
        if isinstance(raw, RetrievalDecision)
        else RetrievalDecision.model_validate(raw)
    )
    return {"decision": decision, "query": decision.query}

def route_after_classify(
    state: AgentGraphState,
) -> Literal["direct_answer", "retrieve"]:
    decision = state.get("decision")
    if decision is None:
        raise RuntimeError("classification is required before routing")
    return "retrieve" if decision.needs_retrieval else "direct_answer"

async def direct_answer_node(state: AgentGraphState, config: object) -> dict[str, object]:
    check_cancelled(config)
    await _emit_immediate(config, _event(_run_id(state), "generation.started"))
    raw = await _call(_direct_answer, state, config=config)
    result = raw if isinstance(raw, DirectAnswer) else DirectAnswer.model_validate(raw)
    run_id = _run_id(state)
    return {
        "answer": result.answer,
        "citations": [],
        "events": [
            _event(run_id, "answer.completed", text=result.answer),
            _event(run_id, "citations.completed", citations=[]),
        ],
    }


async def _direct_answer(state: AgentGraphState, config: object) -> DirectAnswer:
    stages = _configurable(config)["stages"]
    return cast(DirectAnswer, await stages.direct_answer(_input(state)))


async def retrieve_node(state: AgentGraphState, config: object) -> dict[str, object]:
    check_cancelled(config)
    attempt = state.get("retrieval_attempt", 0) + 1
    query = state["query"]
    run_id = _run_id(state)
    started = _event(
        run_id,
        "retrieval.started",
        attempt=attempt,
        query=query,
    )
    await _emit_immediate(config, started)
    retriever = _configurable(config)["retriever"]
    try:
        bundle = cast(
            GroundingBundle,
            await _call(
                retriever.retrieve,
                query,
                attempt,
                *(
                    (_input(state).access_scope,)
                    if _input(state).access_scope is not None
                    else ()
                ),
                config=config,
            ),
        )
    except RunAborted:
        await _emit_immediate(
            config, _event(run_id, "retrieval.failed", code="aborted")
        )
        raise
    except asyncio.CancelledError:
        await _emit_immediate(
            config, _event(run_id, "retrieval.failed", code="aborted")
        )
        raise
    except Exception:
        if is_cancelled(_cancel_observation(config)):
            await _emit_immediate(
                config, _event(run_id, "retrieval.failed", code="aborted")
            )
            raise RunAborted
        await _emit_immediate(
            config, _event(run_id, "retrieval.failed", code="retrieval_error")
        )
        return {
            "retrieval_attempt": attempt,
            "retrieval_failed": True,
            "result": TerminalResult(outcome="failed", code="retrieval_error"),
            "events": [],
        }

    if bundle.status == "unavailable":
        await _emit_immediate(
            config, _event(run_id, "retrieval.failed", code=bundle.error_code)
        )
        return {
            "retrieval_attempt": attempt,
            "grounding": bundle,
            "retrieval_unavailable": True,
            "events": [],
        }

    match_count = len(bundle.passages) if bundle.status == "grounded" else 0
    accepted_source_ids = (
        [passage.source for passage in bundle.passages]
        if bundle.status == "grounded"
        else []
    )
    return {
        "retrieval_attempt": attempt,
        "grounding": bundle,
        "retrieval_unavailable": False,
        "events": [
            _event(
                run_id,
                "retrieval.completed",
                attempt=attempt,
                matchCount=match_count,
                acceptedSourceIds=accepted_source_ids,
            ),
        ],
    }


def route_after_retrieval(
    state: AgentGraphState,
) -> Literal["unavailable", "rewrite", "answer", "complete"]:
    if state.get("retrieval_failed"):
        return "complete"
    if state.get("retrieval_unavailable"):
        return "unavailable"
    grounding = state.get("grounding")
    if grounding is None:
        return "unavailable"
    if grounding.status == "grounded":
        return "answer"
    if state.get("retrieval_attempt", 0) < MAX_RETRIEVAL_ATTEMPTS:
        return "rewrite"
    return "complete"


async def evidence_policy_node(
    state: AgentGraphState, config: object
) -> dict[str, object]:
    if state.get("retrieval_unavailable"):
        return {}
    grounding = state.get("grounding")
    if (
        grounding is not None
        and grounding.status == "insufficient-evidence"
        and state.get("retrieval_attempt", 0) >= MAX_RETRIEVAL_ATTEMPTS
    ):
        return {"result": TerminalResult(outcome="insufficient-evidence")}
    return {}


async def unavailable_node(state: AgentGraphState, config: object) -> dict[str, object]:
    grounding = state.get("grounding")
    return {
        "result": TerminalResult(
            outcome="retrieval-unavailable", code=_unavailable_code(grounding)
        )
    }


async def rewrite_node(state: AgentGraphState, config: object) -> dict[str, object]:
    check_cancelled(config)
    attempt = state.get("retrieval_attempt", 0) + 1
    raw = await _call(
        _rewrite,
        state,
        state["query"],
        attempt,
        config=config,
    )
    rewrite = raw if isinstance(raw, QueryRewrite) else QueryRewrite.model_validate(raw)
    run_id = _run_id(state)
    return {
        "query": rewrite.query,
        "events": [
            _event(run_id, "query.rewritten", attempt=attempt, query=rewrite.query)
        ],
    }


async def _rewrite(
    state: AgentGraphState, query: str, attempt: int, config: object
) -> QueryRewrite:
    stages = _configurable(config)["stages"]
    return cast(QueryRewrite, await stages.rewrite(_input(state), query, attempt))


async def answer_node(state: AgentGraphState, config: object) -> dict[str, object]:
    check_cancelled(config)
    grounding = state.get("grounding")
    if grounding is None or grounding.status != "grounded":
        raise RuntimeError("answer node requires grounded retrieval")
    await _emit_immediate(config, _event(_run_id(state), "generation.started"))
    raw = await _call(_answer, state, grounding, config=config)
    draft = raw if isinstance(raw, GroundedAnswer) else GroundedAnswer.model_validate(raw)
    return {"answer_draft": draft}


async def _answer(
    state: AgentGraphState, grounding: GroundedBundle, config: object
) -> GroundedAnswer:
    stages = _configurable(config)["stages"]
    return cast(GroundedAnswer, await stages.grounded_answer(_input(state), grounding))


def route_after_evidence_policy(
    state: AgentGraphState,
) -> Literal["unavailable", "rewrite", "answer", "complete"]:
    return route_after_retrieval(state)


async def validate_citations_node(
    state: AgentGraphState, config: object
) -> dict[str, object]:
    check_cancelled(config)
    draft = state.get("answer_draft")
    grounding = state.get("grounding")
    if draft is None or grounding is None or grounding.status != "grounded":
        raise RuntimeError("citation validation requires a grounded answer draft")
    citations = _cited_sources(grounding, draft.citation_ids)
    if citations is None:
        if state.get("citation_repair_count", 0) >= MAX_CITATION_REPAIRS:
            return {
                "citation_valid": False,
                "result": TerminalResult(outcome="failed", code="invalid_citations"),
            }
        return {"citation_valid": False}
    run_id = _run_id(state)
    return {
        "citation_valid": True,
        "answer": draft.answer,
        "citations": citations,
        "events": [
            _event(run_id, "answer.completed", text=draft.answer),
            _event(run_id, "citations.completed", citations=citations),
        ],
    }


def route_after_citation_validation(
    state: AgentGraphState,
) -> Literal["suggestions", "repair", "complete"]:
    if state.get("citation_valid"):
        return "suggestions"
    if state.get("citation_repair_count", 0) < MAX_CITATION_REPAIRS:
        return "repair"
    return "complete"


async def repair_node(state: AgentGraphState, config: object) -> dict[str, object]:
    check_cancelled(config)
    grounding = state.get("grounding")
    draft = state.get("answer_draft")
    if grounding is None or grounding.status != "grounded" or draft is None:
        raise RuntimeError("citation repair requires a grounded draft")
    raw = await _call(_repair, state, grounding, draft, config=config)
    repaired = raw if isinstance(raw, CitationRepair) else CitationRepair.model_validate(raw)
    return {
        "answer_draft": repaired,
        "citation_repair_count": state.get("citation_repair_count", 0) + 1,
    }


async def _repair(
    state: AgentGraphState,
    grounding: GroundedBundle,
    draft: GroundedAnswer,
    config: object,
) -> CitationRepair:
    stages = _configurable(config)["stages"]
    return cast(
        CitationRepair,
        await stages.repair_citations(_input(state), grounding, draft),
    )


async def suggestions_node(state: AgentGraphState, config: object) -> dict[str, object]:
    check_cancelled(config)
    answer = state.get("answer")
    if not answer:
        raise RuntimeError("suggestions require a validated answer")
    stages = _configurable(config)["stages"]
    try:
        raw = await _call(stages.suggestions, _input(state), answer, config=config)
        generated = (
            raw if isinstance(raw, Suggestions) else Suggestions.model_validate(raw)
        )
    except RunAborted:
        raise
    except Exception:
        generated = Suggestions(suggestions=[])
    values = generated.suggestions
    events = (
        [_event(_run_id(state), "suggestions.completed", suggestions=values)]
        if values
        else []
    )
    return {"suggestions": values, "events": events}


async def complete_node(state: AgentGraphState, config: object) -> dict[str, object]:
    check_cancelled(config)
    result = state.get("result")
    if result is None:
        citations = state.get("citations", [])
        answer = state.get("answer")
        if answer is None:
            result = TerminalResult(outcome="failed", code="runner_error")
        else:
            result = AnsweredResult(
                answer=answer,
                citations=citations,
                suggestions=state.get("suggestions", []),
            )
    event_type: EventType = "run.completed" if result.outcome != "failed" else "run.failed"
    payload: dict[str, object] = (
        {"outcome": result.outcome}
        if event_type == "run.completed"
        else {}
    )
    if isinstance(result, TerminalResult) and result.code:
        payload["code"] = result.code
    return {
        "result": result,
        "events": [_event(_run_id(state), event_type, **payload)],
    }

def build_agent_graph(
    retriever: AgentRetriever, stages: AgentModelStages
):
    """Compile the private bounded graph used by the runner."""

    def with_dependencies(config: object) -> dict[str, object]:
        configurable = _configurable(config)
        configurable.setdefault("retriever", retriever)
        configurable.setdefault("stages", stages)
        return {"configurable": configurable}

    async def classify(state: AgentGraphState, config: RunnableConfig) -> dict[str, object]:
        return await classify_node(state, with_dependencies(config))

    async def direct_answer(
        state: AgentGraphState, config: RunnableConfig
    ) -> dict[str, object]:
        return await direct_answer_node(state, with_dependencies(config))

    async def retrieve(state: AgentGraphState, config: RunnableConfig) -> dict[str, object]:
        return await retrieve_node(state, with_dependencies(config))

    async def evidence_policy(
        state: AgentGraphState, config: RunnableConfig
    ) -> dict[str, object]:
        return await evidence_policy_node(state, with_dependencies(config))

    async def unavailable(
        state: AgentGraphState, config: RunnableConfig
    ) -> dict[str, object]:
        return await unavailable_node(state, with_dependencies(config))

    async def rewrite(state: AgentGraphState, config: RunnableConfig) -> dict[str, object]:
        return await rewrite_node(state, with_dependencies(config))

    async def answer(state: AgentGraphState, config: RunnableConfig) -> dict[str, object]:
        return await answer_node(state, with_dependencies(config))

    async def validate_citations(
        state: AgentGraphState, config: RunnableConfig
    ) -> dict[str, object]:
        return await validate_citations_node(state, with_dependencies(config))

    async def repair(state: AgentGraphState, config: RunnableConfig) -> dict[str, object]:
        return await repair_node(state, with_dependencies(config))

    async def suggestions(
        state: AgentGraphState, config: RunnableConfig
    ) -> dict[str, object]:
        return await suggestions_node(state, with_dependencies(config))

    async def complete(state: AgentGraphState, config: RunnableConfig) -> dict[str, object]:
        return await complete_node(state, with_dependencies(config))

    graph = StateGraph(AgentGraphState)
    graph.add_node("classify", classify)
    graph.add_node("direct_answer", direct_answer)
    graph.add_node("retrieve", retrieve)
    graph.add_node("evidence_policy", evidence_policy)
    graph.add_node("unavailable", unavailable)
    graph.add_node("rewrite", rewrite)
    graph.add_node("answer", answer)
    graph.add_node("validate_citations", validate_citations)
    graph.add_node("repair", repair)
    graph.add_node("suggestions", suggestions)
    graph.add_node("complete", complete)
    graph.add_edge(START, "classify")
    graph.add_conditional_edges("classify", route_after_classify)
    graph.add_edge("retrieve", "evidence_policy")
    graph.add_conditional_edges("evidence_policy", route_after_evidence_policy)
    graph.add_edge("rewrite", "retrieve")
    graph.add_edge("answer", "validate_citations")
    graph.add_conditional_edges("validate_citations", route_after_citation_validation)
    graph.add_edge("repair", "validate_citations")
    graph.add_edge("direct_answer", "suggestions")
    graph.add_edge("suggestions", "complete")
    graph.add_edge("unavailable", "complete")
    graph.add_edge("complete", END)
    return graph.compile()


compile_agent_graph = build_agent_graph
route_after_citations = route_after_citation_validation
# Names used by integrations and tests should remain descriptive and stable.
create_agent_graph = build_agent_graph
route_after_decision = route_after_classify
