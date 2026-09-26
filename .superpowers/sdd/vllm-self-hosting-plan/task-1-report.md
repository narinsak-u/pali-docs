# Task 1 report: local model provider contract

## Implementation

- Extended the FastAPI `Settings` provider discriminator with `PROVIDER_NAME=local`.
- Added server-only local provider settings: `LOCAL_LLM_BASE_URL`, `LOCAL_LLM_API_KEY`, `LOCAL_LLM_MODEL`, `LOCAL_LLM_TIMEOUT_SECONDS`, and `LOCAL_LLM_MAX_OUTPUT_TOKENS`.
- Local settings fail closed when endpoint, credential, served model identifier, timeout, or output limit is invalid or missing. The endpoint must be an absolute `http` or `https` URL, timeout is bounded to a positive value up to 300 seconds, and output tokens are bounded to 1–32768.
- Extended the existing `LangChainModelStages` `ChatOpenAI` construction seam for local OpenAI-compatible serving, passing the configured endpoint, credential, served model, timeout, and output limit. Hosted OpenRouter and OpenCode construction remains available and unchanged for rollback.
- No vLLM deployment, browser endpoint/credential, tool-calling, or structured-output behavior was added.

## Files changed

- `apps/api/app/config.py`
- `apps/api/app/agent/runner.py`
- `apps/api/tests/test_provider_contract.py`

## TDD evidence

### RED

Command:

```text
cd apps/api && .venv/bin/pytest -q tests/test_provider_contract.py
```

Output:

```text
2 failed, 6 passed
ValidationError: Settings.PROVIDER_NAME input should be 'openrouter' or 'opencode' (input_value='local')
```

The new local-provider tests failed before production support existed; the existing hosted rollback test and invalid-value tests passed against the old contract.

### GREEN

Command:

```text
cd apps/api && .venv/bin/pytest -q tests/test_provider_contract.py
```

Output:

```text
8 passed, 2 warnings
```

The warnings are dependency deprecation warnings from LangGraph and pytest-asyncio.

## Focused regression tests

Command:

```text
cd apps/api && .venv/bin/pytest -q tests/test_provider_contract.py tests/test_question.py tests/test_retriever.py
```

Output:

```text
54 passed, 236 warnings
```

All warnings are existing dependency deprecations; no test failures or application errors occurred.

## Concerns

- This task validates provider construction and configuration without a real Linux/NVIDIA vLLM server. Deployment readiness and model compatibility remain Task 2 concerns.
- The API focused run reports existing dependency deprecation warnings from LangGraph and pytest-asyncio.
