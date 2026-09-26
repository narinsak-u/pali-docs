from __future__ import annotations

import hashlib
import json
import os
import tempfile
from collections.abc import Iterable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .chunk import _chunk_id, _parent_id
from .types import (
    Chunk,
    ChunkingPolicy,
    CorpusManifest,
    ManifestSource,
    RevisionPointer,
    SourceDocument,
)


class ManifestError(ValueError):
    """Raised when a manifest or revision pointer is invalid."""


def _canonical_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )
def _validate_chunks(
    documents: tuple[SourceDocument, ...],
    chunks: tuple[Chunk, ...],
    policy: ChunkingPolicy,
) -> None:
    source_by_id = {document.source_id: document for document in documents}
    chunk_source_ids = {chunk.source_id for chunk in chunks}
    source_ids = set(source_by_id)
    if chunk_source_ids != source_ids:
        raise ManifestError("chunk source IDs must exactly cover manifest source IDs")
    seen_ids: set[str] = set()
    next_position_by_source: dict[str, int] = {}
    last_parent_by_source: dict[str, tuple[str, str, str, str]] = {}
    section_index_by_source: dict[str, int] = {}
    for _global_position, chunk in enumerate(chunks):
        source = source_by_id.get(chunk.source_id)
        if source is None:
            raise ManifestError(f"chunk {chunk.id!r} references an unknown source")
        if chunk.id in seen_ids:
            raise ManifestError("duplicate chunk IDs")
        seen_ids.add(chunk.id)
        if chunk.source_version != source.source_version:
            raise ManifestError(f"chunk {chunk.id!r} has an inconsistent source version")
        expected_position = next_position_by_source.get(chunk.source_id, 0)
        if chunk.index != expected_position:
            raise ManifestError(f"chunk {chunk.id!r} has a non-deterministic position")
        next_position_by_source[chunk.source_id] = expected_position + 1
        if not chunk.section or not chunk.section.strip():
            raise ManifestError(f"chunk {chunk.id!r} is missing section metadata")
        if not chunk.parent_id or not chunk.parent_id.strip():
            raise ManifestError(f"chunk {chunk.id!r} is missing parent identity")
        if not chunk.parent_text or not chunk.parent_text.strip():
            raise ManifestError(f"chunk {chunk.id!r} is missing parent text")
        if not isinstance(chunk.acl_metadata, Mapping) or not chunk.acl_metadata:
            raise ManifestError(f"chunk {chunk.id!r} is missing ACL metadata")
        if dict(chunk.acl_metadata) != dict(source.acl_metadata):
            raise ManifestError(f"chunk {chunk.id!r} has inconsistent ACL metadata")
        if chunk.chunking_policy != policy:
            raise ManifestError(f"chunk {chunk.id!r} has inconsistent chunking policy")
        parent_key = (chunk.source_id, chunk.source_version, chunk.section, chunk.parent_text)
        if parent_key != last_parent_by_source.get(chunk.source_id):
            section_index_by_source[chunk.source_id] = section_index_by_source.get(chunk.source_id, -1) + 1
            last_parent_by_source[chunk.source_id] = parent_key
        expected_parent_id = _parent_id(
            chunk.source_id,
            chunk.source_version,
            section_index_by_source[chunk.source_id],
            chunk.section,
        )
        if chunk.parent_id != expected_parent_id:
            raise ManifestError(f"chunk {chunk.id!r} has an inconsistent parent identity")
        expected_id = _chunk_id(
            chunk.source_id, chunk.source_version, policy, chunk.index, chunk.text
        )
        if chunk.id != expected_id:
            raise ManifestError(f"chunk {chunk.id!r} has an inconsistent identity")


def compute_revision(
    source_hashes: Iterable[str],
    *,
    chunking_version: str,
    chunking_max_characters: int = 1_600,
    chunking_overlap_characters: int = 200,
    embedding_model: str,
    embedding_input_type: str,
    retrieval_policy_version: str,
) -> str:
    hashes = sorted(source_hashes)
    if not hashes:
        raise ManifestError("at least one source hash is required")
    if any(not value for value in hashes):
        raise ManifestError("source hashes must be non-empty")
    policy = ChunkingPolicy(
        version=chunking_version,
        max_characters=chunking_max_characters,
        overlap_characters=chunking_overlap_characters,
    )
    payload = {
        "sourceHashes": hashes,
        "chunkingPolicy": policy.to_dict(),
        "embeddingModel": embedding_model,
        "embeddingInputType": embedding_input_type,
        "retrievalPolicyVersion": retrieval_policy_version,
    }
    return f"rev-{hashlib.sha256(_canonical_json(payload)).hexdigest()}"


