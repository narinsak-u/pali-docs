from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Mapping
DEFAULT_SOURCE_ROOT = Path(__file__).resolve().parents[2] / "web" / "content" / "docs"


@dataclass(frozen=True, slots=True)
class IngestSettings:
    """Configuration for the source-to-manifest part of ingestion."""

    source_root: Path = DEFAULT_SOURCE_ROOT
    state_dir: Path = Path(".ingest-state")
    source_prefix: str = "content/docs"
    schema_version: str = "v1"
    chunking_version: str = "hierarchical-v1"
    max_chunk_chars: int = 1_600
    max_parent_context_chars: int = 1_600
    overlap_chars: int = 200
    embedding_model: str = "llama-text-embed-v2"
    embedding_input_type: str = "passage"
    retrieval_policy_version: str = "v1"
    pinecone_api_key: str = ""
    pinecone_index_name: str = ""
    pinecone_namespace: str = ""
    pinecone_base_namespace: str = ""
    embedding_batch_size: int = 32
    source_version_chars: int = 12
    default_acl: Mapping[str, object] = field(
        default_factory=lambda: {"visibility": "public"}
    )

    def __post_init__(self) -> None:
        if self.max_chunk_chars < 1:
            raise ValueError("max_chunk_chars must be positive")
        if self.max_parent_context_chars < 1:
            raise ValueError("max_parent_context_chars must be positive")
        if not 0 <= self.overlap_chars < self.max_chunk_chars:
            raise ValueError("overlap_chars must be non-negative and smaller than max_chunk_chars")
        if self.source_version_chars < 1:
            raise ValueError("source_version_chars must be positive")
        if self.embedding_batch_size < 1:
            raise ValueError("embedding_batch_size must be positive")
        if self.embedding_input_type != "passage":
            raise ValueError("embedding_input_type must be passage")
        for name in (
            "source_prefix",
            "schema_version",
            "chunking_version",
            "embedding_model",
            "embedding_input_type",
            "retrieval_policy_version",
        ):
            if not getattr(self, name).strip():
                raise ValueError(f"{name} must be non-empty")

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> IngestSettings:
        values = os.environ if environ is None else environ
        defaults = cls()

        def text(name: str, default: str) -> str:
            return values.get(name, values.get(name.removeprefix("INGEST_"), default))

        def integer(name: str, default: int) -> int:
            raw = values.get(name, values.get(name.removeprefix("INGEST_")))
            if raw is None:
                return default
            try:
                return int(raw)
            except ValueError as exc:
                raise ValueError(f"{name} must be an integer") from exc

        source_root_value = text("INGEST_SOURCE_ROOT", str(defaults.source_root))
        if not source_root_value.strip():
            raise ValueError("INGEST_SOURCE_ROOT must be non-empty")
        state_dir_value = text("INGEST_STATE_DIR", str(defaults.state_dir))
        if not state_dir_value.strip():
            raise ValueError("INGEST_STATE_DIR must be non-empty")
        return cls(
            source_root=Path(source_root_value),
            state_dir=Path(state_dir_value),
            source_prefix=text("INGEST_SOURCE_PREFIX", defaults.source_prefix),
            schema_version=text("INGEST_SCHEMA_VERSION", defaults.schema_version),
            chunking_version=text("INGEST_CHUNKING_VERSION", defaults.chunking_version),
            max_chunk_chars=integer("INGEST_MAX_CHUNK_CHARS", defaults.max_chunk_chars),
            max_parent_context_chars=integer(
                "INGEST_MAX_PARENT_CONTEXT_CHARS", defaults.max_parent_context_chars
            ),
            overlap_chars=integer("INGEST_OVERLAP_CHARS", defaults.overlap_chars),
            embedding_model=text("INGEST_EMBEDDING_MODEL", defaults.embedding_model),
            embedding_input_type=text(
                "INGEST_EMBEDDING_INPUT_TYPE", defaults.embedding_input_type
            ),
            retrieval_policy_version=text(
                "INGEST_RETRIEVAL_POLICY_VERSION", defaults.retrieval_policy_version
            ),
            pinecone_api_key=text("INGEST_PINECONE_API_KEY", defaults.pinecone_api_key),
            pinecone_index_name=text("INGEST_PINECONE_INDEX_NAME", defaults.pinecone_index_name),
            pinecone_namespace=text("INGEST_PINECONE_NAMESPACE", defaults.pinecone_namespace),
            pinecone_base_namespace=text(
                "INGEST_PINECONE_BASE_NAMESPACE", defaults.pinecone_base_namespace
            ),
            embedding_batch_size=integer(
                "INGEST_EMBEDDING_BATCH_SIZE", defaults.embedding_batch_size
            ),
            source_version_chars=integer(
                "INGEST_SOURCE_VERSION_CHARS", defaults.source_version_chars
            ),
        )


Settings = IngestSettings


@lru_cache(maxsize=1)
def get_settings() -> IngestSettings:
    return IngestSettings.from_env()
