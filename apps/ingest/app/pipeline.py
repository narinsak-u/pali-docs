from __future__ import annotations

import asyncio
import inspect
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any

from pathlib import Path

from .chunk import chunk_document
from .config import IngestSettings, get_settings
from .manifest import ManifestStore, build_manifest
from .publisher import PineconePublisher, PublishReport
from .source import load_sources
from .types import Chunk, ChunkingPolicy, RevisionPointer, SourceDocument


class PipelineError(ValueError):
    """Raised when staged ingestion fails a structural release gate."""


@dataclass(frozen=True, slots=True)
class PipelineResult:
    revision: str
    namespace: str
    source_count: int
    chunk_count: int
    vector_count: int
    promotion_pointer: RevisionPointer

    def to_dict(self) -> dict[str, Any]:
        return {
            "revision": self.revision,
            "namespace": self.namespace,
            "sourceCount": self.source_count,
            "chunkCount": self.chunk_count,
            "vectorCount": self.vector_count,
            "promotionPointer": self.promotion_pointer.to_dict(),
        }


def _require_count(value: object, name: str, expected: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value != expected:
        raise PipelineError(f"{name} count does not match expected count {expected}")


def evaluate_staging_integrity(
    documents: Sequence[SourceDocument],
    chunks: Sequence[Chunk],
    report: PublishReport,
    revision: str,
    *,
    staging_vector_count: int | None = None,
) -> int:
    """Validate local corpus structure and publication counts before promotion."""
    if not documents:
        raise PipelineError("cannot promote an empty corpus")
    if not chunks:
        raise PipelineError("cannot promote a corpus without chunks")
    if not isinstance(revision, str) or not revision.startswith("rev-"):
        raise PipelineError("invalid corpus revision")

    source_by_id: dict[str, SourceDocument] = {}
    for document in documents:
        if not document.source_id or document.source_id in source_by_id:
            raise PipelineError("source IDs must be unique and non-empty")
        if not isinstance(document.acl_metadata, Mapping) or not document.acl_metadata:
            raise PipelineError(f"source {document.source_id!r} is missing ACL metadata")
        source_by_id[document.source_id] = document

    chunk_ids: set[str] = set()
    for chunk in chunks:
        if not chunk.id or chunk.id in chunk_ids:
            raise PipelineError("chunk IDs must be unique and non-empty")
        chunk_ids.add(chunk.id)
        source = source_by_id.get(chunk.source_id)
        if source is None:
            raise PipelineError(f"chunk {chunk.id!r} references an unknown source")
        if chunk.source_version != source.source_version:
            raise PipelineError(f"chunk {chunk.id!r} has an invalid source version")
        if not chunk.title.strip():
            raise PipelineError(f"chunk {chunk.id!r} is missing title metadata")
        if not chunk.source_id.strip():
            raise PipelineError(f"chunk {chunk.id!r} is missing source metadata")
        if not chunk.text.strip():
            raise PipelineError(f"chunk {chunk.id!r} is empty")
        if not chunk.source_version.strip():
            raise PipelineError(f"chunk {chunk.id!r} is missing sourceVersion metadata")
        if not isinstance(chunk.acl_metadata, Mapping) or not chunk.acl_metadata:
            raise PipelineError(f"chunk {chunk.id!r} is missing ACL metadata")

    if report.revision != revision:
        raise PipelineError("publication revision does not match the manifest revision")
    if report.namespace != f"staging-{revision}":
        raise PipelineError("publication namespace is not the revision staging namespace")
    expected_count = len(chunks)
    _require_count(report.chunk_count, "chunk", expected_count)
    _require_count(report.embedded_count, "embedding", expected_count)
    _require_count(report.upserted_count, "upsert", expected_count)

    report_vectors = report.vector_count
    if report_vectors is not None and (
        isinstance(report_vectors, bool)
        or not isinstance(report_vectors, int)
        or report_vectors < expected_count
    ):
        raise PipelineError("published vector count is below the expected chunk count")
    if staging_vector_count is not None:
        if isinstance(staging_vector_count, bool) or not isinstance(staging_vector_count, int):
            raise PipelineError("staging stats returned an invalid vector count")
        if staging_vector_count < expected_count:
            raise PipelineError("staging vector count is below the expected chunk count")
        return staging_vector_count
    return report_vectors if report_vectors is not None else report.upserted_count


async def _staging_vector_count(
    publisher: object, revision: str, expected_count: int
) -> int | None:
    checker = getattr(publisher, "check_staging_integrity", None)
    if not callable(checker):
        return None
    result = checker(revision, expected_count)
    if inspect.isawaitable(result):
        result = await result
    if result is None or result is True:
        return None
    if result is False:
        raise PipelineError("staging integrity check failed")
    if isinstance(result, bool) or not isinstance(result, int):
        raise PipelineError("staging integrity check returned an invalid result")
    return result


def _resolve_source_root(settings: IngestSettings) -> Path:
    root = Path(settings.source_root)
    if root.is_absolute() or root.exists():
        return root
    repository_root = Path(__file__).resolve().parents[3]
    candidate = repository_root / root
    return candidate if candidate.exists() else root


async def run_pipeline(
    settings: IngestSettings | None = None,
    publisher: PineconePublisher | None = None,
    store: ManifestStore | None = None,
) -> PipelineResult:
    """Load, stage, validate, and atomically promote one corpus revision."""
    selected_settings = settings or get_settings()
    documents = await asyncio.to_thread(
        load_sources,
        _resolve_source_root(selected_settings),
        source_prefix=selected_settings.source_prefix,
        source_version_chars=selected_settings.source_version_chars,
        acl_metadata=selected_settings.default_acl,
    )
    policy = ChunkingPolicy(
        version=selected_settings.chunking_version,
        max_characters=selected_settings.max_chunk_chars,
        overlap_characters=selected_settings.overlap_chars,
    )
    chunks = tuple(
        chunk
        for document in documents
        for chunk in chunk_document(document, policy)
    )
    draft = build_manifest(
        documents,
        chunks,
        schema_version=selected_settings.schema_version,
        chunking_policy=policy,
        embedding_model=selected_settings.embedding_model,
        embedding_input_type=selected_settings.embedding_input_type,
        retrieval_policy_version=selected_settings.retrieval_policy_version,
        status="draft",
    )

    selected_publisher = publisher or PineconePublisher(selected_settings)
    selected_store = store or ManifestStore(selected_settings.state_dir)
    report = await selected_publisher.publish(chunks, draft.revision)
    staging_count = await _staging_vector_count(
        selected_publisher, draft.revision, len(chunks)
    )
    vector_count = evaluate_staging_integrity(
        documents,
        chunks,
        report,
        draft.revision,
        staging_vector_count=staging_count,
    )

    validated = replace(draft, status="validated")
    manifest_path = selected_store.manifest_path(validated.revision)
    if manifest_path.exists():
        persisted = selected_store.read_manifest(validated.revision)
        if persisted.status != "validated":
            raise PipelineError("existing immutable revision is not validated")
    else:
        selected_store.write_manifest(validated)
        persisted = validated
    pointer = selected_store.promote(persisted.revision)
    return PipelineResult(
        revision=persisted.revision,
        namespace=pointer.namespace,
        source_count=len(documents),
        chunk_count=len(chunks),
        vector_count=vector_count,
        promotion_pointer=pointer,
    )
