from __future__ import annotations

import asyncio
import inspect
import math
import time
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
    RerankerFallbackReason,
    RetrievalMetrics,
    UnavailableBundle,
)
from .reranker import rerank_candidates


EmbeddingFn = Callable[[str], Any]
QueryFn = Callable[[Sequence[float], int, str, Mapping[str, object] | None], Any]
RerankFn = Callable[[str, list[GroundingPassage], int], Any]


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
    source_version = (
        f' source-version="{_escape_xml(passage.source_version)}"'
        if passage.source_version is not None
        else ""
    )
    section = (
        f' section="{_escape_xml(passage.section)}"'
        if passage.section is not None
        else ""
    )
    parent_id = (
        f' parent-id="{_escape_xml(passage.parent_id)}"'
        if passage.parent_id is not None
        else ""
    )
    return (
        f'<passage id="{_escape_xml(passage.id)}" '
        f'source="{_escape_xml(passage.source)}"'
        f"{source_version} "
        f'title="{_escape_xml(passage.title)}"{section}{parent_id}>\n'
        f"{_escape_xml(passage.text)}\n</passage>"
    )

def _add_parent_context(passage: GroundingPassage) -> GroundingPassage:
    if passage.parent_text is None:
        return passage
    return GroundingPassage(
        id=passage.id,
        source=passage.source,
        title=passage.title,
        source_version=passage.source_version,
        section=passage.section,
        parent_id=passage.parent_id,
        text=f"{passage.parent_text}\n\n{passage.text}",
        score=passage.score,
        parent_text=passage.parent_text,
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
        expanded.extend(
            _add_parent_context(candidate) if index == 0 else candidate
            for index, candidate in enumerate(groups.get(parent_id, [passage]))
        )
    return expanded

def _is_valid_reranked(
    candidates: list[GroundingPassage],
    reranked: object,
    max_candidates: int,
) -> bool:
    if not isinstance(reranked, list):
        return False
    expected_count = min(len(candidates), max_candidates)
    if (
        len(reranked) != expected_count
        or not all(isinstance(item, GroundingPassage) for item in reranked)
    ):
        return False
    candidate_by_id = {item.id: item for item in candidates}
    reranked_ids = [item.id for item in reranked]
    return (
        len(set(reranked_ids)) == expected_count
        and set(reranked_ids) <= candidate_by_id.keys()
        and all(candidate_by_id[item.id] == item for item in reranked)
    )


class PineconeRetriever:
    """Application-owned, fail-closed retrieval policy around Pinecone."""

    def __init__(
        self,
        settings: Settings | Any | None = None,
        embedder: EmbeddingFn | None = None,
        query_fn: QueryFn | None = None,
        client: Any | None = None,
        rerank_fn: RerankFn | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self._client = client
        self._embedder = embedder or self._embed_with_pinecone
        self._query_fn = query_fn or self._query_pinecone
        self._rerank_fn = rerank_fn or rerank_candidates

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
            candidates = self._passages(result)
        except RetrievalIntegrityError:
            return UnavailableBundle(
                status="unavailable",
                query=normalized_query,
                corpus_revision=config.PINECONE_CORPUS_REVISION,
                error_code="vector_store_unavailable",
            )

        candidate_count = len(candidates)
        reranker_used = False
        reranker_fallback_reason: RerankerFallbackReason | None = (
            None if config.RAG_RERANKER_ENABLED else "disabled"
        )
        reranker_latency_ms = 0.0
        reranker_model_version = (
            "lexical-v1" if config.RAG_RERANKER_ENABLED else None
        )
        retrieval_config_version = "rag-v1"

        if config.RAG_RERANKER_ENABLED:
            dense_candidates = candidates
            rerank_candidates = dense_candidates[
                : config.RAG_RERANKER_MAX_CANDIDATES
            ]
            reranker_started_at = time.perf_counter()
            try:
                reranked = await asyncio.wait_for(
                    self._off_loop(
                        self._rerank_fn,
                        normalized_query,
                        rerank_candidates,
                        config.RAG_RERANKER_MAX_CANDIDATES,
                    ),
                    timeout=config.RAG_RERANKER_TIMEOUT_MS / 1000,
                )
                reranker_latency_ms = (
                    time.perf_counter() - reranker_started_at
                ) * 1000
                if _is_valid_reranked(
                    rerank_candidates,
                    reranked,
                    config.RAG_RERANKER_MAX_CANDIDATES,
                ):
                    candidates = reranked
                    reranker_used = True
                else:
                    reranker_fallback_reason = "invalid-output"
                    candidates = dense_candidates
            except asyncio.TimeoutError:
                reranker_latency_ms = (
                    time.perf_counter() - reranker_started_at
                ) * 1000
                reranker_fallback_reason = "timeout"
                candidates = dense_candidates
            except Exception:
                reranker_latency_ms = (
                    time.perf_counter() - reranker_started_at
                ) * 1000
                reranker_fallback_reason = "unavailable"
                candidates = dense_candidates
        selected = self._select_passages(
            candidates, preserve_order=reranker_used
        )
        if selected is None:
            return self._insufficient(
                normalized_query,
                RetrievalMetrics(
                    candidate_count=candidate_count,
                    accepted_count=0,
                    hierarchy_expansion=config.RAG_HIERARCHY_EXPANSION,
                    reranker_used=reranker_used,
                    reranker_fallback_reason=reranker_fallback_reason,
                    reranker_latency_ms=reranker_latency_ms,
                    reranker_model_version=reranker_model_version,
                    retrieval_config_version=retrieval_config_version,
                ),
            )

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
                    source_version=passage.source_version,
                    section=passage.section,
                    parent_id=passage.parent_id,
                )
                for passage in passages
            ],
            context=context,
            retrieval_metrics=RetrievalMetrics(
                candidate_count=candidate_count,
                accepted_count=len(passages),
                hierarchy_expansion=config.RAG_HIERARCHY_EXPANSION,
                reranker_used=reranker_used,
                reranker_fallback_reason=reranker_fallback_reason,
                reranker_latency_ms=reranker_latency_ms,
                reranker_model_version=reranker_model_version,
                retrieval_config_version=retrieval_config_version,
            ),
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
        first = (
            data[0]
            if isinstance(data, Sequence)
            and not isinstance(data, (str, bytes))
            and data
            else None
        )
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
            raw_source_id = metadata.get("sourceId")
            source_id = _non_empty_string(raw_source_id)
            source_version = _non_empty_string(metadata.get("sourceVersion"))
            title = _non_empty_string(metadata.get("title"))
            corpus_revision = _non_empty_string(metadata.get("corpusRevision"))
            section = _non_empty_string(metadata.get("section"))
            parent_id = _non_empty_string(metadata.get("parentId"))
            parent_text = _non_empty_string(metadata.get("parentText"))
            if (
                text is None
                or source is None
                or source_version is None
                or title is None
                or corpus_revision is None
                or corpus_revision != revision
                or (
                    raw_source_id is not None
                    and (source_id is None or source_id != source)
                )
                or (
                    self.settings.RAG_HIERARCHY_EXPANSION
                    and (section is None or parent_id is None or parent_text is None)
                )
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

            passages.append(
                GroundingPassage(
                    id=match_id,
                    source=source,
                    title=title,
                    source_version=source_version,
                    section=section,
                    parent_id=parent_id,
                    text=text,
                    score=score_float,
                    parent_text=parent_text,
                )
            )
        if malformed_score and not passages:
            raise RetrievalIntegrityError("Pinecone returned malformed scores")
        return passages

    def _select_passages(
        self,
        candidates: list[GroundingPassage],
        preserve_order: bool = False,
    ) -> tuple[list[GroundingPassage], str] | None:
        config = self.settings
        ranked = [
            (index, passage)
            for index, passage in enumerate(candidates)
            if passage.score >= config.RAG_MIN_SCORE
        ]
        if not preserve_order:
            ranked.sort(key=lambda item: (-item[1].score, item[0]))
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

    def _insufficient(
        self,
        query: str,
        retrieval_metrics: RetrievalMetrics | None = None,
    ) -> InsufficientEvidenceBundle:
        return InsufficientEvidenceBundle(
            status="insufficient-evidence",
            query=query,
            corpus_revision=self.settings.PINECONE_CORPUS_REVISION,
            passages=[],
            citations=[],
            retrieval_metrics=retrieval_metrics,
        )
