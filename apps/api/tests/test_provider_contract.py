from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.agent.runner import LangChainModelStages
from app.config import Settings


def _settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "PINECONE_API_KEY": "pinecone-key",
        "PINECONE_INDEX_NAME": "pali",
        "PINECONE_CORPUS_REVISION": "corpus-1",
        "PROVIDER_NAME": "local",
        "LOCAL_LLM_BASE_URL": "http://vllm.internal:8000/v1",
        "LOCAL_LLM_API_KEY": "vllm-key",
        "LOCAL_LLM_MODEL": "Qwen/Qwen3-8B",
        "LOCAL_LLM_TIMEOUT_SECONDS": 45,
        "LOCAL_LLM_MAX_OUTPUT_TOKENS": 768,
    }
    values.update(overrides)
    return Settings(**values)


def test_local_settings_validate_the_private_model_contract() -> None:
    settings = _settings()

    assert settings.PROVIDER_NAME == "local"
    assert settings.LOCAL_LLM_BASE_URL == "http://vllm.internal:8000/v1"
    assert settings.LOCAL_LLM_API_KEY == "vllm-key"
    assert settings.LOCAL_LLM_MODEL == "Qwen/Qwen3-8B"
    assert settings.LOCAL_LLM_TIMEOUT_SECONDS == 45
    assert settings.LOCAL_LLM_MAX_OUTPUT_TOKENS == 768


@pytest.mark.parametrize(
    "field,value",
    [
        ("LOCAL_LLM_BASE_URL", "not-a-url"),
        ("LOCAL_LLM_API_KEY", ""),
        ("LOCAL_LLM_MODEL", ""),
        ("LOCAL_LLM_TIMEOUT_SECONDS", 0),
        ("LOCAL_LLM_MAX_OUTPUT_TOKENS", 0),
    ],
)
def test_local_settings_fail_closed_for_invalid_values(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        _settings(**{field: value})


def test_local_provider_uses_the_existing_chat_model_seam() -> None:
    model = LangChainModelStages(settings=_settings())._chat()

    assert model.model_name == "Qwen/Qwen3-8B"
    assert str(model.openai_api_base).rstrip("/") == "http://vllm.internal:8000/v1"
    assert model.openai_api_key.get_secret_value() == "vllm-key"
    assert model.request_timeout == 45
    assert model.max_tokens == 768


def test_hosted_provider_remains_selectable_for_rollback() -> None:
    settings = Settings(
        PINECONE_API_KEY="pinecone-key",
        PINECONE_INDEX_NAME="pali",
        PINECONE_CORPUS_REVISION="corpus-1",
        PROVIDER_NAME="openrouter",
        OPENROUTER_API_KEY="hosted-key",
        OPENROUTER_LLM_MODEL="hosted/model",
    )

    model = LangChainModelStages(settings=settings)._chat()

    assert model.model_name == "hosted/model"
    assert str(model.openai_api_base).rstrip("/") == "https://openrouter.ai/api/v1"
    assert model.openai_api_key.get_secret_value() == "hosted-key"
