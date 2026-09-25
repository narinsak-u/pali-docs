from __future__ import annotations

import hashlib
import json
import os
import tempfile
from collections.abc import Iterable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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


def compute_revision(
    source_hashes: Iterable[str],
    *,
    chunking_version: str,
    embedding_model: str,
    embedding_input_type: str,
    retrieval_policy_version: str,
) -> str:
    """Compute a revision from content and all policy/model identity inputs."""
    hashes = sorted(source_hashes)
    if any(not value for value in hashes):
        raise ManifestError("source hashes must be non-empty")
    payload = {
        "sourceHashes": hashes,
        "chunkingVersion": chunking_version,
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
    policy = chunking_policy or ChunkingPolicy()
    revision = compute_revision(
        (document.content_hash for document in source_list),
        chunking_version=policy.version,
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
    expected_ids = {document.source_id for document in source_list}
    chunk_ids = [chunk.id for chunk in chunk_list]
    if len(chunk_ids) != len(set(chunk_ids)):
        raise ManifestError("duplicate chunk IDs")
    if any(chunk.source_id not in expected_ids for chunk in chunk_list):
        raise ManifestError("chunk references an unknown source")
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

