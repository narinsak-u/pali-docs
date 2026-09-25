# LangGraph Runner Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a raw LangGraph runner behind the existing `AgentTurnRunner` contract and compare it fairly with the AI SDK production runner before any adoption decision.

**Architecture:** LangGraph owns typed workflow state and conditional routing only. Existing AI SDK model-stage functions, the grounded `Retriever`, `AgentEventSink`, request validation, and UI transport remain authoritative. The graph runs inline in the current Node.js route without checkpoints, subgraphs, interrupts, LangChain agents, or Agent Server.

**Tech Stack:** TypeScript, `@langchain/langgraph` 1.4+, `@langchain/core`, Zod 4.2+, Vercel AI SDK 5, Next.js 15, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-18-agentic-rag-design.md`

**Prerequisite:** Complete `docs/superpowers/plans/2026-09-18-agentic-rag-foundation.md`, including the AI SDK baseline evaluation.

## Global Constraints

- Do not introduce LangChain `createAgent`, LangChain model wrappers, checkpointers, stores, subgraphs, interrupts, or Agent Server.
- Reuse the same model ID, prompts, retrieval policy, corpus revision, stage functions, event contract, and evaluation cases as the AI SDK runner.
- Exactly one runner executes for each production request.
- The default and rollback runner remains `ai-sdk` until all promotion gates pass.
- LangGraph state and stream values never cross the route/UI boundary.
- Every cycle is bounded by the shared limits: two retrieval attempts and one citation repair.
- Pin compatible dependency ranges and commit `bun.lock`.
- Commit messages use `<emoji> <type>(<task>/<domain>): <message>`.

## File map

| Path | Responsibility |
|---|---|
| `lib/agent/model-stages.ts` | Shared model-stage interfaces and AI SDK implementation used by both runners. |
| `lib/agent/langgraph/state.ts` | Internal graph state schema and route names. |
| `lib/agent/langgraph/nodes.ts` | Nodes and pure routing functions. |
| `lib/agent/langgraph/runner.ts` | Compiles/runs the graph and adapts custom events to `AgentEventSink`. |
| `lib/agent/runner-factory.ts` | Validates `RAG_RUNNER` and constructs one runner. |
| `tests/agent-runner-conformance.ts` | Shared observable contract suite. |
| `tests/langgraph-nodes.test.ts` | Pure route and node behavior. |
| `tests/langgraph-runner.test.ts` | Graph event/result integration. |
| `tests/runner-factory.test.ts` | Selection, invalid config, and default behavior. |
| `scripts/evaluate-rag.ts` | Adds `--runner ai-sdk|langgraph` and comparable reports. |

### Task 1: Extract shared model stages without changing behavior

**Files:**
- Create: `lib/agent/model-stages.ts`
- Modify: `lib/agent/ai-sdk-runner.ts`
- Modify: `tests/ai-sdk-runner.test.ts`

**Interfaces:**
- Produces: `AgentModelStages` used by both runners.

```ts
export interface AgentModelStages {
  decide(input: AgentTurnInput, signal?: AbortSignal): Promise<RetrievalDecision>;
  rewrite(
    input: AgentTurnInput,
    currentQuery: string,
    attempt: number,
    signal?: AbortSignal,
  ): Promise<string>;
  draftGroundedAnswer(
    input: AgentTurnInput,
    grounding: GroundedBundle,
    signal?: AbortSignal,
  ): Promise<AnswerDraft>;
  repairCitations(
    input: AgentTurnInput,
    grounding: GroundedBundle,
    draft: AnswerDraft,
    signal?: AbortSignal,
  ): Promise<AnswerDraft>;
  draftDirectAnswer(
    input: AgentTurnInput,
    signal?: AbortSignal,
  ): Promise<DirectAnswerDraft>;
}
```

- [ ] **Step 1: Add a type-level and behavior test for injected stages**

Update `tests/ai-sdk-runner.test.ts` so it constructs the runner with one `AgentModelStages` object and verifies the same direct, rewrite, grounding, repair, and suggestion outcomes as before.

- [ ] **Step 2: Run the AI SDK runner test before extraction**

Run: `bunx vitest run tests/ai-sdk-runner.test.ts`

Expected: FAIL after the test imports `AgentModelStages` from the new path.

- [ ] **Step 3: Move stage interfaces and AI SDK stage construction**

Move only model-call concerns into `model-stages.ts`. Keep transition limits and outcome decisions inside runners. `createAiSdkModelStages()` must use the exact schemas, prompts, provider, model, temperature, and abort behavior already established by the foundation.

- [ ] **Step 4: Verify no behavior changed**

Run: `bunx vitest run tests/ai-sdk-runner.test.ts tests/route.test.ts`

Expected: PASS with unchanged observable event sequences and terminal outcomes.

- [ ] **Step 5: Commit the shared stage seam**

```bash
git add lib/agent/model-stages.ts lib/agent/ai-sdk-runner.ts tests/ai-sdk-runner.test.ts
git commit -m "♻️ refactor(rag/runner): share model stage contracts"
```

### Task 2: Add compatible LangGraph dependencies

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`

