from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol, TypeAlias


@dataclass(frozen=True, slots=True)
class RetrievalRequest:
    query: str
    attempt: int


@dataclass(frozen=True, slots=True)
class Citation:
    id: str
    source: str
    title: str
    source_version: str | None = field(default=None, kw_only=True)
    section: str | None = field(default=None, kw_only=True)
    parent_id: str | None = field(default=None, kw_only=True)


@dataclass(frozen=True, slots=True)
class GroundingPassage(Citation):
    text: str
    score: float
    parent_text: str | None = field(default=None, kw_only=True)


RerankerFallbackReason: TypeAlias = Literal[
    "disabled", "timeout", "unavailable", "invalid-output", "cancelled"
]

@dataclass(frozen=True, slots=True)
class RetrievalMetrics:
    candidate_count: int
    accepted_count: int
    hierarchy_expansion: bool
    reranker_used: bool
    reranker_fallback_reason: RerankerFallbackReason | None = field(
        default=None, kw_only=True
    )
    reranker_latency_ms: float | None = field(default=None, kw_only=True)
    reranker_model_version: str | None = field(default=None, kw_only=True)
    retrieval_config_version: str | None = field(default=None, kw_only=True)

@dataclass(frozen=True, slots=True)
class GroundedBundle:
    status: Literal["grounded"]
    query: str
    corpus_revision: str
    passages: list[GroundingPassage]
    citations: list[Citation]
    context: str
    retrieval_metrics: RetrievalMetrics | None = None

@dataclass(frozen=True, slots=True)
class InsufficientEvidenceBundle:
    status: Literal["insufficient-evidence"]
    query: str
    corpus_revision: str
    passages: list[GroundingPassage]
    citations: list[Citation]
    retrieval_metrics: RetrievalMetrics | None = None

@dataclass(frozen=True, slots=True)
class UnavailableBundle:
    status: Literal["unavailable"]
    query: str
    corpus_revision: str
    error_code: Literal["embedding_unavailable", "vector_store_unavailable"]


GroundingBundle: TypeAlias = (
    GroundedBundle | InsufficientEvidenceBundle | UnavailableBundle
)


class Retriever(Protocol):
    async def retrieve(
        self,
        query: str,
        attempt: int,
        access_scope: dict[str, object] | None = None,
    ) -> GroundingBundle: ...
