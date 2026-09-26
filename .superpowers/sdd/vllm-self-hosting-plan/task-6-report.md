# Task 6 report — local-versus-hosted evaluation and promotion gates

## Implementation

Added a framework-neutral evaluator at `apps/web/lib/rag/provider-evaluation.ts` and focused behavior tests at `apps/web/tests/provider-evaluation.test.ts`.

The evaluator provides:

- A versioned, JSON-serializable `ProviderTrace` and `PairedEvaluation` schema for equivalent hosted/local Runs.
- Deterministic normalized input hashing (`sha256`) and provider-scoped run IDs derived from case ID plus input digest. Hosted and local executions therefore carry the same input digest while retaining distinct, reproducible Run correlation.
- Sequential paired execution through the existing `AgentTurnRunner` seam. The same normalized message is sent to both providers; the public browser stream contract is untouched.
- Exact safe serving metadata fields for model, serving revision, endpoint, image digest, tokenizer, and allow-listed decoding settings. Endpoint user-info/query data is removed; arbitrary metadata and credentials are not copied.
- Privacy-safe traces: reports contain digests, source IDs, corpus revision, counts, outcome classes, and bounded metric values, never raw questions/prompts, rewritten queries, answer text, passage bodies, citation titles, secrets, or arbitrary exception text.
- Metric extraction for Grounding/source recall, Citation precision/completeness, expected outcome correctness, Unicode code-point/non-ASCII/NFC behavior, retrieval/generation/total latency, candidate/accepted capacity counts, token/queue capacity fields, tool attempts/successes/failures, cost, cancellation, and failure classes.
- Comparator aggregates and explicit hosted/local gates for outcome accuracy, grounding recall, citation precision/completeness, latency p95, failure rate, cancellation rate, optional cost, and optional tool-failure rate. Paired input digest, case identity, and CorpusRevision mismatches fail closed.
- A fail-closed `decidePromotion` function requiring schema-valid, `authoritative: true` reviewed-case and `ProductionBaseline` artifacts, at least 30 reviewed cases, matching CorpusRevision, execution of every reviewed case, authoritative source mappings for grounded cases, threshold identity with the ProductionBaseline, passing local gates, and explicit hosted rollback readiness. Missing or invalid artifacts never produce a synthetic baseline or promotion-ready result.

No baseline scores, reviewed source IDs, corpus revision, or promotion result were invented.

## TDD evidence

### RED

The focused tests were written first and initially failed because the new evaluator module did not exist:

```text
$ cd apps/web && bunx vitest run tests/provider-evaluation.test.ts
FAIL tests/provider-evaluation.test.ts
Error: Failed to resolve import "@/lib/rag/provider-evaluation"
```

### GREEN

After the minimal implementation and redaction/gate fixes:

```text
$ cd apps/web && bunx vitest run tests/provider-evaluation.test.ts
Test Files  1 passed (1)
Tests       4 passed (4)
```

Focused regression coverage for the existing paired comparison path:

```text
$ cd apps/web && bunx vitest run tests/provider-evaluation.test.ts tests/compare-rag.test.ts
Test Files  2 passed (2)
Tests       17 passed (17)
```

Import smoke:

```text
$ cd apps/web && bunx tsx -e 'import("./lib/rag/provider-evaluation.ts").then(() => console.log("provider evaluation import ok"))'
provider evaluation import ok
```

No formatter, linter, project-wide suite, or GPU test was run.

## External blockers and promotion status

- Issue #42 remains the authoritative source for the reviewed evaluation requirement, but the checked-in `apps/web/data/rag-eval-cases.json` is intentionally `status: "incomplete"`. It lacks the authoritative ProductionBaseline, reviewed grounded-case source mappings, and production CorpusRevision required for a real evaluation.
- The execution host is Apple Silicon Darwin without a Linux NVIDIA GPU, `nvidia-smi`, or a reachable private vLLM deployment. Real Qwen3/vLLM serving, latency, capacity, cost, and failure measurements cannot be established here.
- Consequently this change makes no production quality claim and does **not** claim promotion or canary readiness. The promotion decision remains false until the ingestion/evaluation owner supplies authoritative reviewed cases and a ProductionBaseline, and the deployment owner runs the real pinned vLLM workload on the documented Linux NVIDIA host.
- Hosted provider rollback remains required by the gate and is not removed or replaced.

## Review response

The follow-up review identified six fail-closed gaps; all were addressed in the same implementation:

1. Reviewed artifacts now reject duplicate IDs, invalid cohort/category/language/outcome/source-count combinations, missing required cohorts, and fewer than 30 cases. Promotion compares the reviewed ID set exactly with the executed paired ID set, rejecting both missing and unexpected cases.
2. The comparator rejects hosted/local trace case-ID mismatches, input-digest mismatches, AccessScope-digest mismatches, and CorpusRevision mismatches. Promotion also recomputes each reviewed case's normalized input and AccessScope digest before accepting its trace.
3. Traces retain authoritative expected/forbidden source mappings and citation safety violations. Forbidden and unknown citation sources produce a safety gate violation even if retrieval accepted the source.
4. An active cost threshold requires finite cost telemetry for every compared trace/provider; missing or partial cost measurements fail closed rather than being averaged away.
5. An active tool-failure threshold requires tool lifecycle telemetry for every compared trace/provider; absent lifecycle events fail closed rather than being treated as zero failures.
6. AccessScope is part of both provider inputs, the normalized input digest, and the redacted trace (with a safe scope projection plus digest). Sensitive scope keys are omitted.

Updated focused evidence:

```text
$ cd apps/web && bunx vitest run tests/provider-evaluation.test.ts tests/compare-rag.test.ts
Test Files  2 passed (2)
Tests       19 passed (19)
```

The authoritative #42 reviewed-case/ProductionBaseline prerequisite remains unavailable, and no baseline or promotion claim is made.
