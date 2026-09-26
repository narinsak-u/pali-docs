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
