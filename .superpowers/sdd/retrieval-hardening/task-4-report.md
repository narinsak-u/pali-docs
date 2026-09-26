# Task 4 report

## Implementation

- Added a configurable bounded parent-context representation at ingestion publication (`INGEST_MAX_PARENT_CONTEXT_CHARS`, default 1,600) and bounded published metadata again in both retrieval adapters.
- Preserved flat child evidence when hierarchy metadata is absent or expansion is disabled; complete hierarchy expansion now groups only matching source, source-version, section, parent, and parent-text metadata.
- Applied FastAPI access-scope checks after vector lookup so returned hierarchy records cannot widen authorization scope; corpus-revision checks remain authoritative.
- Kept expansion within accepted-passage and context-character budgets, trimming parent context to available budget and falling back to the unexpanded child when necessary. Parent context is added once per validated group and never creates a synthetic citation ID.
- Added a second model-consumption bound for oversized evidence envelopes in TypeScript and FastAPI prompt construction while preserving the closing evidence envelope.
- Added focused web/API/ingestion tests for scope filtering, revision-safe metadata, publication and model bounds, truncation, deduplication, citation projection, and flat fallback.

## Tests

- `./.venv/bin/pytest -q tests/test_retriever.py tests/test_graph.py` — 30 passed; existing LangChain pending-deprecation warning.
- `./.venv/bin/pytest -q tests/test_ingestion.py` — 16 passed.
- `bunx vitest run tests/retriever.test.ts tests/vector-store.test.ts tests/rag-config.test.ts tests/ai-sdk-runner.test.ts` — 4 files, 55 tests passed; existing Node `module.register()` deprecation warning.
- `git diff --check` — passed.
- `python3 -m compileall -q apps/api/app apps/ingest/app` — passed.

## Concerns

- Parent bounds default to 1,600 characters and are independently configurable at ingestion and retrieval boundaries; production rollout remains disabled pending issue #48 artifacts.
- Model-context hardening uses a fixed 50,000-character envelope cap as a final defensive bound; no prompt or passage-body telemetry was added.

## Review fix round 1

- Restored the FastAPI hierarchy expansion accumulator initialization that was omitted during the parent-group hardening edit.
- The enabled-expansion regression failed before the fix with `NameError: name 'expanded' is not defined`; it now passes with the focused hierarchy set: `5 passed, 24 deselected`.