def build_manifest(
    documents: Iterable[SourceDocument],
    chunks: Iterable[Chunk],
    *,
    schema_version: str = "v1",
    chunking_policy: ChunkingPolicy | None = None,
    embedding_model: str,
    embedding_input_type: str,
    retrieval_policy_version: str,
    created_at: str | None = None,
    status: str = "draft",
) -> CorpusManifest:
    source_list = tuple(documents)
    chunk_list = tuple(chunks)
    if not source_list:
        raise ManifestError("manifest requires at least one source")
    if not chunk_list:
        raise ManifestError("manifest requires at least one chunk")
    policy = chunking_policy or ChunkingPolicy()
    _validate_chunks(source_list, chunk_list, policy)
    revision = compute_revision(
        (document.content_hash for document in source_list),
        chunking_version=policy.version,
        chunking_max_characters=policy.max_characters,
        chunking_overlap_characters=policy.overlap_characters,
        embedding_model=embedding_model,
        embedding_input_type=embedding_input_type,
        retrieval_policy_version=retrieval_policy_version,
    )
    sources = tuple(
        ManifestSource(
            source_id=document.source_id,
            content_hash=document.content_hash,
            source_version=document.source_version,
            acl_metadata=document.acl_metadata,
        )
        for document in sorted(source_list, key=lambda item: item.source_id)
    )
    return CorpusManifest(
        schema_version=schema_version,
        revision=revision,
        sources=sources,
        chunking_policy=policy,
        embedding_model=embedding_model,
        embedding_input_type=embedding_input_type,
        retrieval_policy_version=retrieval_policy_version,
        chunk_count=len(chunk_list),
        created_at=created_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        status=status,  # type: ignore[arg-type]
    )


def _atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, path)
        directory_fd = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        temporary_path.unlink(missing_ok=True)