**Interfaces:**
- Produces: available `StateGraph`, `StateSchema`, graph config writer, and Zod 4 schema support.

- [ ] **Step 1: Add the minimum packages**

Run:

```bash
bun add @langchain/langgraph@^1.4.0 @langchain/core zod@^4.2.0
```

Do not add `langchain`, `@ai-sdk/langchain`, model-provider packages, or checkpointer packages.

- [ ] **Step 2: Inspect the resolved peer dependency tree**

Run:

```bash
bun pm ls @langchain/langgraph @langchain/core zod
```

Expected: one compatible Zod 4 resolution and no unmet peer dependency warning for LangGraph/core.

- [ ] **Step 3: Verify the existing application after the Zod upgrade**

Run: `bun run test:run`

Expected: PASS before graph code is introduced. Any Zod behavior regression is fixed in this task rather than hidden in later graph work.

- [ ] **Step 4: Commit dependency compatibility**

```bash
git add package.json bun.lock
git commit -m "📦 build(rag/langgraph): add orchestration dependencies"
```

### Task 3: Define graph state and pure routes

**Files:**
- Create: `lib/agent/langgraph/state.ts`
- Create: `lib/agent/langgraph/nodes.ts`
- Create: `tests/langgraph-nodes.test.ts`

**Interfaces:**
- Consumes: `AgentTurnInput`, `GroundingBundle`, `AnswerDraft`, `AgentModelStages`, and `Retriever`.
- Produces: `AgentGraphState`, graph node factory, and pure route functions.

- [ ] **Step 1: Write route tests for every branch and cycle bound**

Test these state-to-route decisions:

| State | Route |
|---|---|
| decision says no retrieval | `direct` |
| decision says retrieval | `retrieve` |
| grounded bundle | `generate` |
| unavailable bundle | `retrievalUnavailable` |
| insufficient bundle and attempt `< 2` | `rewrite` |
| insufficient bundle and attempt `=== 2` | `insufficientEvidence` |
| valid citation IDs | `suggestions` |
| invalid IDs and repair count `0` | `repair` |
| invalid IDs and repair count `1` | `citationFailure` |

```ts
expect(routeAfterRetrieval({
  retrievalAttempt: 2,
  grounding: { status: "insufficient-evidence", query: "q", corpusRevision: "r", passages: [], citations: [] },
} as AgentGraphState)).toBe("insufficientEvidence");
```

- [ ] **Step 2: Run node tests and verify failure**

Run: `bunx vitest run tests/langgraph-nodes.test.ts`

Expected: FAIL because graph state and route functions do not exist.

- [ ] **Step 3: Define internal state**

Use `StateSchema` with explicit fields for input, decision, query, retrieval attempt, grounding bundle, answer draft, repair count, final result, and terminal flag. Do not place `AgentEventSink`, provider credentials, or raw errors in state. Do not include a checkpointer.

