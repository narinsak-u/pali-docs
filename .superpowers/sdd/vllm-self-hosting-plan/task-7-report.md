# Task 7 report — server-owned canary, promotion, and rollback control

## Implementation

Added `apps/web/lib/config/canary.ts` as the server-owned rollout control seam. It provides:

- A strict, JSON-serializable `CanaryState` with `hosted`, `canary`, and `promoted` states.
- Deterministic internal cohort targeting using a server-owned salt and trusted tenant identity. Missing identity and inactive/invalid state fail closed to the hosted TypeScript (`ai-sdk`) runner. Request JSON and client headers are not consulted for targeting.
- `CanaryController.startCanary`, which accepts only a passing Task 6 `PromotionDecision` (`promote: true` with no gate reasons), validates bounded traffic, and records explicit observation and rollback windows.
- `CanaryController.promote`, which requires another passing Task 6 decision and an elapsed observation window. Promotion is an explicit operator transition; there is no automatic promotion based on traffic or time.
- `CanaryController.rollback`, which transitions canary or promoted traffic back to the hosted TypeScript runner and records a bounded operator reason. The current windows are one hour for observation and 24 hours for the documented rollback period.
- Strict serialization/deserialization and environment loading. A configured but malformed `RAG_CANARY_STATE` is rejected and the public BFF falls back to TypeScript rather than interpreting partial state. Active serialized state also carries the complete Task 6 promotion input and is re-evaluated before it can target traffic.

`apps/web/app/api/question/route.ts` now consumes only a server-injected authenticated tenant identity and a server-generated request identity when a valid serialized canary state is explicitly configured. Without trusted tenant identity, without valid Task 6 evidence, or with malformed state, the route uses hosted TypeScript. Without canary state, the existing environment-controlled preview/rollback path remains unchanged. The public request body cannot select a provider, and no canary state, credentials, endpoint, or evaluation artifact is exposed through the browser response.

## TDD evidence

### RED

The canary tests were written before the new module existed:

```text
$ cd apps/web && bunx vitest run tests/canary.test.ts
FAIL tests/canary.test.ts
Error: Failed to resolve import "@/lib/config/canary"
```

The route integration tests were then run against the pre-integration route and failed for the intended reasons:

```text
$ cd apps/web && bunx vitest run tests/route.test.ts -t 'serialized server-owned|invalid serialized'
2 failed
- serialized server-owned state did not select the internal backend
- invalid serialized state did not fail closed to the TypeScript runner
```

### GREEN

After implementing the state machine and BFF wiring:

```text
$ cd apps/web && bunx vitest run tests/canary.test.ts tests/route.test.ts tests/rollout.test.ts
Test Files  3 passed (3)
Tests       50 passed (50)
```

The focused tests cover:

- absent authoritative baseline / failing Task 6 decision;
- deterministic tenant cohort assignment and missing-identity fallback;
- no cross-tenant assignment leakage;
- promotion blocked by a failing gate, missing enforceable Task 6 evidence, an incomplete observation window, and an expired rollback window;
- explicit rollback to hosted fallback;
- strict hosted-state serialization and rejection of schema-valid active-state bypasses;
- server-only serialized canary routing and invalid-state fail-closed behavior;
- existing rollout boundaries and public route behavior.

Import smoke:

```text
$ cd apps/web && bunx tsx -e 'import("./lib/config/canary.ts").then(() => console.log("canary import ok"))'
canary import ok
```

No formatter, linter, project-wide suite, or GPU test was run.

## Current promotion status

**No promotion or canary readiness is claimed.** The checked-in Task 6 evaluation manifest remains intentionally incomplete (`apps/web/data/rag-eval-cases.json` has no authoritative corpus revision, reviewed source mappings, or `ProductionBaseline`). Consequently `decidePromotion` returns a non-promoting decision, and this state machine remains in hosted fallback unless an operator supplies a valid state produced from a real passing decision. No baseline scores, traffic evidence, quality claim, or serving claim was invented.

The state machine does not manufacture a baseline, infer gate output from operational metrics, or promote because a timer elapsed. A valid state is an internal control-plane artifact, not a public endpoint or client-selectable mode.

## No-GPU limitation and external prerequisites

The execution host is Apple Silicon Darwin without a Linux NVIDIA GPU, `nvidia-smi`, or a reachable private vLLM deployment. Real Qwen3/vLLM serving, capacity, latency, cost, failure, and canary observations cannot be established here.

Before any real canary or promotion, external owners must:

1. Supply the authoritative issue #42 reviewed evaluation cases, source-ID mappings, corpus revision, and `ProductionBaseline` artifact.
2. Run Task 6 paired hosted/local evaluation on the immutable Linux NVIDIA deployment and verify every quality, security, reliability, capacity, cost, cancellation, and tool-lifecycle gate.
3. Confirm hosted rollback readiness and keep the TypeScript runner available for the documented 24-hour rollback window.
4. Persist and distribute only the server-owned serialized canary state through the deployment control plane; do not accept state, provider selection, tenant scope, or credentials from browser requests.
5. Exercise real private vLLM readiness/completion, ingress isolation, authenticated metrics, and rollback on the deployment host.

## Review response

The focused re-review identified three fail-closed issues; all are addressed in this revision:

1. The public route no longer derives tenant identity from `runId`. Canary targeting requires a trusted server-injected `authenticatedTenantId` request property supplied by authentication middleware; if that identity is absent, canary state routes to hosted TypeScript. Request JSON and client headers remain unusable for targeting. Deterministic same-tenant and missing-identity tests cover this seam.
2. Active serialized canary/promoted state now carries `CanaryPromotionEvidence`: the complete Task 6 `PromotionDecision` plus its comparison/reviewed-cases/ProductionBaseline/rollback input. Deserialization recomputes `decidePromotion`, requires an exact passing decision, and rejects schema-valid state without enforceable authoritative evidence. A bypass-state regression verifies this fail-closed behavior.
3. Promotion rejects the exact rollback-window boundary and any later timestamp, requiring revalidation rather than entering all-traffic promoted state after the documented window.

RED evidence for this review:

```text
$ cd apps/web && bunx vitest run tests/canary.test.ts tests/route.test.ts -t 'canary|serialized|promotion|rollback|trusted traffic|cross-tenant|deterministically|baseline'
3 failed
- passing-looking decision without Task 6 evidence was accepted before evidence enforcement
- active state serialized without promotion evidence before strict persistence validation
- schema-valid canary state attempted backend targeting before route fail-closed integration
```

GREEN evidence after the fixes:

```text
$ cd apps/web && bunx vitest run tests/canary.test.ts tests/route.test.ts
Test Files  2 passed (2)
Tests       29 passed (29)
```

The external #42 reviewed-case and ProductionBaseline prerequisite remains unavailable; this revision still makes no promotion or canary-readiness claim.

## Re-review response 2

The second re-review identified two remaining trust and persistence concerns; both are closed:

1. There is no existing authentication middleware in this worktree. The route therefore uses a conservative, symbol-keyed `withAuthenticatedTenant` server-only context producer and `getAuthenticatedTenantId` consumer. The context cannot be supplied through HTTP headers or request JSON. Until deployment authentication middleware calls this producer, every real request remains hosted fallback; no canary readiness is claimed. The route seam test covers both the trusted producer path and absent-identity hosted fallback.
2. `CanaryController` now strictly validates active initial state and `promote` re-runs `decidePromotion` against the stored full evidence, requiring an exact match with the caller decision. Evidence-less in-memory bypass states cannot be initialized, and a promotion cannot proceed if the stored Task 6 decision is stale or altered. The rollback-window boundary remains a hard rejection.

RED evidence for this review:

```text
$ cd apps/web && bunx vitest run tests/canary.test.ts tests/route.test.ts
2 failed
- evidence-less active state could be initialized before strict constructor validation
- promotion did not revalidate stored Task 6 evidence before the fix
```

GREEN evidence after the fixes:

```text
$ cd apps/web && bunx vitest run tests/canary.test.ts tests/route.test.ts
Test Files  2 passed (2)
Tests       32 passed (32)
```

The missing authentication producer and issue #42 authoritative reviewed-case/ProductionBaseline artifacts are explicit external prerequisites. This revision still makes no promotion or canary-readiness claim.

## Re-review response 3

The final re-review found that an exported route helper could accept an unvalidated `LoadedCanaryState`. The raw override was removed. `selectQuestionBackend` now always loads state through `readCanaryState`, which strictly deserializes and re-evaluates Task 6 evidence before targeting. A schema-valid-looking promoted state without evidence remains hosted; only a validated state plus the symbol-keyed trusted tenant context targets the internal backend in the seam test.

RED evidence:

```text
$ cd apps/web && bunx vitest run tests/canary.test.ts tests/route.test.ts
The route trusted-state test failed before the loader-only helper change because the helper accepted a direct raw state override.
```

GREEN evidence:

```text
$ cd apps/web && bunx vitest run tests/canary.test.ts tests/route.test.ts
Test Files  2 passed (2)
Tests       32 passed (32)
```

No auth middleware is present in this repository, so the external deployment prerequisite remains to call `withAuthenticatedTenant` from the authenticated server context. Until then, all real traffic remains hosted fallback and no canary readiness or promotion is claimed.