def _pointer_bytes(pointer: RevisionPointer) -> bytes:
    return (
        json.dumps(pointer.to_dict(), ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8")
        + b"\n"
    )


class ManifestStore:
    """Filesystem store for immutable manifests and atomic revision pointers."""

    def __init__(self, state_dir: str | Path = ".ingest-state") -> None:
        self.state_dir = Path(state_dir)
        self.manifests_dir = self.state_dir / "manifests"

    def manifest_path(self, revision: str) -> Path:
        if (
            not isinstance(revision, str)
            or not revision.startswith("rev-")
            or len(revision) <= len("rev-")
            or revision != revision.strip()
            or any(character.isspace() for character in revision)
            or "/" in revision
            or "\\" in revision
        ):
            raise ManifestError("invalid revision")
        return self.manifests_dir / f"{revision}.json"

    def write_manifest(self, manifest: CorpusManifest) -> Path:
        path = self.manifest_path(manifest.revision)
        try:
            canonical = _canonical_json(manifest.to_dict())
        except (TypeError, ValueError) as exc:
            raise ManifestError(f"manifest is not JSON-serializable: {exc}") from exc
        if path.exists():
            try:
                existing = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                raise ManifestError(f"unable to read existing manifest {manifest.revision}: {exc}") from exc
            if not isinstance(existing, Mapping):
                raise ManifestError("existing manifest must be a JSON object")
            try:
                existing_canonical = _canonical_json(existing)
            except (TypeError, ValueError) as exc:
                raise ManifestError(f"existing manifest is not JSON-serializable: {exc}") from exc
            if existing_canonical != canonical:
                raise ManifestError(
                    f"manifest revision {manifest.revision} already exists with different contents"
                )
            return path
        encoded = json.dumps(
            manifest.to_dict(), ensure_ascii=False, indent=2, sort_keys=True
        ).encode("utf-8") + b"\n"
        _atomic_write(path, encoded)
        return path

    def read_manifest(self, revision: str) -> CorpusManifest:
        path = self.manifest_path(revision)
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ManifestError(f"unable to read manifest {revision}: {exc}") from exc
        if not isinstance(value, Mapping):
            raise ManifestError("manifest must be a JSON object")
        try:
            manifest = CorpusManifest.from_dict(value)
        except (TypeError, ValueError, KeyError) as exc:
            raise ManifestError(f"invalid manifest {revision}: {exc}") from exc
        expected_revision = compute_revision(
            (source.content_hash for source in manifest.sources),
            chunking_version=manifest.chunking_policy.version,
            chunking_max_characters=manifest.chunking_policy.max_characters,
            chunking_overlap_characters=manifest.chunking_policy.overlap_characters,
            embedding_model=manifest.embedding_model,
            embedding_input_type=manifest.embedding_input_type,
            retrieval_policy_version=manifest.retrieval_policy_version,
        )
        if manifest.revision != expected_revision or manifest.revision != revision:
            raise ManifestError("manifest revision does not match its canonical contents")
        return manifest

    def _pointer_path(self, name: str) -> Path:
        if name not in {"active.json", "previous.json"}:
            raise ManifestError("invalid pointer name")
        return self.state_dir / name

    @property
    def _pointer_transaction_path(self) -> Path:
        return self.state_dir / "pointer-transaction.json"

    def _commit_pointer_swap(
        self, active: RevisionPointer, previous: RevisionPointer | None
    ) -> None:
        marker = {
            "active": active.to_dict(),
            "previous": previous.to_dict() if previous is not None else None,
        }
        _atomic_write(
            self._pointer_transaction_path,
            json.dumps(marker, ensure_ascii=False, sort_keys=True).encode("utf-8") + b"\n",
        )
        previous_path = self._pointer_path("previous.json")
        if previous is None:
            previous_path.unlink(missing_ok=True)
        else:
            _atomic_write(previous_path, _pointer_bytes(previous))
        _atomic_write(self._pointer_path("active.json"), _pointer_bytes(active))
        try:
            self._pointer_transaction_path.unlink(missing_ok=True)
        except OSError:
            pass

    def _recover_pointer_transaction(self) -> None:
        path = self._pointer_transaction_path
        if not path.exists():
            return
        try:
            marker = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(marker, Mapping) or not isinstance(marker.get("active"), Mapping):
                raise ValueError("invalid pointer transaction")
            active = RevisionPointer.from_dict(marker["active"])
            if "previous" not in marker:
                raise ValueError("pointer transaction missing previous")
            raw_previous = marker["previous"]
            if raw_previous is None:
                previous = None
            elif isinstance(raw_previous, Mapping):
                previous = RevisionPointer.from_dict(raw_previous)
            else:
                raise ValueError("pointer transaction previous must be an object or null")
            self._commit_pointer_swap(active, previous)
        except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
            raise ManifestError(f"invalid pointer transaction: {exc}") from exc

    def read_pointer(self, name: str = "active.json") -> RevisionPointer | None:
        self._recover_pointer_transaction()
        path = self._pointer_path(name)
        if not path.exists():
            return None
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(value, Mapping):
                raise ValueError("pointer must be an object")
            return RevisionPointer.from_dict(value)
        except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
            raise ManifestError(f"invalid {name}: {exc}") from exc

    def _validated_pointer(self, name: str) -> RevisionPointer | None:
        pointer = self.read_pointer(name)
        if pointer is None:
            return None
        manifest = self.read_manifest(pointer.revision)
        if manifest.status != "validated":
            raise ManifestError(f"{name} does not reference a validated manifest")
        return pointer

    def promote(self, revision: str, *, promoted_at: str | None = None) -> RevisionPointer:
        manifest = self.read_manifest(revision)
        if manifest.status != "validated":
            raise ManifestError("only validated manifests can be promoted")
        pointer = RevisionPointer(
            revision=revision,
            namespace=f"staging-{revision}",
            promoted_at=promoted_at
            or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        )
        active = self._validated_pointer("active.json")
        self._commit_pointer_swap(pointer, active)
        return pointer

    def rollback(self) -> RevisionPointer:
        active = self._validated_pointer("active.json")
        previous = self._validated_pointer("previous.json")
        if active is None:
            raise ManifestError("cannot rollback without an active validated pointer")
        if previous is None:
            raise ManifestError("cannot rollback without a previous validated pointer")
        self._commit_pointer_swap(previous, active)
        return previous

    @property
    def active(self) -> RevisionPointer | None:
        return self.read_pointer("active.json")

    @property
    def previous(self) -> RevisionPointer | None:
        return self.read_pointer("previous.json")

