from __future__ import annotations

import asyncio
import inspect
import json
import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from numbers import Real
from typing import Any, TypeAlias

from .chunk import _chunk_id, _parent_id
from .config import IngestSettings, get_settings
from .types import Chunk

class PublishError(ValueError):
    """Raised when embedding or staging publication violates the ingest contract."""


@dataclass(frozen=True, slots=True)
class PublishReport:
    revision: str
    namespace: str
    chunk_count: int
    embedded_count: int
    upserted_count: int
    vector_count: int | None = None


EmbedFn: TypeAlias = Callable[[Sequence[str]], Any]
UpsertFn: TypeAlias = Callable[[Sequence[Mapping[str, Any]], str], Any]
StatsFn: TypeAlias = Callable[[str], Any]


def _value(value: object, name: str, default: object = None) -> object:
    if isinstance(value, Mapping):
        return value.get(name, default)
    return getattr(value, name, default)


async def _off_loop(function: Callable[..., Any], *args: Any) -> Any:
    """Run both SDK calls and injected synchronous seams away from the event loop."""
    result = await asyncio.to_thread(function, *args)
    if inspect.isawaitable(result):
        return await result
    return result


def _vectors_from_response(response: object) -> list[object]:
    data = _value(response, "data", response)
    if not isinstance(data, Sequence) or isinstance(data, (str, bytes, bytearray)):
        raise PublishError("Pinecone embedding response is missing vector data")
    return list(data)


def _validated_vector(value: object, index: int) -> list[float]:
    raw = _value(value, "values", value)
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes, bytearray)):
        raise PublishError(f"embedding {index} is missing vector values")
    if not raw:
        raise PublishError(f"embedding {index} is empty")
    vector: list[float] = []
    for component in raw:
        if isinstance(component, bool) or not isinstance(component, Real):
            raise PublishError(f"embedding {index} contains a non-numeric value")
        try:
            numeric = float(component)
        except (OverflowError, TypeError, ValueError) as exc:
            raise PublishError(f"embedding {index} contains an invalid value") from exc
        if not math.isfinite(numeric):
            raise PublishError(f"embedding {index} contains a non-finite value")
        vector.append(numeric)
    return vector


def _metadata_value(value: object, key: str) -> object:
    if isinstance(value, bool):
        return value
    if isinstance(value, Real):
        try:
            numeric = float(value)
        except (OverflowError, TypeError, ValueError) as exc:
            raise PublishError(f"metadata {key!r} is not representable") from exc
        if not math.isfinite(numeric):
            raise PublishError(f"metadata {key!r} is not finite")
        return numeric
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        if not all(isinstance(item, str) for item in value):
            raise PublishError(f"metadata {key!r} contains an unsupported list value")
        return list(value)
    raise PublishError(f"metadata {key!r} is not representable by Pinecone")

def _chunk_metadata(
    chunk: Chunk,
    revision: str,
    *,
    embedding_model: str,
    embedding_input_type: str,
    max_parent_context_chars: int,
    section_index: int,
) -> dict[str, object]:
    acl = chunk.acl_metadata
    if not isinstance(acl, Mapping) or not acl:
        raise PublishError(f"chunk {chunk.id} ACL metadata must be a non-empty mapping")
    if not chunk.section or not chunk.section.strip():
        raise PublishError(f"chunk {chunk.id} is missing section metadata")
    if not chunk.parent_id.strip():
        raise PublishError(f"chunk {chunk.id} is missing parent identity")
    if not chunk.parent_text or not chunk.parent_text.strip():
        raise PublishError(f"chunk {chunk.id} is missing parent_text")
    if max_parent_context_chars < 1:
        raise PublishError("max_parent_context_chars must be positive")
    if chunk.chunking_policy is None:
        raise PublishError(f"chunk {chunk.id} is missing chunking policy")
    bounded_parent_text = chunk.parent_text[:max_parent_context_chars]
    expected_id = _chunk_id(
        chunk.source_id,
        chunk.source_version,
        chunk.chunking_policy,
        chunk.index,
        chunk.text,
    )
    if chunk.id != expected_id:
        raise PublishError(f"chunk {chunk.id} has an inconsistent child identity")
    expected_parent_id = _parent_id(
        chunk.source_id,
        chunk.source_version,
        section_index,
        chunk.section,
    )
    if chunk.parent_id != expected_parent_id:
        raise PublishError(f"chunk {chunk.id} has an inconsistent parent identity")

    metadata: dict[str, object] = {}
    for key, value in acl.items():
        if not isinstance(key, str) or not key.strip():
            raise PublishError(f"chunk {chunk.id} ACL metadata has an invalid key")
        metadata[key] = _metadata_value(value, key)

    metadata.update(
        {
            "text": _metadata_value(chunk.text, "text"),
            "source": _metadata_value(chunk.source_id, "source"),
            "title": _metadata_value(chunk.title, "title"),
            "corpusRevision": _metadata_value(revision, "corpusRevision"),
            "sourceId": _metadata_value(chunk.source_id, "sourceId"),
            "sourceVersion": _metadata_value(chunk.source_version, "sourceVersion"),
            "parentId": _metadata_value(chunk.parent_id, "parentId"),
            "section": _metadata_value(chunk.section, "section"),
            "position": _metadata_value(chunk.index, "position"),
            "embeddingModel": _metadata_value(embedding_model, "embeddingModel"),
            "embeddingInputType": _metadata_value(embedding_input_type, "embeddingInputType"),
            "chunkingPolicy": json.dumps(
                chunk.chunking_policy.to_dict(),
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ),
        }
    )
    metadata["parentText"] = _metadata_value(bounded_parent_text, "parentText")
    return metadata

