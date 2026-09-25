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
    section: str | None = field(default=None, kw_only=True)


@dataclass(frozen=True, slots=True)
class GroundingPassage(Citation):
    text: str
    score: float
    parent_id: str | None = field(default=None, kw_only=True)

@dataclass(frozen=True, slots=True)
class GroundedBundle:
    status: Literal["grounded"]
    query: str
    corpus_revision: str
    passages: list[GroundingPassage]
    citations: list[Citation]
    context: str


@dataclass(frozen=True, slots=True)
class InsufficientEvidenceBundle:
    status: Literal["insufficient-evidence"]
    query: str
    corpus_revision: str
    passages: list[GroundingPassage]
    citations: list[Citation]


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
