# Shadow Controlled Traffic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Compare the TypeScript and FastAPI/LangGraph runners safely, then add deterministic server-side backend rollout with TypeScript fallback.

**Architecture:** Reuse the existing TypeScript evaluation manifest, record shape, aggregate metrics, and SSE event adapter. Add one comparison script that treats each runner as an adapter, and one small rollout-policy module consumed by the Next.js question route. The current TypeScript runner remains the safe default and fallback.

**Tech Stack:** TypeScript, Next.js App Router, Vitest, Zod, Node `fetch`, existing FastAPI SSE contract.

**Spec:** `docs/superpowers/specs/2026-09-18-shadow-controlled-traffic-design.md`

## Global Constraints

- The comparison command must fail closed until `data/rag-eval-cases.json` contains a ready manifest with corpus revision, baseline, and reviewed cases.
- Both runners must use the same evaluation case and corpus revision.
- The public boundary remains `apps/web/app/api/question/route.ts`.
- Client input cannot select a runner, widen ACL scope, or disable fallback.
- Invalid rollout configuration must use the safe TypeScript default.
- FastAPI timeout, unavailable response, malformed SSE, or invalid terminal outcome must preserve current public error behavior.
- Do not run duplicate live model calls by default.
- Existing web, API, ingest, and contract suites remain passing.

---

### Task 1: Add deterministic rollout policy

**Files:**
- Create: `apps/web/lib/config/rollout.ts`
- Test: `apps/web/tests/rollout.test.ts`

**Interfaces:**
- Produce `type RagBackend = "ai-sdk" | "langgraph"`.
- Produce `interface RolloutConfig { backend: RagBackend; trafficPercent: number }`.
- Produce `function getRolloutConfig(env?: NodeJS.ProcessEnv): RolloutConfig`.
- Produce `function selectRagBackend(runId: string, config: RolloutConfig): RagBackend`.

**Steps:**

- [ ] Add tests for default TypeScript routing, explicit `RAG_BACKEND=langgraph`, invalid backend fallback, percentage values `0`, `100`, negative, above `100`, non-numeric, and deterministic assignment for the same run ID.
- [ ] Parse `RAG_BACKEND` as `ai-sdk` or `langgraph`; unknown values resolve to `ai-sdk`.
- [ ] Parse `RAG_LANGGRAPH_TRAFFIC_PERCENT` as a finite integer from `0` through `100`; invalid values resolve to `0` rather than widening traffic.
- [ ] Hash the server-created `runId` with a stable non-cryptographic integer hash and map it to a bucket from `0` through `99`.
- [ ] Select LangGraph when explicit backend mode is `langgraph`, or when the bucket is below the configured percentage; otherwise select AI SDK.
- [ ] Run `cd apps/web && bunx vitest run tests/rollout.test.ts`.
- [ ] Commit as `✨ feat(rollout/config): add safe backend assignment`.

### Task 2: Add paired evaluation harness

**Files:**
- Create: `apps/web/scripts/compare-rag.ts`
- Modify: `apps/web/package.json` (`compare:rag` script)
- Test: `apps/web/tests/compare-rag.test.ts`

**Interfaces:**
- Consume `RagEvaluationManifest`, `ReadyRagEvaluationManifest`, `RagEvaluationRecord`, `aggregateEvaluation`, `evaluateGates`, and `runEvaluationCase` from existing evaluation modules.
- Produce `interface ComparisonRecord { caseId: string; aiSdk: RagEvaluationRecord; langGraph: RagEvaluationRecord; deltas: { latencyMs: number; outcomeChanged: boolean; citationPrecision: number; citationCompleteness: number } }`.
- Produce `function compareRecords(aiSdk: RagEvaluationRecord, langGraph: RagEvaluationRecord): ComparisonRecord`.
- Produce `function assertComparisonReady(manifest: unknown, configuredRevision: string): ReadyRagEvaluationManifest`.
- Produce `function createFastApiRunner(options: { baseUrl: string; internalToken: string; fetchImpl?: typeof fetch }): AgentTurnRunner`, where `runTurn` sends the `AgentTurnInput` JSON to `/v1/question`, consumes the response through `consumeLangGraphSse`, records retrieval/citation events into the supplied sink, and returns the terminal `AgentTurnResult`.