```ts
export const AgentGraphSchema = new StateSchema({
  input: z.custom<AgentTurnInput>(),
  decision: z.custom<RetrievalDecision>().optional(),
  query: z.string().default(""),
  retrievalAttempt: z.number().int().min(0).max(2).default(0),
  grounding: z.custom<GroundingBundle>().optional(),
  draft: z.custom<AnswerDraft>().optional(),
  citationRepairCount: z.number().int().min(0).max(1).default(0),
  result: z.custom<AgentTurnResult>().optional(),
  terminal: z.boolean().default(false),
});

export type AgentGraphState = typeof AgentGraphSchema.State;
```

- [ ] **Step 4: Implement nodes with injected dependencies**

`createAgentGraphNodes({ retriever, stages })` returns ordinary async nodes. Each node receives LangGraph config and sends domain `AgentEvent` values through `config.writer(event)`. Nodes return partial state only; pure route functions choose edges.

The retrieve node increments `retrievalAttempt` before calling `retriever.retrieve`. It does not throw for `insufficient-evidence` or `unavailable`; both are ordinary state.

- [ ] **Step 5: Verify pure routes and node effects**

Run: `bunx vitest run tests/langgraph-nodes.test.ts`

Expected: PASS for every branch, bound, and emitted event.

- [ ] **Step 6: Commit graph state and nodes**

```bash
git add lib/agent/langgraph/state.ts lib/agent/langgraph/nodes.ts tests/langgraph-nodes.test.ts
git commit -m "✨ feat(rag/langgraph): define bounded graph nodes"
```

### Task 4: Compile the graph and implement the runner adapter

**Files:**
- Create: `lib/agent/langgraph/runner.ts`
- Create: `tests/langgraph-runner.test.ts`
- Create: `tests/agent-runner-conformance.ts`
- Modify: `tests/ai-sdk-runner.test.ts`

**Interfaces:**
- Produces: `createLangGraphAgentTurnRunner(dependencies): AgentTurnRunner`.
- Produces: `runAgentRunnerConformance(name, createRunner)` shared by both implementations.

- [ ] **Step 1: Extract a shared runner conformance suite**

The conformance suite supplies deterministic fake stages and a fake retriever, then asserts for both implementations:

- direct answer skips retrieval;
- grounded answer includes only accepted citations;
- one rewrite yields no more than two retrieval calls;
- unavailable and insufficient outcomes differ;
- one citation repair is allowed;
- abort prevents the next stage;
- event sequence is ordered and has one terminal event;
- suggestion failure preserves a valid answer.

- [ ] **Step 2: Run the LangGraph conformance target and verify failure**

Run: `bunx vitest run tests/langgraph-runner.test.ts`

Expected: FAIL because the LangGraph runner does not exist.

- [ ] **Step 3: Assemble the graph**

Use one routing mechanism per node. Do not mix static outgoing edges and `Command` routing from the same node.

```ts
const graph = new StateGraph(AgentGraphSchema)
  .addNode("decide", nodes.decide)
  .addNode("retrieve", nodes.retrieve)
  .addNode("rewrite", nodes.rewrite)
  .addNode("generate", nodes.generate)
  .addNode("repair", nodes.repair)
  .addNode("direct", nodes.direct)
  .addNode("suggestions", nodes.suggestions)
  .addNode("retrievalUnavailable", nodes.retrievalUnavailable)
  .addNode("insufficientEvidence", nodes.insufficientEvidence)
  .addNode("citationFailure", nodes.citationFailure)
  .addNode("complete", nodes.complete)
  .addEdge(START, "decide")
  .addConditionalEdges("decide", routeAfterDecision)
  .addConditionalEdges("retrieve", routeAfterRetrieval)
  .addEdge("rewrite", "retrieve")
  .addConditionalEdges("generate", routeAfterCitationValidation)
  .addConditionalEdges("repair", routeAfterCitationValidation)
  .addEdge("direct", "suggestions")
  .addEdge("suggestions", "complete")
  .addEdge("retrievalUnavailable", "complete")
  .addEdge("insufficientEvidence", "complete")
  .addEdge("citationFailure", "complete")
  .addEdge("complete", END)
  .compile();
```

