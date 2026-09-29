from __future__ import annotations

from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .vllm_profile import QWEN3_VLLM_PROFILE


_DENSE_RAG_DEFAULTS = {
    "RAG_CANDIDATE_TOP_K": 20,
    "RAG_ACCEPTED_TOP_K": 8,
    "RAG_MIN_SCORE": 0,
    "RAG_HIERARCHY_EXPANSION": False,
    "RAG_RERANKER_ENABLED": False,
    "RAG_RERANKER_MAX_CANDIDATES": 20,
    "RAG_RERANKER_TIMEOUT_MS": 100,
    "RAG_MAX_CONTEXT_CHARS": 12_000,
    "RAG_MAX_PARENT_CONTEXT_CHARS": 1_600,
}


class _RagQualitySettings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    RAG_CANDIDATE_TOP_K: int = Field(default=20, ge=1, le=50)
    RAG_ACCEPTED_TOP_K: int = Field(default=8, ge=1, le=12)
    RAG_MIN_SCORE: float = Field(default=0, ge=0, le=1)
    RAG_HIERARCHY_EXPANSION: bool = False
    RAG_RERANKER_ENABLED: bool = False
    RAG_RERANKER_MAX_CANDIDATES: int = Field(default=20, ge=1, le=50)
    RAG_RERANKER_TIMEOUT_MS: int = Field(default=100, ge=1, le=2000)
    RAG_MAX_PARENT_CONTEXT_CHARS: int = Field(default=1600, ge=1, le=12000)
    RAG_MAX_CONTEXT_CHARS: int = Field(default=12000, ge=1000, le=50000)


def _use_dense_defaults_for_invalid_quality(
    values: object,
) -> object:
    if not isinstance(values, dict):
        return values
    for field_name in ("RAG_HIERARCHY_EXPANSION", "RAG_RERANKER_ENABLED"):
        raw_value = values.get(field_name)
        if raw_value is not None and not isinstance(raw_value, bool) and raw_value not in (
            "true",
            "false",
        ):
            return {**values, **_DENSE_RAG_DEFAULTS}
    try:
        _RagQualitySettings.model_validate(values)
    except ValidationError:
        return {**values, **_DENSE_RAG_DEFAULTS}
    return values


class Settings(BaseSettings):
    """Environment-backed application settings shared by API components."""

    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")

    PROVIDER_NAME: Literal["openrouter", "opencode", "local"] = "openrouter"
    OPENROUTER_API_KEY: str | None = None
    OPENROUTER_LLM_MODEL: str | None = None
    OPENCODE_API_KEY: str | None = None
    OPENCODE_LLM_MODEL: str | None = None
    LOCAL_LLM_BASE_URL: str | None = None
    LOCAL_LLM_API_KEY: str | None = None
    LOCAL_LLM_MODEL: str | None = None
    LOCAL_LLM_TIMEOUT_SECONDS: float = Field(default=60, gt=0, le=300)
    LOCAL_LLM_MAX_OUTPUT_TOKENS: int = Field(default=768, ge=1, le=768)

    PINECONE_API_KEY: str = Field(min_length=1)
    PINECONE_INDEX_NAME: str = Field(min_length=1)
    PINECONE_NAMESPACE: str = ""
    PINECONE_CORPUS_REVISION: str = Field(min_length=1)
    PINECONE_EMBEDDING_MODEL: str = "llama-text-embed-v2"

    RAG_CANDIDATE_TOP_K: int = Field(default=20, ge=1, le=50)
    RAG_ACCEPTED_TOP_K: int = Field(default=8, ge=1, le=12)
    RAG_MIN_SCORE: float = Field(default=0, ge=0, le=1)
    RAG_HIERARCHY_EXPANSION: bool = False
    RAG_RERANKER_ENABLED: bool = False
    RAG_RERANKER_MAX_CANDIDATES: int = Field(default=20, ge=1, le=50)
    RAG_MAX_PARENT_CONTEXT_CHARS: int = Field(default=1600, ge=1, le=12000)
    RAG_RERANKER_TIMEOUT_MS: int = Field(default=100, ge=1, le=2000)
    RAG_MAX_CONTEXT_CHARS: int = Field(default=12000, ge=1000, le=50000)

    INTERNAL_API_TOKEN: str | None = None
    INTERNAL_PRINCIPAL_SECRET: str | None = None

    @model_validator(mode="before")
    @classmethod
    def apply_dense_defaults_for_invalid_quality(
        cls, values: object
    ) -> object:
        return _use_dense_defaults_for_invalid_quality(values)
    @model_validator(mode="after")
    def require_selected_provider_credentials(self) -> Settings:
        if self.PROVIDER_NAME == "openrouter":
            if not self.OPENROUTER_API_KEY or not self.OPENROUTER_LLM_MODEL:
                raise ValueError(
                    "OPENROUTER_API_KEY and OPENROUTER_LLM_MODEL are required "
                    "when PROVIDER_NAME is openrouter"
                )
        elif self.PROVIDER_NAME == "opencode":
            if not self.OPENCODE_API_KEY or not self.OPENCODE_LLM_MODEL:
                raise ValueError(
                    "OPENCODE_API_KEY and OPENCODE_LLM_MODEL are required "
                    "when PROVIDER_NAME is opencode"
                )
        else:
            local_values = (
                self.LOCAL_LLM_BASE_URL,
                self.LOCAL_LLM_API_KEY,
                self.LOCAL_LLM_MODEL,
            )
            if any(
                not isinstance(value, str) or not value.strip()
                for value in local_values
            ):
                raise ValueError(
                    "LOCAL_LLM_BASE_URL, LOCAL_LLM_API_KEY, and LOCAL_LLM_MODEL "
                    "must be nonblank when PROVIDER_NAME is local"
                )
            if self.LOCAL_LLM_MODEL != QWEN3_VLLM_PROFILE.model_id:
                raise ValueError(
                    f"LOCAL_LLM_MODEL must be {QWEN3_VLLM_PROFILE.model_id}"
                )
            try:
                endpoint = urlsplit(self.LOCAL_LLM_BASE_URL)
                hostname = endpoint.hostname
                port = endpoint.port
            except ValueError as error:
                raise ValueError(
                    "LOCAL_LLM_BASE_URL must be an absolute http(s) URL"
                ) from error
            if (
                endpoint.scheme not in {"http", "https"}
                or not hostname
                or (port is not None and not 1 <= port <= 65535)
            ):
                raise ValueError(
                    "LOCAL_LLM_BASE_URL must be an absolute http(s) URL"
                )
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