**Steps:**

- [ ] Add tests for incomplete manifest rejection, missing corpus revision, configured revision mismatch, paired delta calculation, malformed FastAPI status/content type, and terminal `run.failed` handling.
- [ ] Load `data/rag-eval-cases.json` and call `parseEvaluationManifest` plus `assertEvaluationManifestReady` before creating either runner or HTTP request.
- [ ] Require `PINECONE_CORPUS_REVISION` to equal the ready manifest revision before running cases.
- [ ] Run the existing TypeScript runner through `runEvaluationCase`.
- [ ] Call FastAPI `POST /v1/question` with server-generated `runId`, the same user messages, and `Authorization: Bearer ${FASTAPI_INTERNAL_TOKEN}`; require `text/event-stream` and consume the existing event envelope parser through `consumeLangGraphSse`.
- [ ] Normalize both outputs into the existing record shape, including outcome, source IDs, citation IDs, stage latency, cancellation, and failure fields where available.
- [ ] Write one paired JSON object per case to `RAG_COMPARE_OUTPUT_DIR` (default `results/rag-comparison`) and print aggregate metrics plus per-runner gate violations.
- [ ] Exit nonzero on manifest/revision/configuration failures or gate violations; never run a partial comparison as a passing result.
- [ ] Add `compare:rag` to `apps/web/package.json`.
- [ ] Run `cd apps/web && bunx vitest run tests/compare-rag.test.ts`.
- [ ] Commit as `📊 feat(evaluation/compare): add paired runner comparison`.

### Task 3: Integrate controlled routing and fallback

**Files:**
- Modify: `apps/web/app/api/question/route.ts`
- Test: `apps/web/tests/route.test.ts`

**Interfaces:**
- Consume `getRolloutConfig` and `selectRagBackend` from `@/lib/config/rollout`.
- Keep `POST(req: Request): Promise<Response>` unchanged.
- Keep `createAiSdkAgentTurnRunner` as the fallback path.

**Steps:**

- [ ] Add route tests proving server-generated run IDs select the configured backend, client body fields cannot select a backend, invalid rollout config chooses AI SDK, and backend HTTP/network failures fall back to AI SDK before any SSE bytes are returned.
- [ ] Replace the direct `process.env.RAG_BACKEND` branch with `selectRagBackend(runId, getRolloutConfig())`.
- [ ] Extract the existing AI SDK stream creation into a local fallback function so LangGraph setup failures and non-streaming/non-OK responses can call it without duplicating runner logic.
- [ ] Keep existing public error mapping when the fallback itself cannot start; do not expose backend details to clients.
- [ ] Do not fallback after LangGraph SSE bytes have been consumed; preserve the existing stream error behavior and log the run ID.
- [ ] Run `cd apps/web && bunx vitest run tests/route.test.ts`.
- [ ] Commit as `🚦 feat(rollout/bff): add controlled LangGraph routing`.

### Task 4: Verify Phase 4 and update commands

**Files:**
- Modify: `justfile` (`compare-rag` recipe)
- Modify: `docs/RAG-WORKFLOW.md` (rollout and rollback instructions)
- Modify: `.superpowers/sdd/MONOREPO-ARCHITECTURE-PLAN/progress.md` (ignored ledger if present)

**Steps:**

- [ ] Add `just compare-rag` delegating to `cd apps/web && bun run compare:rag`.
- [ ] Document default routing, percentage rollout, fallback boundary, required FastAPI token, and the incomplete-manifest fail-closed behavior.
- [ ] Run the focused rollout/comparison/route tests.
- [ ] Run `mise x uv@0.12.12 -- mise x just@1.58.0 -- just test`.
- [ ] Run `mise x uv@0.12.12 -- mise x just@1.58.0 -- just check-contracts`.
- [ ] Run `mise x uv@0.12.12 -- mise x just@1.58.0 -- just compare-rag`; with the current incomplete manifest, verify it exits nonzero before invoking either runner.
- [ ] Record that live Phase 4 traffic remains gated by an authoritative evaluation corpus revision and baseline.
- [ ] Commit as `✅ chore(rollout/verify): verify Phase 4 safety gates`.