- [ ] **Step 4: Adapt graph custom events to the sink**

Run the graph with `streamMode: ["custom", "values"]`. Forward only custom chunks that pass the `AgentEvent` runtime schema to `sink.emit`. Keep value chunks inside the runner and use the final `result` field as the return value. Never forward state values to the route or client.

Pass `AbortSignal` through the graph invocation and every dependency. Do not invoke the graph a second time to obtain the final state.

- [ ] **Step 5: Run both conformance suites**

Run: `bunx vitest run tests/ai-sdk-runner.test.ts tests/langgraph-runner.test.ts`

Expected: PASS with the same observable contract for both runners.

- [ ] **Step 6: Commit the LangGraph runner**

```bash
git add lib/agent/langgraph/runner.ts tests/langgraph-runner.test.ts tests/agent-runner-conformance.ts tests/ai-sdk-runner.test.ts
git commit -m "✨ feat(rag/langgraph): add runner adapter"
```

### Task 5: Add safe runner selection

**Files:**
- Create: `lib/agent/runner-factory.ts`
- Create: `tests/runner-factory.test.ts`
- Modify: `app/api/question/route.ts`
- Modify: `tests/route.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `createConfiguredAgentTurnRunner(): AgentTurnRunner`.
- Configuration: `RAG_RUNNER=ai-sdk|langgraph`, default `ai-sdk`.

- [ ] **Step 1: Write factory and route selection tests**

Verify:

- missing `RAG_RUNNER` selects AI SDK;
- `ai-sdk` selects AI SDK;
- `langgraph` selects LangGraph;
- unknown value fails configuration before a model or retrieval call;
- each request calls exactly one runner;
- runner name is attached to server-side run metadata.

- [ ] **Step 2: Run selection tests and verify failure**

Run: `bunx vitest run tests/runner-factory.test.ts tests/route.test.ts`

Expected: FAIL because no runner factory exists.

- [ ] **Step 3: Implement strict server-side selection**

```ts
const runnerNameSchema = z.enum(["ai-sdk", "langgraph"]);

