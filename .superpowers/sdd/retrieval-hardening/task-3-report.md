# Task 3 report

## Implementation

- Added FastAPI quality-settings validation that overlays the dense baseline when any optional RAG quality setting is malformed or outside its bounds, while required vector/provider credentials remain fail-closed.
- Made successful TypeScript and FastAPI reranking lossless: only the configured prefix is sent to the reranker, validated prefix items are canonicalized back to the dense passages, and the untouched dense suffix is appended unchanged.
- Preserved exact passage identity and provenance by validating every identity/provenance field and using the original dense passage objects after validation.
- Classified reranker timeout, cancellation, quota/network/unavailable exceptions, malformed output, and rewritten output as fallback paths that retain the dense candidate set and populate Task 1 metrics (`candidateCount`, `acceptedCount`, hierarchy flag, usage, fallback reason, latency, model version, and retrieval configuration version).
- Kept telemetry limited to metrics dimensions; prompts, passage text, and other passage bodies are not emitted.

## Files

- `apps/api/app/config.py`
- `apps/api/app/rag/retriever.py`
- `apps/api/tests/test_retriever.py`
- `apps/web/lib/rag/retriever.ts`
- `apps/web/tests/retriever.test.ts`

## Tests and output

- Initial focused TDD run before implementation: expected red failures for dense-suffix preservation, invalid FastAPI quality settings, and reranker cancellation handling.
- `bunx vitest run tests/retriever.test.ts tests/rag-config.test.ts tests/langgraph-event-adapter.test.ts tests/rag-evaluation.test.ts`
  - **PASS** — 4 files, 45 tests.
  - Vitest emitted the existing Node `module.register()` deprecation warning.
- `./.venv/bin/pytest -q tests/test_retriever.py tests/test_graph.py`
  - **PASS** — 25 tests.
  - Pytest emitted the existing LangChain pending-deprecation warning.
- `git diff --check`
  - **PASS** — no whitespace errors.

## Concerns

- Reranker model/configuration identifiers remain the Task 1 contract values (`lexical-v1` and `rag-v1`); production model selection remains an evaluation decision.
- Rollout issue #48 remains blocked; no corpus, evaluation, or promotion artifacts were fabricated.
- Existing untracked Python `__pycache__` directories were left untouched.

## Review fix round 1

- Restored caller cancellation propagation around reranking: an aborted request signal is rethrown rather than converted into a dense result. Provider-level `AbortError` cancellation without an aborted request signal remains a typed `cancelled` fallback with dense candidates and telemetry.
- Updated the web tests to cover both provider cancellation fallback and request-abort propagation.
- Review-fix TDD run: the new caller-cancellation regression failed before the production change because the retriever resolved a dense bundle; it passes after the fix.
- `bunx vitest run tests/retriever.test.ts tests/rag-config.test.ts tests/langgraph-event-adapter.test.ts tests/rag-evaluation.test.ts`
  - **PASS** — 4 files, 46 tests.
- `./.venv/bin/pytest -q tests/test_retriever.py tests/test_graph.py`
  - **PASS** — 25 tests.
- `git diff --check`
  - **PASS** — no whitespace errors.
