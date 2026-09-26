# Retrieval hardening final-fix report

## Findings fixed

- API RAG boolean environment values are now accepted only when they are canonical `true` or `false` strings (or already-typed Python booleans). Any other present raw value triggers the existing dense-quality fallback, matching the TypeScript Zod configuration behavior.
- The ingestion publisher now derives each chunk's section order per source and recomputes the canonical parent ID with the shared `_parent_id` helper before embedding. A forged parent ID is rejected before any embedding or upsert callback runs.

## Focused verification

```text
$ apps/api/.venv/bin/python -m pytest -q apps/api/tests/test_retriever.py
.................                                                        [100%]
17 passed in 0.05s

$ apps/ingest/.venv/bin/python -m pytest -q apps/ingest/tests/test_ingestion.py
.....................................                                    [100%]
37 passed in 0.07s

$ bun run test:run tests/rag-config.test.ts  (from apps/web)
Test Files  1 passed (1)
Tests       1 passed (1)
```

The API tests cover non-canonical values (`yes`, `1`, uppercase, and whitespace variants), canonical `true`/`false` environment values, and dense-default parity. The ingestion regression test asserts that forged parent identity causes `PublishError` with zero external callback calls.

## Round-two review fix

Publisher section boundaries now use the same `(source_id, source_version, section, parent_text)` parent key as manifest validation. This preserves distinct section occurrences when headings repeat, while retaining the forged-parent rejection before external calls.

```text
$ apps/ingest/.venv/bin/python -m pytest -q apps/ingest/tests/test_ingestion.py -k repeated_heading
.                                                                        [100%]
1 passed, 17 deselected in 0.03s

$ apps/ingest/.venv/bin/python -m pytest -q apps/ingest/tests/test_ingestion.py -k forged_parent
.                                                                        [100%]
1 passed, 17 deselected in 0.03s

$ apps/ingest/.venv/bin/python -m pytest -q apps/ingest/tests/test_ingestion.py
..................                                                       [100%]
18 passed in 0.06s
```
