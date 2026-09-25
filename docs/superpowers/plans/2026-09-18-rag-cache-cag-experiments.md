# RAG Cache and CAG Experiments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure and selectively adopt safe caching for Pali Docs, then benchmark a static-core CAG path without weakening corpus freshness, access scope, grounding, or citations.

**Architecture:** Caching is layered: provider prefix caching reduces repeated model prefill, exact retrieval caching reuses versioned evidence, Redis LangCache may reuse a fully validated public FAQ response, and CAG may preload a small immutable corpus core. Pinecone remains the authoritative freshness and long-tail path; every layer uses corpus/model/prompt/retrieval revisions and can be disabled independently.

**Tech Stack:** Next.js Node runtime, Vercel AI SDK/OpenAI-compatible provider, OpenRouter, Pinecone, optional Redis 5 client, optional Redis LangCache REST API, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-agentic-rag-design.md`

**Prerequisite:** Complete `docs/superpowers/plans/2026-09-18-agentic-rag-foundation.md` and capture the uncached evaluation baseline. LangGraph adoption is not required.

## Global Constraints

- Do not add a cache before measuring duplicate traffic, stage latency, token usage, and corpus size.
- `corpusRevision`, `promptRevision`, `modelId`, locale, and access scope are hard equality boundaries before any semantic comparison.
- Never cache retrieval/provider failures.
- Never populate a response cache until the answer and citation IDs validate.
- Never serve a cached citation whose corpus revision or source ID is no longer current.
- Semantic response caching is limited to public, standalone, stable FAQ traffic.
- Redis LangCache is a preview product; a kill switch and uncached fallback are mandatory.
- CAG is a static-core experiment; Pinecone remains available for fresh, restricted, or long-tail content.
- Every experiment records hit/miss/bypass/error and can be removed without changing `AgentTurnRunner` or the UI protocol.
- Commit messages use `<emoji> <type>(<task>/<domain>): <message>`.

## File map

| Path | Responsibility |
|---|---|
| `lib/services/llm-provider.ts` | Includes usage and extracts OpenRouter cache metadata. |
| `lib/observability/model-usage.ts` | Normalizes provider token/cache usage without leaking raw responses. |
| `lib/rag/cache-keys.ts` | Versioned, scope-safe retrieval and response cache keys. |
| `lib/rag/retrieval-cache.ts` | Exact retrieval-cache interface and Redis adapter. |
| `lib/rag/semantic-cache.ts` | Strict LangCache eligibility, lookup, validation, and storage. |
| `lib/rag/cag-context.ts` | Builds a versioned static-core context bundle from an explicit manifest. |
| `data/cag-core-manifest.json` | Exact ordered list of public source documents in the CAG prefix. |
| `scripts/measure-rag-traffic.ts` | Aggregates anonymized run metrics and estimates cache opportunity. |
| `scripts/benchmark-cag.ts` | Compares cold/warm CAG with authoritative RAG. |
| `tests/model-usage.test.ts` | Provider metadata parsing. |
| `tests/cache-keys.test.ts` | Revision, policy, and scope key invariants. |
| `tests/retrieval-cache.test.ts` | Exact-cache behavior and fail-open policy. |
| `tests/semantic-cache.test.ts` | Eligibility, attribute boundaries, false-hit rejection, and invalidation. |
| `tests/cag-context.test.ts` | Deterministic corpus prefix and provenance mapping. |

### Task 1: Instrument cache opportunity before adding a cache

**Files:**
- Create: `lib/observability/model-usage.ts`
- Create: `tests/model-usage.test.ts`
- Create: `scripts/measure-rag-traffic.ts`
- Modify: `lib/services/llm-provider.ts`
- Modify: `lib/agent/model-stages.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `ModelUsage` with input/output tokens, cached-read tokens, cache-write tokens, provider, and model.
- Produces: `bun run measure:rag-cache` over redacted run records.

- [ ] **Step 1: Write provider metadata parser tests**

