# Task 7 report — server-owned canary, promotion, and rollback control

## Implementation

Added `apps/web/lib/config/canary.ts` as the server-owned rollout control seam. It provides:

- A strict, JSON-serializable `CanaryState` with `hosted`, `canary`, and `promoted` states.
- Deterministic internal cohort targeting using a server-owned salt and trusted tenant identity. Missing identity and inactive/invalid state fail closed to the hosted TypeScript (`ai-sdk`) runner. Request JSON and client headers are not consulted for targeting.
- `CanaryController.startCanary`, which accepts only a passing Task 6 `PromotionDecision` (`promote: true` with no gate reasons), validates bounded traffic, and records explicit observation and rollback windows.
- `CanaryController.promote`, which requires another passing Task 6 decision and an elapsed observation window. Promotion is an explicit operator transition; there is no automatic promotion based on traffic or time.
- `CanaryController.rollback`, which transitions canary or promoted traffic back to the hosted TypeScript runner and records a bounded operator reason. The current windows are one hour for observation and 24 hours for the documented rollback period.
- Strict serialization/deserialization and environment loading. A configured but malformed `RAG_CANARY_STATE` is rejected and the public BFF falls back to TypeScript rather than interpreting partial state.

`apps/web/app/api/question/route.ts` now consumes only a server-generated request identity when a valid serialized canary state is explicitly configured. Without that state, the existing environment-controlled preview/rollback path remains unchanged. The public request body cannot select a provider, and no canary state, credentials, endpoint, or evaluation artifact is exposed through the browser response.

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
Tests       46 passed (46)
```

The focused tests cover:

- absent authoritative baseline / failing Task 6 decision;
- deterministic tenant cohort assignment and missing-identity fallback;
- no cross-tenant assignment leakage;
- promotion blocked by a failing gate and by an incomplete observation window;
- explicit rollback to hosted fallback;
- state serialization and restoration;
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
