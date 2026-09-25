# Task 2 report — paired evaluation harness

## Files

- `apps/web/scripts/compare-rag.ts`
- `apps/web/tests/compare-rag.test.ts`
- `apps/web/package.json`

## Test output

Command:

```text
cd apps/web && bunx vitest run tests/compare-rag.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests       11 passed (11)
```

## Commit

`8210bb6` — `📊 feat(evaluation/compare): add paired runner comparison`

The report originally recorded the pre-report commit `28c1890`; the commit was amended to include this required report, producing `8210bb6`. This docs-only correction records the final HEAD.

## Fix follow-up

- Added the missing `node:fs/promises` import for the CLI's `readFile`, `mkdir`, and `open` calls.
- Focused tests still pass: `1` file, `11` tests.
- Direct TypeScript import smoke passed: `compare-rag import ok`.

## Concerns

- The current FastAPI event contract exposes citation source IDs but not the complete retrieved-source list. The comparison harness records the available citation source IDs as LangGraph observed evidence; retrieval recall for that runner remains limited by the existing SSE contract.
- The checked-in evaluation manifest is intentionally incomplete, so the CLI fails closed before creating either runner or making network requests until the authoritative corpus revision and reviewed cases are supplied.