Use fixed OpenRouter-compatible responses for non-streaming and streaming final chunks. Cover absent usage, standard token counts, `prompt_tokens_details.cached_tokens`, and provider-specific `cache_write_tokens`. Unknown shapes return `undefined` fields rather than throwing.

```ts
expect(parseOpenRouterUsage({
  prompt_tokens: 1000,
  completion_tokens: 80,
  prompt_tokens_details: { cached_tokens: 700 },
  cache_write_tokens: 300,
})).toEqual({
  inputTokens: 1000,
  outputTokens: 80,
  cachedReadTokens: 700,
  cacheWriteTokens: 300,
});
```

- [ ] **Step 2: Run usage tests and verify failure**

Run: `bunx vitest run tests/model-usage.test.ts`

Expected: FAIL because usage normalization does not exist.

- [ ] **Step 3: Configure the compatible provider to expose usage**

Set `includeUsage: true` and add a `MetadataExtractor` for OpenRouter. The extractor stores only the `usage` object under `providerMetadata.openrouter`; it must not retain prompts, messages, response bodies, headers, or credentials.

Use both `extractMetadata` and `createStreamExtractor`, because the production route and evaluation scripts may use different generation modes.

- [ ] **Step 4: Normalize and emit model-usage metrics**

`model-usage.ts` accepts unknown provider metadata and returns a stable internal shape. Attach normalized usage to run traces after each model stage. Never expose token/cost metadata in user-visible message parts.

- [ ] **Step 5: Implement the measurement CLI**

The CLI reads redacted JSON Lines run metrics and reports:

- exact normalized-query repetition rate;
- repeated-query rate within one corpus revision;
- retrieval p50/p95 latency and share of total latency;
- generation p50/p95 latency;
- input/output/cached-read/cache-write tokens;
- provider prefix-cache read ratio;
- public FAQ eligibility rate;
- model/provider error rate.

Hash normalized queries with HMAC-SHA-256 using `RAG_METRICS_HASH_KEY`; do not persist raw questions.

Add:

```json
"measure:rag-cache": "node --import tsx scripts/measure-rag-traffic.ts"
```

- [ ] **Step 6: Verify instrumentation**

Run: `bunx vitest run tests/model-usage.test.ts`

Then run the evaluation dataset once and confirm its result includes provider/model/token/cache fields without raw prompts.

- [ ] **Step 7: Commit measurement support**

```bash
git add lib/observability/model-usage.ts tests/model-usage.test.ts scripts/measure-rag-traffic.ts lib/services/llm-provider.ts lib/agent/model-stages.ts package.json bun.lock
git commit -m "📊 feat(rag/cache): measure cache opportunity"
```

### Task 2: Verify provider prefix caching

**Files:**
- Modify: `lib/agent/model-stages.ts`
- Modify: `scripts/evaluate-rag.ts`
- Create: `docs/research/openrouter-prefix-cache-experiment.md`

**Interfaces:**
- Consumes: normalized `ModelUsage`.
- Produces: a repeatable cold/warm prefix-cache report for the configured production model.

- [ ] **Step 1: Stabilize prompt prefixes without changing policy**

Place invariant content first and in stable order:

1. system safety/grounding instructions;
2. structured-output schema or tool definitions;
3. stable bounded conversation prefix when present;
4. question-specific retrieved evidence and current question last.

Do not insert timestamps, run IDs, random values, or corpus passages before the reusable system/tool prefix. Keep query-specific context out of the common prefix.

- [ ] **Step 2: Add a prefix-cache experiment mode**

`bun run eval:rag -- --cache-experiment prefix` executes the same fixed case at least five times sequentially on the same explicit OpenRouter model/route, records cached-read/write tokens and first-token/total latency, and labels the first call cold. It must fail clearly when the provider returns no cache metadata rather than treating missing data as zero benefit.

- [ ] **Step 3: Run cold/warm measurements**

