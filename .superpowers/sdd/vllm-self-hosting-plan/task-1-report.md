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

Output before the initial implementation:

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

Initial implementation command:

```text
cd apps/api && .venv/bin/pytest -q tests/test_provider_contract.py tests/test_question.py tests/test_retriever.py
```

Output:

```text
54 passed, 236 warnings
```

Review-fix command:

```text
cd apps/api && .venv/bin/pytest -q tests/test_provider_contract.py tests/test_question.py tests/test_retriever.py
```

Output:

```text
61 passed, 263 warnings
```

All warnings are existing dependency deprecations; no test failures or application errors occurred.

## Review response and follow-up TDD evidence

Review findings were addressed as follows:

1. Local endpoint validation now reads `urlsplit().hostname` and `.port`, catches malformed ports, rejects missing hostnames, and accepts only valid HTTP(S) endpoint forms. This rejects `http://host:bad/v1` and `http://:8000/v1` at `Settings` construction.
2. The existing model seam independently enforces the same timeout and output-token upper bounds, so a `Settings | Any` caller cannot bypass the safety limits. It also applies strict endpoint validation at construction.
3. Added observable `/v1/question` coverage that exercises local streaming, hosted rollback streaming, and invalid-local-limit mapping to the existing `503 service_unavailable` response. The tests assert the SSE response/event contract and model selection through the route's existing runner seam.

Review RED command:

```text
cd apps/api && .venv/bin/pytest -q tests/test_provider_contract.py
```

Output before the review fixes (after adding the review tests):

```text
5 failed, 10 passed
```

The failures were the two malformed endpoint cases, two model-seam upper-bound cases, and invalid-local route error mapping. An initial test-only `NameError` from a missing `QuestionRequest` import was corrected before this RED evidence was captured.

Review GREEN command:

```text
cd apps/api && .venv/bin/pytest -q tests/test_provider_contract.py
```

Output:

```text
15 passed, 29 warnings
```

## Concerns

- This task validates provider construction and configuration without a real Linux/NVIDIA vLLM server. Deployment readiness and model compatibility remain Task 2 concerns.
- The API focused runs report existing dependency deprecation warnings from LangGraph and pytest-asyncio.
