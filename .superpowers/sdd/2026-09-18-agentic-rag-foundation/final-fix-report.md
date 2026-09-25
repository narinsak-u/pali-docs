# Final fix report

## Scope and ruling

This fix wave addresses the two actionable Important findings from the final review package `review-96b0f50..30c2998.diff`:

- **Finding A — quota classification:** a model-stage rejection was caught inside `AiSdkAgentTurnRunner` and converted to `runner_error`, so the framework-neutral result/event path could not preserve the stable `insufficient_quota` code.
- **Finding B — per-record corpus revision:** `queryPinecone` accepted citation-safe text/source/title metadata without checking each record's corpus revision, while the retriever labeled the resulting bundle with the configured revision.

The final review's answer-streaming finding remains intentionally parked under the controller ruling. No incremental answer-streaming behavior was changed; validated answer text is still emitted only through the existing `answer.completed` event mapping.

## Finding A: quota classification

### RED

```text
$ bunx vitest run tests/ai-sdk-runner.test.ts
❯ tests/ai-sdk-runner.test.ts (13 tests | 1 failed)
× classifies a quota rejection from a model stage as insufficient_quota
- Expected code: insufficient_quota
+ Received code: runner_error
```

The route regression was then added with a real `createAiSdkAgentTurnRunner` and an injected `decide` model-stage rejection. Before the fix it produced the runner's generic failure code rather than `insufficient_quota`.

### GREEN

```text
$ bunx vitest run tests/ai-sdk-runner.test.ts
Test Files  1 passed (1)
Tests       13 passed (13)

$ bunx vitest run tests/route.test.ts
Test Files  1 passed (1)
Tests       9 passed (9)
```

`ai-sdk-runner.ts` now maps cancellation first, quota/429 classification second, and all other exceptions to `runner_error`. The runner returns `{ outcome: "failed", code: "insufficient_quota" }` and emits exactly one `run.failed` terminal event. The route regression verifies a model-stage rejection reaches the committed stream as a validated terminal `data-outcome` with no provider error text in the public payload.

## Finding B: corpus revision enforcement

### RED

```text
$ bunx vitest run tests/vector-store.test.ts
❯ tests/vector-store.test.ts (8 tests | 1 failed)
× drops missing, stale, and mixed corpus revisions while retaining matching records
Expected: only the matching record
Received: matching, missing, and stale records
```

### GREEN

```text
$ bunx vitest run tests/vector-store.test.ts
Test Files  1 passed (1)
Tests       8 passed (8)

$ bunx vitest run tests/retriever.test.ts
Test Files  1 passed (1)
Tests       13 passed (13)
```

`vector-store.ts` now requires the canonical `metadata.corpusRevision` value to be a nonempty string equal to `getRagConfig().PINECONE_CORPUS_REVISION` before constructing a `GroundingPassage`. Missing, stale, and mixed-revision matches are dropped; matching records retain the existing citation-safe mapping. Retriever coverage verifies a valid accepted passage is labeled with the configured bundle revision.

## Files changed

- `lib/agent/ai-sdk-runner.ts` — preserve quota classification in runner result/event handling.
- `lib/services/vector-store.ts` — enforce per-record `corpusRevision` equality before passage construction.
- `tests/ai-sdk-runner.test.ts` — model-stage quota rejection regression and one-terminal-event assertion.
- `tests/route.test.ts` — real runner/model-stage quota rejection stream regression and public-payload redaction assertion.
- `tests/vector-store.test.ts` — matching, missing, stale, and mixed revision metadata coverage.
- `tests/retriever.test.ts` — valid matching revision bundle-label coverage.
- `final-fix-report.md` — this report.

## Focused verification

```text
$ bunx vitest run tests/ai-sdk-runner.test.ts tests/route.test.ts tests/vector-store.test.ts tests/retriever.test.ts
Test Files  4 passed (4)
Tests       43 passed (43)
```

No event schema file required changes. The external live Pinecone index was not queried or altered. Project-wide tests, builds, formatters, and linters were intentionally skipped per the fix-wave constraints; the controller owns branch-wide validation.

## Concerns

- Production rollout remains externally blocked until the ingestion owner publishes chunks stamped with `corpusRevision` equal to the deployed immutable `PINECONE_CORPUS_REVISION`; records without that metadata will now fail closed as intended.
- The existing quota classifier is reused so provider details remain server-side and generic internal failures retain `runner_error` handling.
- Vitest reports Node's existing `module.register()` deprecation warning during focused runs; it did not fail any test.
