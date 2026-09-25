from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-backed application settings shared by API components."""

    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")

    PROVIDER_NAME: Literal["openrouter", "opencode"] = "openrouter"
    OPENROUTER_API_KEY: str | None = None
    OPENROUTER_LLM_MODEL: str | None = None
    OPENCODE_API_KEY: str | None = None
    OPENCODE_LLM_MODEL: str | None = None

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
    RAG_RERANKER_TIMEOUT_MS: int = Field(default=100, ge=1, le=2000)
    RAG_MAX_CONTEXT_CHARS: int = Field(default=12000, ge=1000, le=50000)

    INTERNAL_API_TOKEN: str | None = None

    @model_validator(mode="after")
    def require_selected_provider_credentials(self) -> Settings:
        if self.PROVIDER_NAME == "openrouter":
            if not self.OPENROUTER_API_KEY or not self.OPENROUTER_LLM_MODEL:
                raise ValueError(
                    "OPENROUTER_API_KEY and OPENROUTER_LLM_MODEL are required "
                    "when PROVIDER_NAME is openrouter"
                )
        elif not self.OPENCODE_API_KEY or not self.OPENCODE_LLM_MODEL:
            raise ValueError(
                "OPENCODE_API_KEY and OPENCODE_LLM_MODEL are required "
                "when PROVIDER_NAME is opencode"
            )
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
