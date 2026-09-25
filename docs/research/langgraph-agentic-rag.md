# LangGraph JavaScript/TypeScript for agentic RAG

## Executive summary

LangGraph is a low-level TypeScript orchestration runtime, not a replacement for the model, embedding, or vector-store layers. Its main value for Pali Docs is explicit, inspectable control flow: a graph can decide whether retrieval is needed, grade Pinecone results, rewrite a weak query, retry retrieval under a hard loop bound, generate an answer, and route failures without hiding those decisions inside one model/tool loop. LangGraph's own JavaScript agentic-RAG tutorial demonstrates this retrieve-or-answer → retrieve → grade → rewrite-or-generate pattern with `StateGraph` and conditional edges ([official tutorial](https://docs.langchain.com/oss/javascript/langgraph/agentic-rag)).

The fit is technically good but should be incremental. LangGraph nodes are ordinary JavaScript functions, and the project can keep its existing Vercel AI SDK model calls and Pinecone functions; LangGraph explicitly does not require LangChain ([overview](https://docs.langchain.com/oss/javascript/langgraph/overview)). The trade-off is integration work: AI SDK token/data-part streams must be bridged through LangGraph's custom streaming channel, while adopting LangChain `createAgent` would instead replace the current model/tool abstraction and add LangChain packages.

Recommendation: use raw `StateGraph` first as an in-process orchestration layer inside the existing Node.js Next.js route. Do not adopt LangChain agents, subgraphs, human approval, persistent checkpoints, or LangSmith Agent Server until a measured requirement justifies each one. If multi-request resume, durable conversation state, or human-in-the-loop is added, use an external checkpointer from the start; `MemorySaver` is explicitly not durable across serverless cold starts or replicas ([Next.js deployment guide](https://docs.langchain.com/langsmith/deploy-nextjs)).

## Capabilities

### Graph and state model

`StateGraph` models a workflow with shared typed state, nodes that read state and return partial updates, and edges that choose the next nodes. `StateSchema` accepts Standard Schema fields such as Zod plus specialized values: `ReducedValue` for concurrent updates, `MessagesValue` for message history, and `UntrackedValue` for transient data that should not enter checkpoints. Separate input, internal, private, and output schemas can constrain node inputs and final output ([Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)).

For agentic RAG, state can hold the original question, current search query, raw `DocumentMatch[]`, relevance decision, rewrite count, answer, and terminal error. That makes the retrieval loop and its stopping conditions explicit. A security caveat is that “private” state channels are still included by default in `values` streams; callers must choose `updates` or set `outputKeys` when state includes internal prompts, retrieved text, or operational metadata ([Graph API warning](https://docs.langchain.com/oss/javascript/langgraph/graph-api#multiple-schemas)).

LangGraph also supports input-based node caching with a compile-time cache and per-node `cachePolicy` (`keyFunc` and optional TTL) ([node caching](https://docs.langchain.com/oss/javascript/langgraph/graph-api#node-caching)). This is execution memoization, not context-aware generation or a complete CAG strategy: cache keys, tenant isolation, invalidation on corpus/index/model changes, and a production cache backend remain application responsibilities.

### Conditional routing and agentic-RAG loops

`addConditionalEdges` runs a routing function over current state and can select one or several next nodes; `Command` combines a state update with dynamic routing, while `Send` supports dynamic fan-out/map-reduce ([edges and `Command`](https://docs.langchain.com/oss/javascript/langgraph/graph-api#edges)). Mixing a static outgoing edge with `Command`/conditional routing from the same node can execute both paths, so each node should use one routing mechanism ([routing warning](https://docs.langchain.com/oss/javascript/langgraph/graph-api#conditional-edges)).

The official JavaScript RAG graph uses five stages: `generateQueryOrRespond`, `retrieve`, `gradeDocuments`, `rewrite`, and `generate`. It conditionally skips retrieval for answerable inputs, grades retrieved content, loops through query rewriting when content is irrelevant, and generates only from accepted context ([agentic-RAG assembly](https://docs.langchain.com/oss/javascript/langgraph/agentic-rag#assemble-the-graph)). Pali Docs can apply the same control points while retaining its existing Pinecone search. A production graph must add a maximum rewrite/retrieval count and an explicit “insufficient evidence” terminal path; the tutorial's rewrite edge is otherwise a cycle.

### Subgraphs

A compiled graph can be used as a node in a parent graph. Shared state keys permit direct composition; different schemas use a wrapper that maps parent state into subgraph input and maps results back. First-party guidance positions subgraphs for multi-agent systems, reusable workflows, and separately owned modules ([subgraphs](https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs)).

Subgraphs have three persistence modes: per-invocation (default, inherits the parent checkpointer during one call), per-thread (accumulates state across calls), and stateless. Per-thread subgraphs cannot safely receive parallel calls to the same subgraph namespace because checkpoint writes conflict; the caller must prevent parallel tool calls ([subgraph persistence](https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs#subgraph-persistence)). For the first Pali Docs graph, ordinary nodes are simpler; subgraphs become useful only if retrieval strategies or specialist agents acquire independent state and stable input/output contracts.

### Persistence, checkpointing, and durable execution

A checkpointer records graph state at super-step boundaries under a `thread_id`; node-level pending writes preserve successful siblings if another node in the same super-step fails. This enables conversational memory, time travel, interrupts, fault recovery, and replay ([checkpointers](https://docs.langchain.com/oss/javascript/langgraph/checkpointers)). Stores are a separate cross-thread key-value facility for long-term application memory; checkpoints are thread-scoped execution state ([persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)).

Durability is tunable per run: `exit` writes only when the graph exits, `async` overlaps checkpoint writes with the next step and carries a small crash-loss window, and `sync` persists before the next step at higher latency ([durability modes](https://docs.langchain.com/oss/javascript/langgraph/checkpointers#durability-modes)). Available first-party JavaScript backends include in-memory, SQLite, PostgreSQL, MongoDB, and Redis; the docs recommend in-memory/SQLite for experimentation and PostgreSQL, MongoDB, or Redis for production ([checkpointer libraries](https://docs.langchain.com/oss/javascript/langgraph/checkpointers#checkpointer-libraries)).

Checkpointing makes an interrupted run recoverable, but the open-source in-process runtime is not itself a background job service. LangSmith Agent Server separately supplies PostgreSQL-backed state, a task queue, workers, cancellation, and streaming pub/sub ([Agent Server architecture](https://docs.langchain.com/langsmith/agent-server)). Therefore an arbitrary Next.js invocation that dies can be resumed from a durable checkpoint on a later invocation, but automatic queued continuation requires additional infrastructure or Agent Server.

### Interrupts and human-in-the-loop

`interrupt()` pauses inside a node, persists state through a checkpointer, and returns a JSON-serializable payload under `__interrupt__`. A later invocation with the same `thread_id` and `new Command({ resume: value })` resumes the workflow ([interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)). This can support approval of a rewritten query, review of low-confidence evidence, or escalation rather than an unsupported answer.

Resume restarts the interrupted node from its beginning. Code before `interrupt()` runs again, so earlier side effects must be idempotent or moved into a later node; interrupt order must remain stable and payloads must be serializable ([interrupt safety rules](https://docs.langchain.com/oss/javascript/langgraph/interrupts#rules-of-interrupts)). In Next.js this implies at least two request phases—return the interrupt to the client, then accept a later resume command—with authenticated ownership checks around `thread_id`.

### Streaming

The lower-level stream API exposes `updates`, `values`, `messages`, `custom`, `tools`, and `debug`. `messages` yields LangChain chat-model tokens; `custom` emits arbitrary node data through the runtime writer. The docs explicitly prescribe `custom` mode for any LLM API that does not implement the LangChain chat-model interface ([streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming#use-with-any-llm)).

The newer event-streaming API provides typed projections over one execution: messages, values, nested subgraphs, final output, interrupts, and extensions, with concurrent consumers that do not consume one another's events ([event streaming](https://docs.langchain.com/oss/javascript/langgraph/event-streaming)). For Pali Docs, AI SDK `streamText` tokens and the existing `data-status`, `data-task`, `data-reasoning`, and `data-suggestions` events would need an adapter into/out of LangGraph custom events; adopting LangGraph alone does not automatically preserve the current AI SDK UI message protocol.

### Retries and error handling

Retries are opt-in per node (or via graph defaults) with maximum attempts, exponential backoff, jitter, and a `retryOn` predicate. The current API also supports per-node run/idle timeouts and an `errorHandler` that executes after retries and can update state or route with `Command`; timeout/error-handler support requires `@langchain/langgraph >= 1.4.0` ([fault tolerance](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance)).

This supports distinct handling for transient model/Pinecone failures, model-recoverable weak retrieval, user-fixable uncertainty, and terminal failures. Retries can repeat billable LLM/embedding/vector calls, so they should target transient errors only. Resumption or retries can also re-execute a node; external side effects and charged operations need idempotency/deduplication where practical ([interrupt idempotency guidance](https://docs.langchain.com/oss/javascript/langgraph/interrupts#side-effects-called-before-interrupt-must-be-idempotent)).

### Relationship to LangChain agents

LangGraph is the low-level runtime; LangChain is a higher-level agent framework. LangChain 1.x `createAgent` is built on LangGraph and exposes a model/tool loop plus middleware, state, persistence, and streaming, while raw LangGraph is intended for bespoke orchestration and can be used without LangChain ([product comparison](https://docs.langchain.com/oss/javascript/concepts/products), [agents](https://docs.langchain.com/oss/javascript/langchain/agents)).

For Pali Docs, `createAgent` would be the shorter path only if the team wants to replace its current AI SDK agent loop with LangChain model and tool abstractions. Raw `StateGraph` is the lower-risk path when the goal is explicit retrieval/grade/rewrite/generate routing while preserving existing provider and UI contracts.

## Fit with current TypeScript/AI SDK stack

### Repository fit

- `app/api/question/route.ts` already runs in `runtime = "nodejs"`, allows 120 seconds, streams AI SDK UI events, offers `searchDocs` and `suggestQuestions`, prevents repeated search within one request, and injects retrieved context on the next model step. This is already a small agent loop, but its state is closure-local and its routing is coupled to `streamText.prepareStep`.
- `lib/services/rag-pipeline.ts` and `lib/services/vector-store.ts` expose narrow async functions (`searchDocuments`, `queryPinecone`, `formatContext`) that can be called directly from graph nodes; no LangChain retriever abstraction is required.
- `lib/services/embedding.ts` has a process-local LRU embedding cache. Like a `MemorySaver`, it is opportunistic in serverless deployments and should not be treated as durable across instances.
- `package.json` has Next.js 15, TypeScript 5.8, Zod 4, AI SDK 5, and no LangChain/LangGraph packages. Current upstream `@langchain/langgraph` declares Node `>=18`, peers on `@langchain/core` and Zod, and a browser export ([package source](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/package.json)). The repository lock currently resolves Zod 4.0.17, while upstream's current Zod 4 peer range begins at 4.2.0; adoption would need a compatible Zod resolution and dependency review.

### Next.js and serverless

First-party deployment documentation demonstrates an agent entirely inside Next.js App Router route handlers using the Node runtime and SSE, so in-process LangGraph is a supported architecture ([Next.js guide](https://docs.langchain.com/langsmith/deploy-nextjs)). The existing Pali route already selects the Node runtime, which is the appropriate starting point.

The same guide warns that in-memory checkpointers and process-local session maps are not durable across Vercel cold starts or replicas. Production persistence needs a durable checkpointer, and live SSE replay needs a separate shared session/replay store ([production persistence](https://docs.langchain.com/langsmith/deploy-nextjs#production-persistence)). The first-party Postgres saver uses Node `pg` and raw TCP/TLS; this works in standard Node/Bun but needs Hyperdrive or an HTTP/WebSocket-backed custom saver in runtimes such as Cloudflare Workers ([Postgres saver README](https://github.com/langchain-ai/langgraphjs/blob/main/libs/checkpoint-postgres/README.md#edge--serverless-runtimes-cloudflare-workers-etc)).

Two viable deployment shapes follow:

1. **Inline graph in the current route:** lowest operational change; bounded runs must finish within host duration limits, and durable features require an external saver. Preserve the existing UI protocol with a custom stream adapter.
2. **Next.js frontend/route proxy plus Agent Server:** appropriate for background/long-running runs, queued work, managed persistence, cancellation, and reconnection. This adds a separate service and potentially LangSmith Cloud cost/lock-in; managed Cloud offers serverless and dedicated deployment types ([Cloud deployment](https://docs.langchain.com/langsmith/deploy-to-cloud-overview)).

Edge runtime migration is not recommended for the first implementation. While LangGraph publishes a browser/web export and official deployment material lists edge platforms, database drivers and existing Pinecone/AI provider dependencies must all be edge-compatible; the current Node route avoids that compatibility surface.

## Costs/risks

- **More model calls:** relevance grading and query rewriting improve control but add latency and token spend. A rewrite cycle can loop indefinitely without an explicit count/termination invariant; the official RAG example contains a cycle, so Pali must add a bound ([agentic-RAG graph](https://docs.langchain.com/oss/javascript/langgraph/agentic-rag#assemble-the-graph)).
- **Duplicate paid operations:** retry/resume can repeat embeddings, Pinecone queries, and generation. Restrict automatic retries to transient failures, checkpoint expensive results when durability is enabled, and use stable deduplication keys where a call has side effects ([fault tolerance](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance)).
- **Persistence cost and data governance:** checkpoints can save state at every super-step and accumulate history. Keeping full retrieved passages and conversation content in state increases database volume and retention/privacy exposure; durability mode and retention must be chosen deliberately ([checkpointers](https://docs.langchain.com/oss/javascript/langgraph/checkpointers)).
- **Streaming bridge complexity:** the current client understands AI SDK UI chunks, whereas LangGraph's automatic token stream targets LangChain chat models. Raw AI SDK use requires custom events and translation ([custom LLM streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming#use-with-any-llm)).
- **Serverless state split:** a durable checkpointer preserves graph state, but live stream replay/session coordination is a separate shared-state problem in multi-replica Next.js ([Next.js persistence guidance](https://docs.langchain.com/langsmith/deploy-nextjs#production-persistence)).
- **State leakage:** `values` streaming can expose internal/private channels unless `outputKeys` or safer stream modes are used ([Graph API warning](https://docs.langchain.com/oss/javascript/langgraph/graph-api#multiple-schemas)).
- **Concurrency constraints:** per-thread subgraphs conflict under parallel calls to the same subgraph; subgraph namespaces and parallelism require deliberate design ([subgraph persistence](https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs#per-thread)).
- **Framework and version surface:** raw LangGraph adds `@langchain/langgraph` and `@langchain/core`; LangChain agents add the broader `langchain` model/tool/middleware stack. Current upstream JavaScript APIs are evolving—recent fault-tolerance features require 1.4+—so versions should be pinned and upgrades reviewed against persisted state and streaming contracts ([fault tolerance version note](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance), [package source](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/package.json)).
- **Managed deployment trade-off:** Agent Server removes checkpoint/queue plumbing but introduces another deployment, API boundary, operational dependency, and possible paid LangSmith Cloud plan ([Agent Server](https://docs.langchain.com/langsmith/agent-server), [Cloud prerequisites](https://docs.langchain.com/langsmith/deploy-to-cloud-overview)).

## Recommendation

Adopt LangGraph only for orchestration that the existing `streamText` tool loop cannot express cleanly. The best first target is one raw `StateGraph` with explicit state and ordinary nodes for: classify/decide retrieval → Pinecone search → deterministic evidence checks plus optional model relevance grade → bounded query rewrite → grounded answer → suggestions. Keep `searchDocuments`, the current AI SDK provider, prompts, and AI SDK client transport. Use conditional edges for pure routing, and keep the maximum retrieval/rewrite count in state.

Start without subgraphs, interrupts, or LangChain `createAgent`. If the graph completes in one route request, checkpointing is optional; avoiding it keeps latency and data retention smaller. Add node retry policies only around known transient external failures and keep domain outcomes such as “no relevant passage” in normal graph state rather than exceptions.

If product requirements later include resumable conversations, approval, or recovery across requests, add a stable authenticated `thread_id`, an external Redis/Postgres/MongoDB checkpointer, explicit retention, and idempotent nodes before enabling interrupts. Choose `sync` durability only where losing the previous step is unacceptable; otherwise measure `async` against latency. Do not use `MemorySaver` as production durability.

Use LangSmith Agent Server only when the workload truly needs background execution, queued continuation beyond request lifetimes, cancellation/reconnection, or managed persistence at scale. Use LangChain `createAgent` only if the team intentionally standardizes on LangChain's model/tool/middleware interface; it is not required to gain LangGraph's routing and durable-runtime features.

## Sources

Primary sources only:

- [LangGraph JavaScript overview](https://docs.langchain.com/oss/javascript/langgraph/overview)
- [Graph API: state, nodes, edges, routing, commands, and node caching](https://docs.langchain.com/oss/javascript/langgraph/graph-api)
- [Official JavaScript agentic-RAG tutorial](https://docs.langchain.com/oss/javascript/langgraph/agentic-rag)
- [Subgraphs](https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs)
- [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [Checkpointers and durability modes](https://docs.langchain.com/oss/javascript/langgraph/checkpointers)
- [Interrupts and human-in-the-loop](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [Streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming)
- [Event streaming](https://docs.langchain.com/oss/javascript/langgraph/event-streaming)
- [Fault tolerance: retries, timeouts, error handlers, and graceful shutdown](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance)
- [LangChain agents](https://docs.langchain.com/oss/javascript/langchain/agents)
- [LangChain/LangGraph product relationship](https://docs.langchain.com/oss/javascript/concepts/products)
- [Official Next.js deployment guide](https://docs.langchain.com/langsmith/deploy-nextjs)
- [LangSmith Agent Server architecture](https://docs.langchain.com/langsmith/agent-server)
- [LangSmith Cloud deployment](https://docs.langchain.com/langsmith/deploy-to-cloud-overview)
- [`langchain-ai/langgraphjs` official repository](https://github.com/langchain-ai/langgraphjs)
- [`@langchain/langgraph` package metadata](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/package.json)
- [Official PostgreSQL checkpointer README](https://github.com/langchain-ai/langgraphjs/blob/main/libs/checkpoint-postgres/README.md)
