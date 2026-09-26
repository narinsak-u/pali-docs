from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

import pytest

from app.rag.retriever import PineconeRetriever
from app.rag.types import GroundingPassage


FIXTURE = json.loads(
    (
        Path(__file__).resolve().parents[3]
        / "tests"
        / "fixtures"
        / "retrieval-parity.json"
    ).read_text(encoding="utf-8")
)


def settings(**overrides: object) -> Any:
    values: dict[str, object] = {
        "PINECONE_CORPUS_REVISION": FIXTURE["corpusRevision"],
        "PINECONE_API_KEY": "test-key",
        "PINECONE_INDEX_NAME": "test-index",
        "PINECONE_NAMESPACE": "test",
        "PINECONE_EMBEDDING_MODEL": "test-model",
        "RAG_CANDIDATE_TOP_K": len(FIXTURE["denseMatches"]),
        "RAG_ACCEPTED_TOP_K": len(FIXTURE["denseMatches"]),
        "RAG_MIN_SCORE": 0.7,
        "RAG_HIERARCHY_EXPANSION": False,
        "RAG_RERANKER_ENABLED": False,
        "RAG_RERANKER_MAX_CANDIDATES": len(FIXTURE["rerankedPrefixIds"]),
        "RAG_RERANKER_TIMEOUT_MS": 100,
        "RAG_MAX_CONTEXT_CHARS": 2_000,
        "RAG_MAX_PARENT_CONTEXT_CHARS": FIXTURE["maxParentContextChars"],
    }
    values.update(overrides)
    return type("ParitySettings", (), values)()


def grounded_matches() -> list[dict[str, object]]:
    return [dict(match) for match in FIXTURE["denseMatches"]]


@pytest.mark.asyncio
async def test_shared_fixture_rejects_stale_and_forged_metadata_before_grounding() -> None:
    retriever = PineconeRetriever(
        settings=settings(),
        embedder=lambda _query: [0.1],
        query_fn=lambda *_args: {"matches": FIXTURE["invalidMatches"]},
    )

    result = await retriever.retrieve("parity", attempt=1)

    assert result.status == "insufficient-evidence"
    assert result.passages == []
    assert result.retrieval_metrics is not None
    assert result.retrieval_metrics.candidate_count == 0


@pytest.mark.asyncio
async def test_shared_fixture_expands_bounded_hierarchy_and_projects_child_citations() -> None:
    retriever = PineconeRetriever(
        settings=settings(RAG_HIERARCHY_EXPANSION=True),
        embedder=lambda _query: [0.1],
        query_fn=lambda *_args: {"matches": grounded_matches()},
    )

    result = await retriever.retrieve("parity", attempt=1)

    assert result.status == "grounded"
    assert [passage.id for passage in result.passages] == FIXTURE["expected"]["expandedIds"]
    assert result.passages[0].parent_text == FIXTURE["expected"]["boundedParentText"]
    assert [citation.id for citation in result.citations] == FIXTURE["expected"]["citationIds"]
    assert "parent-1" not in [citation.id for citation in result.citations]
    assert len(result.context) <= 2_000


@pytest.mark.asyncio
async def test_shared_fixture_preserves_dense_suffix_after_prefix_reranking() -> None:
    def rerank(_query: str, candidates: list[GroundingPassage], _max: int) -> list[GroundingPassage]:
        return [candidates[1], candidates[0]]

    retriever = PineconeRetriever(
        settings=settings(RAG_RERANKER_ENABLED=True),
        embedder=lambda _query: [0.1],
        query_fn=lambda *_args: {"matches": grounded_matches()},
        rerank_fn=rerank,
    )

    result = await retriever.retrieve("parity", attempt=1)

    assert result.status == "grounded"
    assert [passage.id for passage in result.passages] == FIXTURE["expected"]["rerankedIds"]
    assert [passage.id for passage in result.passages[2:]] == FIXTURE["expected"]["denseIds"][2:]


@pytest.mark.asyncio
async def test_shared_fixture_serializes_fallback_metrics_and_citation_projection() -> None:
    def rerank(_query: str, _candidates: list[GroundingPassage], _max: int) -> list[GroundingPassage]:
        raise RuntimeError("provider unavailable")

    retriever = PineconeRetriever(
        settings=settings(RAG_RERANKER_ENABLED=True, RAG_HIERARCHY_EXPANSION=True),
        embedder=lambda _query: [0.1],
        query_fn=lambda *_args: {"matches": grounded_matches()},
        rerank_fn=rerank,
    )

    result = await retriever.retrieve("parity", attempt=1)

    assert result.status == "grounded"
    assert [passage.id for passage in result.passages] == FIXTURE["expected"]["denseIds"]
    assert [citation.id for citation in result.citations] == FIXTURE["expected"]["citationIds"]
    assert result.retrieval_metrics is not None
    serialized = json.loads(json.dumps(asdict(result.retrieval_metrics)))
    assert serialized["candidate_count"] == FIXTURE["expected"]["metrics"]["candidateCount"]
    assert serialized["accepted_count"] == FIXTURE["expected"]["metrics"]["acceptedCount"]
    assert serialized["hierarchy_expansion"] is True
    assert serialized["reranker_used"] is False
    assert serialized["reranker_fallback_reason"] == FIXTURE["expected"]["fallbackReason"]
    assert serialized["reranker_model_version"] == FIXTURE["expected"]["metrics"]["rerankerModelVersion"]
    assert serialized["retrieval_config_version"] == FIXTURE["expected"]["metrics"]["retrievalConfigVersion"]