Use a production-supported, non-free model with documented prompt caching. Do not infer support from OpenAI API compatibility. Record the exact OpenRouter model ID, provider route, prompt revision, prefix token count, cache TTL observation window, cached-token ratio, cold/warm latency, and cost.

- [ ] **Step 4: Apply the adoption gate**

Keep the stable-prefix layout regardless, but claim a provider-cache benefit only when all are true:

- cache metadata is present;
- median warm cached-read ratio is at least 50% of eligible prefix tokens;
- warm p50 total latency or input-token cost improves by at least 10%;
- answer/citation evaluation is unchanged.

- [ ] **Step 5: Record findings**

Write `docs/research/openrouter-prefix-cache-experiment.md` with exact commands, revisions, measurements, limitations, and a `use`, `model-specific only`, or `no measurable benefit` conclusion.

- [ ] **Step 6: Commit prompt-layout and evidence changes**

```bash
git add lib/agent/model-stages.ts scripts/evaluate-rag.ts docs/research/openrouter-prefix-cache-experiment.md
git commit -m "⚡ perf(rag/cache): verify provider prefix reuse"
```

### Task 3: Add versioned exact retrieval caching when justified

**Execution gate:** Start this task only if exact repeated queries within one corpus revision are at least 5% of eligible traffic **or** Pinecone plus embedding accounts for at least 15% of p95 turn latency.

**Files:**
- Create: `lib/rag/cache-keys.ts`
- Create: `lib/rag/retrieval-cache.ts`
- Create: `tests/cache-keys.test.ts`
- Create: `tests/retrieval-cache.test.ts`
- Modify: `lib/rag/retriever.ts`
- Modify: `lib/config/rag.ts`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `bun.lock`

**Interfaces:**
- Produces: `RetrievalCache.get(key): Promise<GroundedBundle | null>` and `set(key, value, ttlSeconds): Promise<void>`.
- Production adapter: Redis through `REDIS_URL`; default remains disabled.

- [ ] **Step 1: Write cache-key invariant tests**

The key changes when any of these change: normalized query, corpus revision, namespace, embedding model/input mode, candidate count, accepted count, minimum score, context budget, retrieval-policy revision, or access scope. The key must not contain the raw question.

```ts
expect(createRetrievalCacheKey(base)).not.toBe(
  createRetrievalCacheKey({ ...base, corpusRevision: "next" }),
);
expect(createRetrievalCacheKey(base)).not.toContain(base.query);
```

- [ ] **Step 2: Write cache behavior tests**

Cover miss, grounded hit, TTL write, disabled cache bypass, Redis timeout fail-open, corrupted value deletion, revision mismatch rejection, public-scope isolation, and no storage for `insufficient-evidence` or `unavailable`.

- [ ] **Step 3: Run cache tests and verify failure**

Run: `bunx vitest run tests/cache-keys.test.ts tests/retrieval-cache.test.ts`

Expected: FAIL because key and cache modules do not exist.

- [ ] **Step 4: Add the Redis dependency and configuration**

Run: `bun add redis@^5`

Add lazy configuration:

- `RAG_RETRIEVAL_CACHE_ENABLED=false` by default;
- `REDIS_URL` required only when enabled;
- `RAG_RETRIEVAL_CACHE_TTL_SECONDS=300` default, bounded to 30–3600;
- `RAG_RETRIEVAL_POLICY_REVISION` required when enabled.

Use one lazily connected client per Node process with bounded connect/command timeouts. Cache errors are metrics plus misses; they never fail the user request.

- [ ] **Step 5: Integrate exact lookup inside `Retriever`**

Lookup occurs after request/policy validation and before embedding. On a hit, validate the Zod payload, corpus revision, access scope, and citation/source fields, then return it. On a miss, execute normal retrieval and cache only a validated `grounded` result.

Do not semantically normalize beyond Unicode normalization, trimming, and internal whitespace collapse. Exact retrieval caching must not reuse evidence for a merely similar question.

