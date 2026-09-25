from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.rag.retriever import PineconeRetriever
from app.rag.types import GroundedBundle, InsufficientEvidenceBundle, UnavailableBundle


def settings(**overrides: object) -> SimpleNamespace:
    values = {
        "PINECONE_API_KEY": "test-key",
        "PINECONE_INDEX_NAME": "test-index",
        "PINECONE_NAMESPACE": "pali",
        "PINECONE_CORPUS_REVISION": "rev-1",
        "PINECONE_EMBEDDING_MODEL": "test-embedder",
        "RAG_CANDIDATE_TOP_K": 20,
        "RAG_ACCEPTED_TOP_K": 8,
        "RAG_MIN_SCORE": 0.5,
        "RAG_MAX_CONTEXT_CHARS": 12_000,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def match(
    identifier: str,
    *,
    score: object = 0.9,
    revision: str = "rev-1",
    text: str = "A grounded passage.",
    metadata: dict[str, object] | None = None,
) -> dict[str, object]:
    values: dict[str, object] = {
        "id": identifier,
        "score": score,
        "metadata": {
            "text": text,
            "source": "book-1",
            "title": "Chapter 1",
            "section": "§1",
            "corpusRevision": revision,
        },
    }
    if metadata is not None:
        values["metadata"] = metadata
    return values


@pytest.mark.asyncio
async def test_retriever_discards_untrusted_metadata_and_scores() -> None:
    valid = match("valid")
    malformed_metadata = {"text": "missing source", "title": "Chapter 1", "corpusRevision": "rev-1"}
    matches = [
        valid,
        match("stale", revision="old-revision"),
        match("missing", metadata=malformed_metadata),
        match("nan", score=float("nan")),
        match("infinite", score=float("inf")),
        match("negative-infinite", score=float("-inf")),
        match("bool", score=True),
        match("string", score="0.9"),
        match("overflow", score=10**10_000),
    ]

    retriever = PineconeRetriever(
        settings=settings(),
        embedder=lambda query: [len(query)],
        query_fn=lambda *_args: {"matches": matches},
    )

    result = await retriever.retrieve("  valid query  ", attempt=1)

    assert isinstance(result, GroundedBundle)
    assert [passage.id for passage in result.passages] == ["valid"]
    assert [citation.id for citation in result.citations] == ["valid"]
    assert "A grounded passage." in result.context
    assert "stale" not in result.context



@pytest.mark.asyncio
async def test_retriever_returns_unavailable_when_all_scores_are_malformed() -> None:
    retriever = PineconeRetriever(
        settings=settings(),
        embedder=lambda _query: [0.1],
        query_fn=lambda *_args: {"matches": [match("malformed", score=float("nan"))]},
    )

    result = await retriever.retrieve("query", attempt=1)

    assert isinstance(result, UnavailableBundle)
    assert result.status == "unavailable"
    assert result.error_code == "vector_store_unavailable"


@pytest.mark.asyncio
async def test_retriever_passes_scope_and_applies_accepted_bound() -> None:
    seen: dict[str, object] = {}

    def query(
        embedding: list[int],
        top_k: int,
        namespace: str,
        metadata_filter: dict[str, object] | None,
    ) -> dict[str, object]:
        seen.update(
            embedding=embedding,
            top_k=top_k,
            namespace=namespace,
            metadata_filter=metadata_filter,
        )
        return {
            "matches": [
                match("high", score=0.95),
                match("middle", score=0.8),
                match("low", score=0.7),
            ]
        }

    retriever = PineconeRetriever(
        settings=settings(RAG_CANDIDATE_TOP_K=3, RAG_ACCEPTED_TOP_K=2),
        embedder=lambda query: [len(query)],
        query_fn=query,
    )

    result = await retriever.retrieve(
        "query", attempt=1, access_scope={"volume": "1", "language": "pali"}
    )

    assert isinstance(result, GroundedBundle)
    assert seen == {
        "embedding": [5],
        "top_k": 3,
        "namespace": "pali",
        "metadata_filter": {"volume": "1", "language": "pali"},
    }
    assert [passage.id for passage in result.passages] == ["high", "middle"]
    assert [citation.id for citation in result.citations] == ["high", "middle"]


@pytest.mark.asyncio
async def test_retriever_stops_context_at_configured_bound() -> None:
    retriever = PineconeRetriever(
        settings=settings(RAG_MAX_CONTEXT_CHARS=1_200),
        embedder=lambda _query: [0.1],
        query_fn=lambda *_args: {
            "matches": [
                match("first", score=0.9, text="a" * 900),
                match("second", score=0.8, text="b" * 900),
            ]
        },
    )

    result = await retriever.retrieve("query", attempt=1)

    assert isinstance(result, GroundedBundle)
    assert len(result.context) <= 1_200
    assert [passage.id for passage in result.passages] == ["first"]
    assert [citation.id for citation in result.citations] == ["first"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("embedder", "query_fn", "error_code"),
    [
        (lambda _query: (_ for _ in ()).throw(RuntimeError("embedding")), lambda *_args: {}, "embedding_unavailable"),
        (lambda _query: [0.1], lambda *_args: (_ for _ in ()).throw(RuntimeError("query")), "vector_store_unavailable"),
    ],
)
async def test_retriever_returns_typed_unavailable_when_sdk_seam_fails(
    embedder: object,
    query_fn: object,
    error_code: str,
) -> None:
    retriever = PineconeRetriever(
        settings=settings(),
        embedder=embedder,  # type: ignore[arg-type]
        query_fn=query_fn,  # type: ignore[arg-type]
    )

    result = await retriever.retrieve("query", attempt=1)

    assert isinstance(result, UnavailableBundle)
    assert result.status == "unavailable"
    assert result.error_code == error_code
    assert result.corpus_revision == "rev-1"


@pytest.mark.asyncio
async def test_retriever_returns_typed_insufficient_outcome_without_accepted_passages() -> None:
    retriever = PineconeRetriever(
        settings=settings(RAG_MIN_SCORE=0.99),
        embedder=lambda _query: [0.1],
        query_fn=lambda *_args: {"matches": [match("weak", score=0.5)]},
    )

    result = await retriever.retrieve("query", attempt=1)

    assert isinstance(result, InsufficientEvidenceBundle)
    assert result.status == "insufficient-evidence"
    assert result.passages == []
    assert result.citations == []
