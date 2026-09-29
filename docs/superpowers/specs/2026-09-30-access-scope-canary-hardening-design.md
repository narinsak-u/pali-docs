# Access-Scope and Canary Hardening Design

**Date:** 2026-09-30
**Issues:** #63, #62
**Status:** Proposed implementation slice

## Goal

Finish the deterministic security and rollout gates already present in the repository, then verify every reachable acceptance criterion without claiming unavailable Linux NVIDIA/vLLM evidence. The browser contract remains unchanged.

## Current architecture

- Next.js is the browser-facing BFF.
- The BFF authenticates the internal FastAPI call with a service credential and sends a separate short-lived HMAC `X-Principal` token.
- FastAPI derives `AccessScope` from validated Principal claims. Caller-provided `X-Access-Scope` is not authorization input.
- The LangGraph runner validates application tool names, strict arguments, authorization, and typed results before returning graph state.
- Pinecone retrieval applies scope filters and rechecks returned metadata before passages enter model context.
- Provider comparison binds normalized input, scope, CorpusRevision, case identity, signed evidence, and authenticated serving identity.
- `CanaryController` owns cohort targeting, observation windows, promotion, expiry, and rollback. The browser does not select the backend.

## Required changes

### 1. Close the remaining promotion-evidence gap

`decidePromotion` currently detects corpus-revision mismatch but does not append a rejection reason. Replace the empty branch with an explicit fail-closed reason and add a regression test proving a mismatched trace cannot promote.

Keep the existing gates unchanged: reviewed-case completeness, source mappings, scope digests, CorpusRevision, serving identity, grounding/citations, quality, Unicode, tool behavior, latency, capacity, security, reliability, attestation, and rollback readiness.

### 2. Prove tool-result propagation at the graph seam

Retain the existing strict dispatcher and typed `ToolExecutionResult`. Add only the smallest graph regression test needed to prove that a validated handler result is present in the next model-stage `AgentTurnInput.tool_results`, while SSE remains metadata-only and malformed/unknown/unauthorized calls fail closed.

### 3. Prove server-owned canary behavior end to end

Use the existing `CanaryController`, trusted request context, and `selectInternalCanaryBackend`. Add no browser flag or client-side routing. Test the observable transitions:

1. hosted by default;
2. internal cohort only during canary;
3. fail-closed promotion for missing or forged artifacts;
4. deterministic hosted fallback after rollback or expiry;
5. promoted local selection only after all gates pass.

Do not add a second rollout state machine.

### 4. Keep external deployment evidence honest

Mocks MAY stand in for the private vLLM HTTP boundary in deterministic tests. They MUST NOT be used as evidence that a real NVIDIA deployment is healthy, promoted, or rollback-safe. The deployment README and issue comments must distinguish:

- verified repository tests and mocked boundary checks;
- required but unavailable Linux NVIDIA/vLLM smoke evidence;
- authoritative reviewed-case and ProductionBaseline artifacts, if unavailable.

## Data flow

```text
trusted BFF tenant context
  -> signed Principal token + service credential
  -> FastAPI validates identity and derives AccessScope
  -> AgentTurnInput/access-controlled retrieval/tool dispatch
  -> provider trace bound to scope, CorpusRevision, case, and serving identity
  -> attested comparison + reviewed cases + baseline
  -> fail-closed promotion decision
  -> server-owned canary cohort selection
  -> hosted fallback on expiry, rollback, or local failure
```

## Error handling

- Missing, invalid, expired, or mismatched Principal: reject before retrieval/model execution.
- Unsigned scope header: ignore or reject; never merge into authenticated scope.
- Unknown or malformed tool call: reject before authorization/handler execution.
- Retrieval metadata outside scope or CorpusRevision: discard/fail closed.
- Missing, forged, stale, or inconsistent promotion evidence: promotion denied with a deterministic reason.
- Local provider readiness, identity, capacity, or reliability failure: new runs use hosted provider; in-flight stream behavior remains governed by the existing terminal-event contract.

## Verification

Run focused API and web tests for the changed gates, then the full deterministic suites and build/check commands documented in `AGENTS.md`. Run the actual web/API path for smoke proof. Record external NVIDIA/vLLM and authoritative artifact blockers instead of fabricating them.

## Closure policy

Close an issue only when its acceptance criteria have observed evidence. If deterministic code and tests are complete but real deployment or authoritative artifacts are unavailable, commit the code, comment with exact blockers, and leave the issue open.
