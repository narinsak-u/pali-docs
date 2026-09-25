from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Mapping, TypeAlias


JsonValue: TypeAlias = (
    None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]
)


@dataclass(frozen=True, slots=True)
class SourceDocument:
    source_id: str
    source_version: str
    title: str
    text: str
    content_hash: str
    description: str | None = None
    acl_metadata: Mapping[str, JsonValue] = field(
        default_factory=lambda: {"visibility": "public"}
    )
    def __post_init__(self) -> None:
        for name in ("source_id", "source_version", "title", "content_hash"):
            if not getattr(self, name).strip():
                raise ValueError(f"{name} must be non-empty")
        if not self.text.strip():
            raise ValueError("text must be non-empty")
        if len(self.content_hash) != 64 or any(
            character not in "0123456789abcdef" for character in self.content_hash.lower()
        ):
            raise ValueError("content_hash must be a SHA-256 hex digest")


@dataclass(frozen=True, slots=True)
class Chunk:
    id: str
    parent_id: str
    source_id: str
    source_version: str
    index: int
    text: str
    title: str
    section: str | None = None
    acl_metadata: Mapping[str, JsonValue] = field(
        default_factory=lambda: {"visibility": "public"}
    )

    def __post_init__(self) -> None:
        if any(
            not value.strip()
            for value in (self.id, self.parent_id, self.source_id, self.source_version, self.title)
        ):
            raise ValueError("chunk identity fields must be non-empty")
        if self.section is not None and not self.section.strip():
            raise ValueError("chunk section must be non-empty when provided")
        if self.index < 0:
            raise ValueError("chunk index must be non-negative")
        if not self.text.strip():
            raise ValueError("chunk text must be non-empty")


@dataclass(frozen=True, slots=True)
class ChunkingPolicy:
    version: str = "hierarchical-v1"
    max_characters: int = 1_600
    overlap_characters: int = 200

    def __post_init__(self) -> None:
        if not self.version.strip():
            raise ValueError("chunking policy version must be non-empty")
        if self.max_characters < 1:
            raise ValueError("max_characters must be positive")
        if not 0 <= self.overlap_characters < self.max_characters:
            raise ValueError(
                "overlap_characters must be non-negative and smaller than max_characters"
            )

    def to_dict(self) -> dict[str, int | str]:
        return {
            "version": self.version,
            "maxCharacters": self.max_characters,
            "overlapCharacters": self.overlap_characters,
        }


@dataclass(frozen=True, slots=True)
class ManifestSource:
    source_id: str
    content_hash: str
    source_version: str
    acl_metadata: Mapping[str, JsonValue] = field(
        default_factory=lambda: {"visibility": "public"}
    )

    def __post_init__(self) -> None:
        if not self.source_id.strip() or not self.source_version.strip():
            raise ValueError("manifest source identity fields must be non-empty")
        if not isinstance(self.acl_metadata, Mapping) or not self.acl_metadata:
            raise ValueError("manifest source ACL metadata must be non-empty")
        if len(self.content_hash) != 64 or any(
            character not in "0123456789abcdef" for character in self.content_hash.lower()
        ):
            raise ValueError("manifest source content_hash must be a SHA-256 hex digest")

    def to_dict(self) -> dict[str, object]:
        return {
            "sourceId": self.source_id,
            "contentHash": self.content_hash,
            "sourceVersion": self.source_version,
            "acl": dict(self.acl_metadata),
        }


ManifestStatus = Literal["draft", "validated", "published"]