- [ ] **Step 6: Run focused retrieval/cache tests**

Run: `bunx vitest run tests/cache-keys.test.ts tests/retrieval-cache.test.ts tests/retriever.test.ts`

Expected: PASS; disabled/error paths behave exactly like uncached retrieval.

- [ ] **Step 7: Canary and verify the gate**

Enable for a small server-side cohort. Require zero revision/scope violations, zero invalid citation payloads, and a measured p95 or provider-call reduction. If the eligible hit rate stays below 5%, disable and remove the production adapter; retain the measurement note.

- [ ] **Step 8: Commit the exact cache**

```bash
git add lib/rag/cache-keys.ts lib/rag/retrieval-cache.ts lib/rag/retriever.ts lib/config/rag.ts tests/cache-keys.test.ts tests/retrieval-cache.test.ts .env.example package.json bun.lock
git commit -m "⚡ feat(rag/cache): add versioned exact retrieval cache"
```

### Task 4: Pilot Redis LangCache on a strict FAQ lane

**Execution gate:** Start only if at least 10% of traffic is public, standalone, stable FAQ traffic and offline threshold sweeps can achieve zero known false hits on the reviewed evaluation set.

**Files:**
- Create: `lib/rag/semantic-cache.ts`
- Create: `tests/semantic-cache.test.ts`
- Modify: `lib/agent/runner-factory.ts`
- Modify: `lib/agent/types.ts`
- Modify: `lib/agent/ai-sdk-event-sink.ts`
- Modify: `lib/config/rag.ts`
- Modify: `.env.example`
- Create: `docs/research/langcache-pilot-results.md`

**Interfaces:**
- Produces: `SemanticResponseCache.lookup(request): Promise<CacheLookupResult>` and `store(entry): Promise<void>`.
- Uses Redis LangCache REST with `fetch`; no LangChain dependency.

- [ ] **Step 1: Write eligibility and boundary tests**

A request is eligible only when all are true:

- public access scope;
- one current user question with no user-specific facts;
- no durable memory/thread-dependent state;
- configured stable FAQ intent;
- explicit locale;
- supported corpus, prompt, and model revisions.

Test bypass for conversation-dependent questions, private/tenant scope, missing revisions, retrieval-unavailable history, and opt-out.

- [ ] **Step 2: Write lookup/store tests with a fake LangCache API**

Cover exact hit, semantic hit above configured threshold, below-threshold miss, hard attribute mismatch, timeout fail-open, malformed response, stale citation ID, no storage before citation validation, and delete-by-corpus-revision invalidation.

The structured cached value contains:

```ts
interface CachedAgentAnswer {
  answer: string;
  citations: Citation[];
  suggestions: string[];
  outcome: "answered";
  corpusRevision: string;
  promptRevision: string;
  modelId: string;
  locale: "th" | "en";
  accessScope: "public";
}
```

```ts
interface SemanticCacheLookupRequest {
  prompt: string;
  corpusRevision: string;
  promptRevision: string;
  modelId: string;
  locale: "th" | "en";
  accessScope: "public";
}

type CacheLookupResult =
  | {
      status: "hit";
      strategy: "exact" | "semantic";
      similarity: number;
      entryId: string;
      value: CachedAgentAnswer;
    }
  | { status: "miss" | "bypass" | "error" };
```

- [ ] **Step 3: Run semantic-cache tests and verify failure**

Run: `bunx vitest run tests/semantic-cache.test.ts`

Expected: FAIL because the semantic cache does not exist.

- [ ] **Step 4: Implement preview-safe LangCache access**

Use the documented REST endpoints. Configure:

- `LANGCACHE_ENABLED=false` by default;
- base URL, cache ID, and API key;
- request timeout no greater than 300 ms;
- exact-first strategy;
- semantic threshold set from the offline sweep, never from a guessed default;
- short TTL no greater than one hour;
- kill switch read on each request or deployment config refresh.