def _upserted_count(response: object) -> int:
    if isinstance(response, bool):
        raise PublishError("Pinecone upsert response has no count")
    if isinstance(response, int):
        count = response
    else:
        raw = _value(response, "upserted_count")
        if raw is None:
            raw = _value(response, "upsertedCount")
        if isinstance(raw, bool) or not isinstance(raw, int):
            raise PublishError("Pinecone upsert response has no count")
        count = raw
    if count < 0:
        raise PublishError("Pinecone upsert response has an invalid count")
    return count


def _stats_count(response: object, namespace: str) -> int | None:
    if response is None:
        return None
    if isinstance(response, int) and not isinstance(response, bool):
        return response
    direct = _value(response, "vector_count")
    if direct is None:
        direct = _value(response, "vectorCount")
    if isinstance(direct, int) and not isinstance(direct, bool):
        return direct
    namespaces = _value(response, "namespaces")
    if isinstance(namespaces, Mapping):
        entry = namespaces.get(namespace)
        if entry is None:
            return 0
        count = _value(entry, "vector_count")
        if count is None:
            count = _value(entry, "vectorCount")
        if isinstance(count, int) and not isinstance(count, bool):
            return count
        raise PublishError("Pinecone stats response has an invalid vector count")
    return None


class PineconePublisher:
    """Embed chunks and write one immutable revision into a staging namespace."""

    def __init__(
        self,
        settings: IngestSettings | None = None,
        *,
        client: Any | None = None,
        embed_fn: EmbedFn | None = None,
        upsert_fn: UpsertFn | None = None,
        stats_fn: StatsFn | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self._client = client
        self._index: Any | None = None
        self._embed_fn = embed_fn
        self._upsert_fn = upsert_fn
        self._stats_fn = stats_fn

    def _get_client(self) -> Any:
        if self._client is None:
            if not self.settings.pinecone_api_key:
                raise PublishError("pinecone_api_key is required")
            from pinecone import Pinecone

            self._client = Pinecone(api_key=self.settings.pinecone_api_key)
        return self._client

    def _get_index(self) -> Any:
        if self._index is None:
            if not self.settings.pinecone_index_name:
                raise PublishError("pinecone_index_name is required")
            client = self._get_client()
            factory = getattr(client, "Index", None) or getattr(client, "index", None)
            if factory is None:
                raise PublishError("Pinecone client does not expose an index factory")
            self._index = factory(self.settings.pinecone_index_name)
        return self._index

    def _embed_with_pinecone(self, texts: Sequence[str]) -> object:
        return self._get_client().inference.embed(
            model=self.settings.embedding_model,
            inputs=list(texts),
            parameters={"input_type": self.settings.embedding_input_type, "truncate": "END"},
        )

    def _upsert_with_pinecone(
        self, vectors: Sequence[Mapping[str, Any]], namespace: str
    ) -> object:
        return self._get_index().upsert(vectors=list(vectors), namespace=namespace)

    def _stats_with_pinecone(self, _namespace: str) -> object:
        index = self._get_index()
        describe = getattr(index, "describe_index_stats", None)
        if describe is None:
            return None
        return describe()

    async def check_staging_integrity(
        self, revision: str, expected_count: int
    ) -> bool | None:
        """Check staged vector count; return None when the backend exposes no stats."""
        if expected_count < 0:
            raise PublishError("expected_count must be non-negative")
        namespace = self._namespace(revision)
        stats_fn = self._stats_fn or self._stats_with_pinecone
        try:
            response = await _off_loop(stats_fn, namespace)
        except PublishError:
            if self._stats_fn is not None:
                raise
            return None
        count = _stats_count(response, namespace)
        if count is None:
            return None
        if count < expected_count:
            raise PublishError(
                f"staging namespace {namespace!r} contains {count} vectors; "
                f"expected at least {expected_count}"
            )
        return True

    @staticmethod
    def _namespace(revision: str) -> str:
        if not isinstance(revision, str) or not revision.strip():
            raise PublishError("revision must be non-empty")
        if (
            not revision.startswith("rev-")
            or revision != revision.strip()
            or any(char.isspace() for char in revision)
            or "/" in revision
            or "\\" in revision
        ):
            raise PublishError("revision must be a safe rev identifier")
        return f"staging-{revision}"

    async def publish(self, chunks: Sequence[Chunk], revision: str) -> PublishReport:
        namespace = self._namespace(revision)
        chunk_list = tuple(chunks)
        if not chunk_list:
            raise PublishError("cannot publish an empty chunk set")
        chunk_ids = [chunk.id for chunk in chunk_list]
        if len(chunk_ids) != len(set(chunk_ids)):
            raise PublishError("duplicate chunk IDs cannot be published")
        batch_size = self.settings.embedding_batch_size
        if batch_size < 1:
            raise PublishError("embedding_batch_size must be positive")
        positions_by_source: dict[str, int] = {}
        section_indices_by_source: dict[str, int] = {}
        last_parent_by_source: dict[
            str, tuple[str, str, str | None, str | None]
        ] = {}
        parent_section_indices: list[int] = []
        for chunk in chunk_list:
            expected_position = positions_by_source.get(chunk.source_id, 0)
            if chunk.index != expected_position:
                raise PublishError("chunk positions must be deterministic and contiguous")
            positions_by_source[chunk.source_id] = expected_position + 1
            parent_boundary = (
                chunk.source_id,
                chunk.source_version,
                chunk.section,
                chunk.parent_text,
            )
            if chunk.source_id not in section_indices_by_source:
                section_indices_by_source[chunk.source_id] = 0
            elif parent_boundary != last_parent_by_source[chunk.source_id]:
                section_indices_by_source[chunk.source_id] += 1
            last_parent_by_source[chunk.source_id] = parent_boundary
            parent_section_indices.append(section_indices_by_source[chunk.source_id])
        policies = {chunk.chunking_policy for chunk in chunk_list}
        if None in policies or len(policies) != 1:
            raise PublishError("chunks must share one complete chunking policy")

        metadata = [
            _chunk_metadata(
                chunk,
                revision,
                embedding_model=self.settings.embedding_model,
                embedding_input_type=self.settings.embedding_input_type,
                max_parent_context_chars=self.settings.max_parent_context_chars,
                section_index=section_index,
            )
            for chunk, section_index in zip(
                chunk_list, parent_section_indices, strict=True
            )
        ]
        embeddings: list[list[float]] = []
        embed_fn = self._embed_fn or self._embed_with_pinecone
        for start in range(0, len(chunk_list), batch_size):
            batch = chunk_list[start : start + batch_size]
            response = await _off_loop(embed_fn, [chunk.text for chunk in batch])
            returned = _vectors_from_response(response)
            if len(returned) != len(batch):
                raise PublishError(
                    f"embedding count mismatch: received {len(returned)}, expected {len(batch)}"
                )
            vectors = [_validated_vector(value, start + index) for index, value in enumerate(returned)]
            expected_dimension = len(embeddings[0]) if embeddings else len(vectors[0])
            if any(len(vector) != expected_dimension for vector in vectors):
                raise PublishError("embedding dimensions do not match")
            embeddings.extend(vectors)

        if len(embeddings) != len(chunk_list):
            raise PublishError(
                f"embedding count mismatch: received {len(embeddings)}, expected {len(chunk_list)}"
            )

        records = [
            {"id": chunk.id, "values": vector, "metadata": item}
            for chunk, vector, item in zip(chunk_list, embeddings, metadata, strict=True)
        ]
        upserted = 0
        upsert_fn = self._upsert_fn or self._upsert_with_pinecone
        for start in range(0, len(records), batch_size):
            batch = records[start : start + batch_size]
            response = await _off_loop(upsert_fn, batch, namespace)
            count = _upserted_count(response)
            if count != len(batch):
                raise PublishError(
                    f"upsert count mismatch: received {count}, expected {len(batch)}"
                )
            upserted += count

        if chunk_list:
            await self.check_staging_integrity(revision, len(chunk_list))

        return PublishReport(
            revision=revision,
            namespace=namespace,
            chunk_count=len(chunk_list),
            embedded_count=len(embeddings),
            upserted_count=upserted,
        )