@dataclass(frozen=True, slots=True)
class CorpusManifest:
    schema_version: str
    revision: str
    sources: tuple[ManifestSource, ...]
    chunking_policy: ChunkingPolicy
    embedding_model: str
    embedding_input_type: str
    retrieval_policy_version: str
    chunk_count: int
    created_at: str
    status: ManifestStatus = "draft"

    def __post_init__(self) -> None:
        required = {
            "schema_version": self.schema_version,
            "revision": self.revision,
            "embedding_model": self.embedding_model,
            "embedding_input_type": self.embedding_input_type,
            "retrieval_policy_version": self.retrieval_policy_version,
            "created_at": self.created_at,
        }
        for name, value in required.items():
            if not value.strip():
                raise ValueError(f"{name} must be non-empty")
        if not self.revision.startswith("rev-"):
            raise ValueError("revision must start with rev-")
        if self.chunk_count < 0:
            raise ValueError("chunk_count must be non-negative")
        if self.status not in {"draft", "validated", "published"}:
            raise ValueError(f"invalid manifest status: {self.status}")
        source_ids = [source.source_id for source in self.sources]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("manifest contains duplicate source IDs")

    @property
    def source_ids(self) -> tuple[str, ...]:
        return tuple(source.source_id for source in self.sources)

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "revision": self.revision,
            "sources": [source.to_dict() for source in self.sources],
            "chunkingPolicy": self.chunking_policy.to_dict(),
            "embeddingModel": self.embedding_model,
            "embeddingInputType": self.embedding_input_type,
            "retrievalPolicyVersion": self.retrieval_policy_version,
            "chunkCount": self.chunk_count,
            "createdAt": self.created_at,
            "status": self.status,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> CorpusManifest:
        required = (
            "schemaVersion",
            "revision",
            "sources",
            "chunkingPolicy",
            "embeddingModel",
            "embeddingInputType",
            "retrievalPolicyVersion",
            "chunkCount",
            "createdAt",
            "status",
        )
        missing = [name for name in required if name not in value]
        if missing:
            raise ValueError(f"manifest missing required fields: {', '.join(missing)}")
        string_fields = (
            "schemaVersion",
            "revision",
            "embeddingModel",
            "embeddingInputType",
            "retrievalPolicyVersion",
            "createdAt",
            "status",
        )
        if any(not isinstance(value[name], str) for name in string_fields):
            raise ValueError("manifest string fields must be strings")
        policy = value["chunkingPolicy"]
        if not isinstance(policy, Mapping):
            raise ValueError("chunkingPolicy must be an object")
        if (
            not isinstance(policy.get("version"), str)
            or isinstance(policy.get("maxCharacters"), bool)
            or not isinstance(policy.get("maxCharacters"), int)
            or isinstance(policy.get("overlapCharacters"), bool)
            or not isinstance(policy.get("overlapCharacters"), int)
        ):
            raise ValueError("chunkingPolicy fields have invalid types")
        sources = value["sources"]
        if not isinstance(sources, list):
            raise ValueError("sources must be an array")
        parsed_sources = []
        for item in sources:
            if not isinstance(item, Mapping):
                raise ValueError("manifest source must be an object")
            try:
                source_fields = ("sourceId", "contentHash", "sourceVersion")
                if any(not isinstance(item.get(name), str) for name in source_fields):
                    raise ValueError("manifest source identity fields must be strings")
                if "acl" not in item or not isinstance(item["acl"], Mapping):
                    raise ValueError("manifest source missing required acl")
                parsed_sources.append(
                    ManifestSource(
                        source_id=item["sourceId"],
                        content_hash=item["contentHash"],
                        source_version=item["sourceVersion"],
                        acl_metadata=dict(item["acl"]),
                    )
                )
            except KeyError as exc:
                raise ValueError(f"manifest source missing field: {exc.args[0]}") from exc
        if isinstance(value["chunkCount"], bool) or not isinstance(value["chunkCount"], int):
            raise ValueError("chunkCount must be an integer")
        return cls(
            schema_version=value["schemaVersion"],
            revision=value["revision"],
            sources=tuple(parsed_sources),
            chunking_policy=ChunkingPolicy(
                version=policy["version"],
                max_characters=policy["maxCharacters"],
                overlap_characters=policy["overlapCharacters"],
            ),
            embedding_model=value["embeddingModel"],
            embedding_input_type=value["embeddingInputType"],
            retrieval_policy_version=value["retrievalPolicyVersion"],
            chunk_count=value["chunkCount"],
            created_at=value["createdAt"],
            status=value["status"],  # type: ignore[arg-type]
        )


@dataclass(frozen=True, slots=True)
class RevisionPointer:
    revision: str
    namespace: str
    promoted_at: str

    def __post_init__(self) -> None:
        if (
            not isinstance(self.revision, str)
            or not self.revision.startswith("rev-")
            or self.revision != self.revision.strip()
            or any(character.isspace() for character in self.revision)
            or "/" in self.revision
            or "\\" in self.revision
        ):
            raise ValueError("revision must be a safe rev identifier")
        if self.namespace != f"staging-{self.revision}":
            raise ValueError("namespace must match the staging revision")
        if not isinstance(self.promoted_at, str) or not self.promoted_at.strip():
            raise ValueError("pointer fields must be non-empty")

    def to_dict(self) -> dict[str, str]:
        return {
            "revision": self.revision,
            "namespace": self.namespace,
            "promotedAt": self.promoted_at,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> RevisionPointer:
        try:
            revision = value["revision"]
            namespace = value["namespace"]
            promoted_at = value["promotedAt"]
        except KeyError as exc:
            raise ValueError(f"pointer missing required field: {exc.args[0]}") from exc
        if not all(isinstance(item, str) for item in (revision, namespace, promoted_at)):
            raise ValueError("pointer fields must be strings")
        return cls(revision=revision, namespace=namespace, promoted_at=promoted_at)
