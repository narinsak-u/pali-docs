from __future__ import annotations

import asyncio
import inspect
import math
from collections.abc import Callable, Mapping, Sequence
from numbers import Real
from typing import Any

from app.config import Settings, get_settings

from .types import (
    Citation,
    GroundedBundle,
    GroundingBundle,
    GroundingPassage,
    InsufficientEvidenceBundle,
    UnavailableBundle,
)

EmbeddingFn = Callable[[str], Any]
QueryFn = Callable[[Sequence[float], int, str, Mapping[str, object] | None], Any]


class RetrievalIntegrityError(ValueError):
    """Raised when a vector response contains unusable score data."""




def _value(value: object, name: str, default: object = None) -> object:
    if isinstance(value, Mapping):
        return value.get(name, default)
    return getattr(value, name, default)


def _non_empty_string(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value
    return None


def _escape_xml(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _format_passage(passage: GroundingPassage) -> str:
    section = (
        f' section="{_escape_xml(passage.section)}"'
        if passage.section is not None
        else ""
    )
    return (
        f'<passage id="{_escape_xml(passage.id)}" '
        f'source="{_escape_xml(passage.source)}" '
        f'title="{_escape_xml(passage.title)}"{section}>\n'
        f"{_escape_xml(passage.text)}\n</passage>"
    )


def _expand_by_parent(passages: list[GroundingPassage]) -> list[GroundingPassage]:
    groups: dict[str, list[GroundingPassage]] = {}
    for passage in passages:
        if passage.parent_id is None:
            continue
        groups.setdefault(passage.parent_id, []).append(passage)

    expanded: list[GroundingPassage] = []
    seen_parents: set[str] = set()
    for passage in passages:
        parent_id = passage.parent_id
        if parent_id is None:
            expanded.append(passage)
            continue
        if parent_id in seen_parents:
            continue
        seen_parents.add(parent_id)
        expanded.extend(groups.get(parent_id, [passage]))
    return expanded


class PineconeRetriever:
    """Application-owned, fail-closed retrieval policy around Pinecone."""

    def __init__(
        self,
        settings: Settings | Any | None = None,
        embedder: EmbeddingFn | None = None,
        query_fn: QueryFn | None = None,
        client: Any | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self._client = client
        self._embedder = embedder or self._embed_with_pinecone
        self._query_fn = query_fn or self._query_pinecone

    async def retrieve(
        self,
        query: str,
        attempt: int,
        access_scope: Mapping[str, object] | None = None,
    ) -> GroundingBundle:
        del attempt
        config = self.settings
        normalized_query = query.strip()
        if not normalized_query:
            return self._insufficient(normalized_query)

        try:
            embedding = await self._off_loop(self._embedder, normalized_query)
        except Exception:
            return UnavailableBundle(
                status="unavailable",
                query=normalized_query,
                corpus_revision=config.PINECONE_CORPUS_REVISION,
                error_code="embedding_unavailable",
            )

        try:
            scope_filter = None if access_scope is None else dict(access_scope)
            result = await self._off_loop(
                self._query_fn,
                embedding,
                config.RAG_CANDIDATE_TOP_K,
                config.PINECONE_NAMESPACE,
                scope_filter,
            )
        except Exception:
            return UnavailableBundle(
                status="unavailable",
                query=normalized_query,
                corpus_revision=config.PINECONE_CORPUS_REVISION,
                error_code="vector_store_unavailable",
            )

        try:
            selected = self._select_passages(result)
        except RetrievalIntegrityError:
            return UnavailableBundle(
                status="unavailable",
                query=normalized_query,
                corpus_revision=config.PINECONE_CORPUS_REVISION,
                error_code="vector_store_unavailable",
            )
        if selected is None:
            return self._insufficient(normalized_query)

        passages, context = selected
        return GroundedBundle(
            status="grounded",
            query=normalized_query,
            corpus_revision=config.PINECONE_CORPUS_REVISION,
            passages=passages,
            citations=[
                Citation(
                    id=passage.id,
                    source=passage.source,
                    title=passage.title,
                    section=passage.section,
                )
                for passage in passages
            ],
            context=context,
        )

    async def _off_loop(self, function: Callable[..., Any], *args: Any) -> Any:
        result = await asyncio.to_thread(function, *args)
        if inspect.isawaitable(result):
            return await result
        return result

    def _get_client(self) -> Any:
        if self._client is None:
            from pinecone import Pinecone

            self._client = Pinecone(api_key=self.settings.PINECONE_API_KEY)
        return self._client

    def _embed_with_pinecone(self, query: str) -> list[float]:
        result = self._get_client().inference.embed(
            model=self.settings.PINECONE_EMBEDDING_MODEL,
            inputs=[query],
            parameters={"input_type": "query", "truncate": "END"},
        )
        data = _value(result, "data", result)
        first = data[0] if isinstance(data, Sequence) and not isinstance(data, (str, bytes)) and data else None
        values = _value(first, "values")
        if not isinstance(values, Sequence) or isinstance(values, (str, bytes)):
            raise ValueError("Pinecone embedding response is missing vector values")
        return list(values)

    def _query_pinecone(
        self,
        embedding: Sequence[float],
        top_k: int,
        namespace: str,
        metadata_filter: Mapping[str, object] | None,
    ) -> Any:
        index = self._get_client().Index(self.settings.PINECONE_INDEX_NAME)
        options: dict[str, object] = {
            "vector": list(embedding),
            "top_k": top_k,
            "namespace": namespace,
            "include_metadata": True,
        }
        if metadata_filter is not None:
            options["filter"] = dict(metadata_filter)
        return index.query(**options)

    def _matches(self, result: object) -> Sequence[object]:
        if isinstance(result, Sequence) and not isinstance(result, (str, bytes)):
            return result
        matches = _value(result, "matches", ())
        if isinstance(matches, Sequence) and not isinstance(matches, (str, bytes)):
            return matches
        return ()

    def _passages(self, result: object) -> list[GroundingPassage]:
        revision = self.settings.PINECONE_CORPUS_REVISION
        passages: list[GroundingPassage] = []
        malformed_score = False
        for match in self._matches(result):
            match_id = _non_empty_string(_value(match, "id"))
            metadata = _value(match, "metadata")
            if not isinstance(metadata, Mapping) or match_id is None:
                continue

            text = _non_empty_string(metadata.get("text"))
            source = _non_empty_string(metadata.get("source"))
            title = _non_empty_string(metadata.get("title"))
            corpus_revision = _non_empty_string(metadata.get("corpusRevision"))
            if (
                text is None
                or source is None
                or title is None
                or corpus_revision is None
                or corpus_revision != revision
            ):
                continue

            score = _value(match, "score")
            if isinstance(score, bool) or not isinstance(score, Real):
                malformed_score = True
                continue
            try:
                score_float = float(score)
            except (OverflowError, TypeError, ValueError):
                malformed_score = True
                continue
            if not math.isfinite(score_float):
                malformed_score = True
                continue

            section = _non_empty_string(metadata.get("section"))
            parent_id = _non_empty_string(metadata.get("parentId"))
            passages.append(
                GroundingPassage(
                    id=match_id,
                    source=source,
                    title=title,
                    section=section,
                    text=text,
                    score=score_float,
                    parent_id=parent_id,
                )
            )
        if malformed_score and not passages:
            raise RetrievalIntegrityError("Pinecone returned malformed scores")
        return passages

    def _select_passages(
        self,
        result: object,
    ) -> tuple[list[GroundingPassage], str] | None:
        config = self.settings
        ranked = sorted(
            (
                (index, passage)
                for index, passage in enumerate(self._passages(result))
                if passage.score >= config.RAG_MIN_SCORE
            ),
            key=lambda item: (-item[1].score, item[0]),
        )

        unique: list[GroundingPassage] = []
        seen_ids: set[str] = set()
        for _, passage in ranked:
            if passage.id in seen_ids:
                continue
            seen_ids.add(passage.id)
            unique.append(passage)

        ordered = _expand_by_parent(unique) if config.RAG_HIERARCHY_EXPANSION else unique


        header = (
            '<retrieved-passages corpus-revision="'
            f'{_escape_xml(config.PINECONE_CORPUS_REVISION)}">'
        )
        footer = "</retrieved-passages>"
        context_length = len(header) + 1 + len(footer)
        accepted: list[GroundingPassage] = []
        formatted: list[str] = []

        for passage in ordered:
            if len(accepted) >= config.RAG_ACCEPTED_TOP_K:
                break
            rendered = _format_passage(passage)
            if context_length + 1 + len(rendered) > config.RAG_MAX_CONTEXT_CHARS:
                break
            context_length += 1 + len(rendered)
            accepted.append(passage)
            formatted.append(rendered)

        if not accepted:
            return None
        return accepted, f"{header}\n" + "\n".join(formatted) + f"\n{footer}"

    def _insufficient(self, query: str) -> InsufficientEvidenceBundle:
        return InsufficientEvidenceBundle(
            status="insufficient-evidence",
            query=query,
            corpus_revision=self.settings.PINECONE_CORPUS_REVISION,
            passages=[],
            citations=[],
        )
