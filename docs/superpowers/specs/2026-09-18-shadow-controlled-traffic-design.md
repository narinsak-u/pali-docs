# Phase 4 — Shadow and Controlled Traffic

## Goal

Compare the existing TypeScript AI SDK runner with the FastAPI/LangGraph runner using identical evaluation cases and corpus revisions, then enable the backend for a bounded internal cohort without losing the current runner as an immediate rollback path.

## Scope

Phase 4 adds comparison and routing controls. It does not remove the TypeScript runner, change public request/response contracts, or promote live traffic before the evaluation manifest has an authoritative corpus revision and baseline.

The current evaluation manifest is intentionally incomplete. The comparison command must fail closed until `data/rag-eval-cases.json` contains a corpus revision, baseline, and reviewed cases.

## Design

### Paired evaluation

Extend the existing evaluation workflow rather than creating a second metric vocabulary. Add a comparison command under `apps/web/scripts/` that:

- loads and validates the shared evaluation manifest;
- requires the configured corpus revision to equal the manifest revision;
- runs each case through the current TypeScript runner;
- calls the authenticated FastAPI `/v1/question` SSE endpoint with the same case and revision context;
- converts both results into the existing evaluation record shape;
- writes paired JSONL records plus aggregate deltas;
- reports outcome, grounding, citation validity, retrieved source IDs, latency, token/cost fields when available, cancellation, and failure differences;
- exits nonzero for manifest readiness failures or configured evaluation-gate violations.

The comparison must preserve each runner's native event and terminal semantics. It must not expose private LangGraph state or bypass existing deterministic evidence/citation checks.

### Controlled routing

Keep `apps/web/app/api/question/route.ts` as the public boundary. Add server-side routing configuration that:

- defaults all traffic to the TypeScript runner;
- supports an explicit `RAG_BACKEND=langgraph` emergency/preview switch already used by the route;
- supports a deterministic percentage rollout using a server-owned request identity, never client-controlled access scope;
- keeps the TypeScript runner available as the fallback when the backend is disabled or unavailable;
- emits no user-visible shadow response and does not run duplicate live model calls by default.

Routing configuration is environment-only and fails closed for invalid percentages. Rollback is one configuration change with no deploy-time code edit.

### Rollout sequence

1. Run paired offline comparisons against the frozen manifest and corpus revision.
2. Record the comparison artifact and gate violations.
3. Enable LangGraph for an authenticated internal cohort only after the offline gate passes.
4. Increase to a small percentage while monitoring quality, unavailable rate, invalid citations, latency, cost, cancellation, and fallback rate.
5. Keep the TypeScript runner enabled until the rollback window expires.

## Failure and safety rules

- Missing or incomplete evaluation manifest: stop before any comparison or rollout.
- Corpus revision mismatch: stop before invoking either runner.
- Invalid rollout percentage or unknown backend mode: reject configuration and use the safe TypeScript default.
- FastAPI timeout, unavailable response, malformed SSE, or invalid terminal outcome: preserve the current public error behavior and record the failure for comparison/operations.
- Client input cannot select a runner, widen ACL scope, or disable fallback.

## Verification

- Unit tests cover manifest readiness, revision matching, paired-record normalization, metric deltas, rollout percentage boundaries, deterministic assignment, invalid configuration, and fallback behavior.
- A local smoke path exercises the comparison command with injected runners; no live provider credentials are required for tests.
- Existing web, API, ingest, and contract suites remain passing.
- Live rollout verification remains blocked until the evaluation manifest has the authoritative corpus revision and baseline.

## Non-goals

- Removing the TypeScript runner.
- Adding durable checkpoints, new telemetry infrastructure, or a separate evaluation framework.
- Running duplicate live model calls for every request.
- Claiming Phase 4 gate completion from unit tests alone.