Use five hard attributes: `corpusRevision`, `promptRevision`, `modelId`, `locale`, and `accessScope`.

- [ ] **Step 5: Integrate before runner execution**

On a validated hit, emit a cache-hit status, answer, citations, suggestions, and one normal terminal event through `AgentEventSink`. Revalidate every citation and revision before emission. On miss/bypass/error, execute the selected runner unchanged. Store only after the runner returns `answered` with validated citations.

- [ ] **Step 6: Sweep the semantic threshold offline**

Generate paraphrase and near-miss pairs including negation, tense, case, quoted Pali form, and requested-source changes. Select the lowest threshold with zero false hits in the reviewed set. If no threshold yields both zero false hits and at least 5% projected semantic hit rate, keep semantic matching disabled and use exact matches only.

- [ ] **Step 7: Canary with correctness metrics**

Record hit strategy, similarity, matched entry ID, age, hard attributes, latency, and sampled evaluation verdict. Do not optimize for hit ratio alone. Disable immediately on any scope/revision violation or confirmed false hit.

- [ ] **Step 8: Record and commit the pilot**

`docs/research/langcache-pilot-results.md` records preview version, threshold sweep, traffic eligibility, hit rate, false-hit rate, latency, savings, invalidation test, and `adopt`, `exact-only`, or `remove` decision.

```bash
git add lib/rag/semantic-cache.ts tests/semantic-cache.test.ts lib/agent/runner-factory.ts lib/agent/types.ts lib/agent/ai-sdk-event-sink.ts lib/config/rag.ts .env.example docs/research/langcache-pilot-results.md
git commit -m "🧪 feat(rag/langcache): pilot scoped semantic answers"
```

### Task 5: Benchmark a static-core CAG path

**Execution gate:** Run as an offline benchmark only. Do not route production traffic before the final gate.

**Files:**
- Create: `data/cag-core-manifest.json`
- Create: `lib/rag/cag-context.ts`
- Create: `tests/cag-context.test.ts`
- Create: `scripts/benchmark-cag.ts`
- Create: `docs/research/cag-static-core-benchmark.md`
- Modify: `package.json`

**Interfaces:**
- Produces: deterministic `StaticCoreContext` with revision, ordered source map, rendered prefix, and content hash.
- Produces: `bun run benchmark:cag`.

```ts
interface StaticCoreSource {
  id: string;
  path: string;
  title: string;
}

interface StaticCoreContext {
  revision: string;
  contentHash: string;
  sources: StaticCoreSource[];
  renderedPrefix: string;
}
```

- [ ] **Step 1: Define an explicit, reviewable static core**

Start with public, stable introductory grammar material only:

```json
{
  "revision": "pali-core-2026-09-18",
  "sources": [
    "content/docs/part-1/index.mdx",
    "content/docs/part-1/vol-1.1/chapter-1.mdx"
  ]
}
```

Do not glob the entire corpus. Order is part of the cache key and prompt prefix.

- [ ] **Step 2: Write deterministic context tests**

Verify frontmatter removal, stable source delimiters, stable ordering, SHA-256 content hash, source-to-citation mapping, rejection of paths outside `content/docs`, missing-file failure, and revision change when content/order changes.

- [ ] **Step 3: Run CAG context tests and verify failure**

Run: `bunx vitest run tests/cag-context.test.ts`

Expected: FAIL because the static-core builder does not exist.

- [ ] **Step 4: Implement the context builder**

Render every source as untrusted evidence with stable IDs and titles from frontmatter. The static prefix contains grounding instructions, source map, and corpus text before the changing question. Do not claim a local persisted KV cache; through OpenRouter this is a provider-prefix-cache approximation to CAG.

- [ ] **Step 5: Implement the benchmark**

For evaluation cases whose expected sources are entirely inside the manifest, compare:

- authoritative Pinecone RAG;
- cold static-core prompt;
- repeated warm static-core prompt;
- hybrid static core plus Pinecone fallback for non-core cases.