export function getRunnerName(): "ai-sdk" | "langgraph" {
  return runnerNameSchema.parse(process.env.RAG_RUNNER ?? "ai-sdk");
}
```

Construct only the selected runner. Do not run both and discard one. Keep imports server-only.

- [ ] **Step 4: Document the rollback switch**

Add `RAG_RUNNER=ai-sdk` to `.env.example` and state that changing back to `ai-sdk` is the immediate rollback. Do not expose runner selection to the browser.

- [ ] **Step 5: Run selection and route tests**

Run: `bunx vitest run tests/runner-factory.test.ts tests/route.test.ts`

Expected: PASS; one runner per request and AI SDK remains the default.

- [ ] **Step 6: Commit runner selection**

```bash
git add lib/agent/runner-factory.ts tests/runner-factory.test.ts app/api/question/route.ts tests/route.test.ts .env.example
git commit -m "🚩 feat(rag/runner): add server-side graph flag"
```

### Task 6: Compare runners with the same evaluation gate

**Files:**
- Modify: `scripts/evaluate-rag.ts`
- Modify: `lib/rag/evaluation.ts`
- Modify: `tests/rag-evaluation.test.ts`
- Create: `docs/research/langgraph-runner-comparison.md`

**Interfaces:**
- Produces: `bun run eval:rag -- --runner ai-sdk` and `bun run eval:rag -- --runner langgraph`.
- Report keys include runner, corpus revision, model ID, prompt revision, per-case outcome, citations, retrieval attempts, tokens, cost when available, and stage latency.

- [ ] **Step 1: Add comparison metric tests**

Given two fixed reports, test calculation of quality deltas, p95 latency delta, mean token/cost delta, retrieval-attempt delta, and contract violations.

Promotion gates are explicit:

- no decrease in outcome accuracy;
- no decrease in citation precision or completeness;
- no new prompt-injection success;
- no case exceeds two retrieval attempts or one repair;
- p95 latency increase is at most 20%;
- mean provider cost increase is at most 15%;
- UI/event conformance suite remains identical.

- [ ] **Step 2: Run evaluation tests and verify failure**

Run: `bunx vitest run tests/rag-evaluation.test.ts`

Expected: FAIL until comparison metrics are implemented.

- [ ] **Step 3: Extend the CLI without changing cases or policy**

The CLI selects one runner by argument, not by production environment mutation. Use temperature zero and the same configured model. Store separate JSON result files. Do not run both runners concurrently; avoid rate-limit and shared-cache bias.

- [ ] **Step 4: Capture repeated offline samples**

Run each command at least three times against the same corpus revision:

```bash
bun run eval:rag -- --runner ai-sdk
bun run eval:rag -- --runner langgraph
```

Aggregate medians for quality-neutral metrics and p95 for latency. Record model/provider errors separately; do not score provider outages as retrieval relevance failures.

- [ ] **Step 5: Write the evidence-backed comparison note**

`docs/research/langgraph-runner-comparison.md` must include exact dependency versions, corpus/model/prompt revisions, dataset size, metric table, contract failures, operational differences, and a conclusion of `promote`, `continue experiment`, or `remove`. Link raw result artifacts without committing prompts or passage bodies.

- [ ] **Step 6: Commit the comparison harness and findings**

```bash
git add scripts/evaluate-rag.ts lib/rag/evaluation.ts tests/rag-evaluation.test.ts docs/research/langgraph-runner-comparison.md
git commit -m "📊 test(rag/langgraph): compare runner behavior"
```

### Task 7: Apply the adoption decision cleanly

**Files:**
- Conditional modifications based on the recorded evidence.

**Interfaces:**
- Consumes: the recorded comparison report and promotion gates.
- Produces: exactly one supported production runner path, with LangGraph either promoted behind controlled rollout or removed cleanly.

- [ ] **Step 1: If every promotion gate passes, canary LangGraph by request cohort**

Use a stable server-side percentage assignment keyed by authenticated user ID or a server-issued anonymous cohort cookie. Start at 5%, then 25%, then 100%. Each request still executes one runner. Record runner, terminal outcome, latency, and error rate; never record raw passages by default.

- [ ] **Step 2: If any promotion gate fails, remove the experiment**

Delete `lib/agent/langgraph/`, its tests, runner-factory LangGraph branch, and LangGraph/core dependencies. Keep `docs/research/langgraph-runner-comparison.md` as the evidence for the decision. Restore `RAG_RUNNER` to an AI SDK-only configuration or remove the flag if no second runner remains.

- [ ] **Step 3: Do not add persistence as part of promotion**

Checkpointing is a separate product decision. Promotion of in-process orchestration does not authorize conversation storage, thread IDs, interrupts, or external databases.

- [ ] **Step 4: Run final verification**

Run:

```bash
bunx vitest run tests/ai-sdk-runner.test.ts tests/langgraph-runner.test.ts tests/runner-factory.test.ts tests/route.test.ts tests/rag-evaluation.test.ts
bun run test:run
bun run build
```

When the experiment is removed, omit deleted LangGraph test paths and verify the remaining AI SDK path.

- [ ] **Step 5: Commit the evidence-driven decision**

Promotion:

```bash
git add lib/agent app/api/question/route.ts tests .env.example docs/research/langgraph-runner-comparison.md
git commit -m "🚀 feat(rag/langgraph): promote evaluated runner"
```

Removal:

```bash
git add -A lib/agent tests package.json bun.lock .env.example docs/research/langgraph-runner-comparison.md
git commit -m "🧹 chore(rag/langgraph): remove unsuccessful experiment"
```
