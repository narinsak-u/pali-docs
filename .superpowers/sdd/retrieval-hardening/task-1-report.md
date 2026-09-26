# Task 1 report: retrieval provenance and metrics contract

## Implementation

- Extended TypeScript and FastAPI grounding provenance with optional backward-compatible `sourceVersion`, `section`, and hierarchy parent identity (`parentId`); validated source version, corpus revision, source identity consistency, and hierarchy metadata at both vector adapters.
- Preserved provenance through accepted passages, citations, XML model context, retrieval events, and API citation events without adding passage bodies to telemetry.
- Added shared reranker fallback reason classes (`disabled`, `timeout`, `unavailable`, `invalid-output`, `cancelled`), reranker latency, reranker model version, and retrieval configuration version to retrieval metrics and event/evaluation contracts.
- Added dense baseline telemetry (`rag-v1` configuration and `lexical-v1` reranker version), classified TypeScript and FastAPI reranker failures, and retained unavailable versus insufficient-evidence behavior.
- Added strict web event handling: successful reranker events require null fallback reason plus latency/model/configuration dimensions; legacy events may omit optional additions.
- Extended paired evaluation record collection from retrieval events while retaining the existing no-prompts/no-answers/no-passage-bodies contract.

## Files changed

### Web

- `apps/web/lib/rag/types.ts`
- `apps/web/lib/rag/retriever.ts`
- `apps/web/lib/services/vector-store.ts`
- `apps/web/lib/schemas/ai-data-parts.ts`
- `apps/web/lib/agent/types.ts`
- `apps/web/lib/agent/langgraph-event-adapter.ts`
- `apps/web/lib/agent/ai-sdk-runner.ts`
- `apps/web/lib/rag/evaluation.ts`
- `apps/web/scripts/evaluate-rag.ts`
- `apps/web/tests/vector-store.test.ts`
- `apps/web/tests/retriever.test.ts`
- `apps/web/tests/rag-evaluation.test.ts`
- `apps/web/tests/langgraph-event-adapter.test.ts`

### FastAPI

- `apps/api/app/rag/types.py`
- `apps/api/app/rag/retriever.py`
- `apps/api/app/agent/graph.py`
- `apps/api/tests/test_retriever.py`
- `apps/api/tests/test_graph.py`

## Focused verification

- `bunx vitest run tests/langgraph-event-adapter.test.ts tests/vector-store.test.ts tests/retriever.test.ts tests/rag-evaluation.test.ts tests/ai-sdk-runner.test.ts tests/agent-event-sink.test.ts`
  - **PASS** — 6 test files, 66 tests.
  - Vitest emitted the existing Node `module.register()` deprecation warning.
- `./.venv/bin/pytest -q tests/test_retriever.py tests/test_graph.py`
  - **PASS** — 17 tests.
  - Pytest emitted the existing LangChain pending-deprecation warning.
- `git diff --check`
  - **PASS** — no whitespace errors.

## Concerns

- Reranker and retrieval configuration version values are explicit runtime contract values (`lexical-v1` and `rag-v1`); selecting production model/version identifiers remains an evaluation/rollout decision.
- Full web/API/ingestion suites and Next.js compilation were intentionally not run per the Task 1 focused-validation requirement; the integration owner should run them after sibling hardening tasks land.
- Existing untracked Python `__pycache__` directories were left untouched.

## Review round 1 fix report

- Preserved mixed-version stream compatibility by treating reranker events with only the legacy `rerankerUsed` field as legacy; strict telemetry completeness is applied when a new telemetry dimension is present.
- Restored the FastAPI `_matches` empty-sequence fallback so malformed or missing Pinecone match collections produce the existing insufficient-evidence path.
- Added runtime reranker output-shape validation in TypeScript; null, non-array, null-item, and invalid-content outputs use `invalid-output`, while provider exceptions retain `unavailable`.
- Switched TypeScript reranker latency measurement from wall-clock `Date.now()` to monotonic `performance.now()`.
- Restored explicit serialized evaluation-record privacy assertions for prompt text, answer text, and passage IDs.

### Review fix verification

- Initial regression tests were red for the legacy adapter event, malformed API match collection, and malformed web reranker output before implementation.
- `bunx vitest run tests/langgraph-event-adapter.test.ts tests/retriever.test.ts tests/rag-evaluation.test.ts`
  - **PASS** — 3 test files, 40 tests.
- `./.venv/bin/pytest -q tests/test_retriever.py`
  - **PASS** — 13 tests.

- Final focused contract run after all fixes:
  - Web Vitest: **PASS** — 6 test files, 68 tests.
  - FastAPI pytest: **PASS** — 18 tests.