Record answer/citation quality, prefix/input/output/cached tokens, first-token and total latency, cold/warm cost, context share, and cache metadata. The same model, prompt policy, and answer schema are used across paths.

Add:

```json
"benchmark:cag": "node --import tsx scripts/benchmark-cag.ts"
```

- [ ] **Step 6: Apply the CAG gate**

A production static-core path is eligible only when all are true:

- rendered core uses at most 60% of the model's documented effective context;
- all eligible answers retain valid source citations;
- grounded-answer and citation metrics meet or exceed RAG on core cases;
- median warm cached-read ratio is at least 80% of the static prefix;
- warm latency/cost improves materially and cold behavior stays within the product budget;
- corpus update frequency permits explicit rebuild and warm-up;
- Pinecone fallback remains for non-core, changed, or restricted material.

- [ ] **Step 7: Record findings and keep the experiment isolated**

Write `docs/research/cag-static-core-benchmark.md` with manifest revision/hash, provider/model route, effective context limit source, cold/warm results, quality table, and `hybrid canary` or `do not adopt` conclusion. If the gate fails, delete runtime integration code and keep the benchmark and report only.

- [ ] **Step 8: Commit the benchmark**

```bash
git add data/cag-core-manifest.json lib/rag/cag-context.ts tests/cag-context.test.ts scripts/benchmark-cag.ts docs/research/cag-static-core-benchmark.md package.json bun.lock
git commit -m "🧪 perf(rag/cag): benchmark static core context"
```

### Task 6: Verify independent rollback and document the final cache stack

**Files:**
- Modify: `docs/RAG-WORKFLOW.md`
- Modify: `README.md`
- Modify: `.env.example`
- Create: `docs/research/rag-cache-decision.md`

**Interfaces:**
- Consumes: measured results and kill switches from every executed experiment.
- Produces: one documented cache/CAG stack in which each adopted layer has a revision key, invalidation path, owner, metric, and independent rollback.

- [ ] **Step 1: Exercise each kill switch**

Verify these configurations independently restore the uncached authoritative path:

- provider cache unavailable or unsupported;
- `RAG_RETRIEVAL_CACHE_ENABLED=false`;
- `LANGCACHE_ENABLED=false`;
- CAG routing disabled.

For each, grounded answers and citations must remain correct; only latency/cost metrics may change.

- [ ] **Step 2: Test revision invalidation**

Advance `PINECONE_CORPUS_REVISION` in a controlled environment. Confirm old exact retrieval and LangCache entries are unreachable, CAG manifest hash changes when core content changes, and no cached answer from the old revision is served.

- [ ] **Step 3: Run final verification**

Run:

```bash
bunx vitest run tests/model-usage.test.ts tests/cache-keys.test.ts tests/retrieval-cache.test.ts tests/semantic-cache.test.ts tests/cag-context.test.ts tests/retriever.test.ts tests/ai-sdk-runner.test.ts tests/route.test.ts tests/rag-evaluation.test.ts
bun run test:run
bun run build
```

Then run only the experiments whose execution gates passed. Do not manufacture a cache/CAG result when credentials, traffic metrics, or provider support are absent.

- [ ] **Step 4: Write the final decision record**

`docs/research/rag-cache-decision.md` lists every layer as `adopted`, `model-specific`, `exact-only`, `experimental`, or `rejected`, with measured reason, revision/invalidation mechanism, owner, kill switch, and ongoing metric.

- [ ] **Step 5: Update operational documentation**

Document only adopted layers in `docs/RAG-WORKFLOW.md` and `README.md`. Keep rejected/experimental details in research documents. Add environment variables only for enabled integrations.

- [ ] **Step 6: Commit the final cache decision**

```bash
git add docs/RAG-WORKFLOW.md README.md .env.example docs/research/rag-cache-decision.md
git commit -m "📝 docs(rag/cache): record measured cache strategy"
```
