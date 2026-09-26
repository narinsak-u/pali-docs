# Task 5 report: cross-runtime parity and evaluation behavior

## Implementation

- Added the shared test-only contract fixture at `tests/fixtures/retrieval-parity.json`; web and FastAPI tests consume the same corpus revision, dense matches, invalid metadata records, hierarchy parent context, reranking prefix, expected dense suffix, fallback reason, metrics, and projected citation IDs.
- Added web parity coverage for stale/forged metadata rejection, hierarchy expansion with bounded parent context, child-only citation projection, reranking fallback metrics, dense suffix preservation, and JSON metric serialization.
- Added FastAPI parity coverage for the same metadata, hierarchy, context, reranking, suffix, metrics, and citation contracts.
- Added an explicit paired comparison summary containing labeled dense `baseline`, retrieval-quality `candidate`, and candidate-minus-baseline `deltas`; the comparison CLI emits this as `pairedComparison` while retaining the existing aggregate fields.
- Preserved fail-closed comparison readiness: manifest parsing/readiness and the configured corpus-revision match happen before runner construction or FastAPI/network access. Rollout issue #48 remains disabled; no evaluation manifest or corpus artifact was added.

## Tests

- `bunx vitest run tests/compare-rag.test.ts` — initial red test observed (`createComparisonSummary is not a function`), then 13 passed after the minimal implementation.
- `bunx vitest run tests/retrieval-parity.test.ts tests/vector-store.test.ts` — 2 files, 15 passed.
- `./.venv/bin/pytest -q tests/test_retrieval_parity.py` — 4 passed.
- `bun run test:run` — 24 files, 198 passed; existing Node `module.register()` deprecation warning.
- `./.venv/bin/pytest -q` in `apps/api` — 43 passed; existing LangChain pending-deprecation warning.
- `./.venv/bin/pytest -q` in `apps/ingest` — 16 passed.
- `bunx next build` — compiled successfully and completed type checking/static generation.
- `bun run build` — Next compilation completed, but the script exited in its separate `update-index.mjs` step because Algolia credentials are unavailable (`NEXT_PUBLIC_ALGOLIA_APP_ID` / `ALGOLIA_ADMIN_API_KEY`).

## Concerns

- The shared fixture is synthetic contract-level test data only; no reviewed evaluation cases, corpus revision, source mapping, or promotion artifact was fabricated.
- The requested production build's Next.js compilation is verified independently; the combined build script still requires unavailable Algolia indexing credentials.
