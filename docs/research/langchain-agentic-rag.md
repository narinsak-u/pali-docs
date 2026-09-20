# LangChain JavaScript for agentic RAG

## Executive summary

LangChain JS is viable for a TypeScript agentic-RAG layer, but Pali Docs does not need a wholesale LangChain migration. Its current chat route already implements a bounded agent loop with AI SDK tools, streams custom progress to the client, and calls a small Pinecone retrieval module ([`app/api/question/route.ts`](../../app/api/question/route.ts), [`lib/services/rag-pipeline.ts`](../../lib/services/rag-pipeline.ts), [`lib/services/vector-store.ts`](../../lib/services/vector-store.ts)). LangChain's strongest incremental value is a standardized agent harness, retrieval components, checkpoint-backed conversation state, and LangSmith traces/evaluations—not replacement of working ingestion, Pinecone access, or the AI SDK UI.

The recommended path is therefore incremental:

1. Keep `searchDocuments` and the existing Pinecone/embedding code as the retrieval implementation.
2. Add tracing and a RAG evaluation dataset before changing orchestration. LangSmith does not require LangChain adoption and its AI SDK tracing page is labeled for AI SDK v5–v7, but that page currently contains inconsistent v5/v6 wording around `wrapAISDK`; pin and verify the exact `ai`/`langsmith` combination before choosing it ([AI SDK tracing guide](https://docs.langchain.com/langsmith/trace-with-vercel-ai-sdk), [RAG evaluation tutorial](https://docs.langchain.com/langsmith/evaluate-rag-tutorial)).
3. Prototype LangChain `createAgent` only if evaluation shows that model-directed query rewriting, conditional retrieval, retry/fallback middleware, or persistent threads improve measured quality. Bridge its stream into the existing AI SDK UI with `@ai-sdk/langchain` rather than replacing `useChat` ([adapter documentation](https://ai-sdk.dev/providers/adapters/langchain)).
4. Use LangGraph directly only when the workflow needs explicit branches, durable resumability, human approval, or deterministic multi-stage control. `createAgent` already runs as a compiled LangGraph, so adopting both layers on day one would be unnecessary ([middleware and LangGraph composition](https://docs.langchain.com/oss/javascript/langchain/middleware/overview)).

## Capabilities

### Agents and tools

`createAgent` supplies the standard model/tool loop: the model chooses a tool, receives its result, and continues until it returns a final answer. It accepts a model instance or provider/model identifier, a system prompt, tools, middleware, structured output, a checkpointer, and a long-term store ([agents](https://docs.langchain.com/oss/javascript/langchain/agents)). Tools are typed callable functions whose inputs can be described with Zod; they can read per-run context, access stores, update graph state, and emit custom streaming updates ([tools](https://docs.langchain.com/oss/javascript/langchain/tools)).

For agentic RAG, retrieval can remain an ordinary tool. LangChain's retrieval guide explicitly describes agentic RAG as giving an agent one or more external-knowledge tools and letting it decide when and how to retrieve; it contrasts this with predictable two-step RAG and notes that agentic latency is variable ([retrieval architectures](https://docs.langchain.com/oss/javascript/deepagents/retrieval)). This maps directly to wrapping Pali Docs' existing `searchDocuments(query, { topK })` rather than changing the vector-store layer.

Middleware is the main advantage over a hand-built loop when the harness grows. Current JS middleware supports prompt/tool transformation, retries, model fallbacks, call limits, guardrails, early termination, and logging hooks. The same configured agent can also be embedded as a node in a larger LangGraph ([middleware overview](https://docs.langchain.com/oss/javascript/langchain/middleware/overview)).

### Retrievers, loaders, and splitters

LangChain defines a retriever as a component that accepts an unstructured string and returns `Document[]`; every vector store can be exposed as a retriever, but a retriever need not itself store documents ([retriever integrations](https://docs.langchain.com/oss/javascript/integrations/retrievers)). The standard `Document` carries `pageContent`, arbitrary metadata, and an optional ID, which is useful for retaining source and citation metadata across retrieval stages ([semantic-search tutorial](https://docs.langchain.com/oss/javascript/langchain/knowledge-base)).

Document loaders normalize filesystem and remote sources into that `Document` shape through a shared loader interface. The current JS catalog includes file loaders such as directory, JSON/JSONL, multi-file, and text loaders, plus provider-specific integrations; the documentation warns that community loaders are user-contributed and unverified ([document loaders](https://docs.langchain.com/oss/javascript/integrations/document_loaders)). Splitters live in the separate `@langchain/textsplitters` package. The docs recommend `RecursiveCharacterTextSplitter` as the general default and also provide token-, character-, and code-structure-based strategies ([text splitters](https://docs.langchain.com/oss/javascript/integrations/splitters)).

These ingestion abstractions are capable, but they are not an immediate benefit for this repository: the online RAG path already queries a populated Pinecone index, while the checked-in `scripts/update-index.mjs` is an Algolia/Fumadocs indexing job, not the Pinecone ingestion path. Replacing either without a measured retrieval problem would add a second convention rather than solve one.

### Reranking and contextual compression

Reranking exists in current LangChain JS, but its packaging is less central than the v1 agent API. `ContextualCompressionRetriever` is currently in `@langchain/classic`; it wraps a base retriever, retrieves candidates, then calls a `BaseDocumentCompressor` with those documents and the query ([official source](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-classic/src/retrievers/contextual_compression.ts)). The v1 migration guide confirms that legacy chains, indexing, and community re-exports moved to `@langchain/classic` ([v1 migration guide](https://docs.langchain.com/oss/javascript/migrate/langchain-v1)).

A concrete JS reranker is `CohereRerank` in `@langchain/cohere`. It calls Cohere's rerank API, returns the top documents in relevance order, and adds a relevance score to document metadata ([official source](https://github.com/langchain-ai/langchainjs/blob/main/libs/providers/langchain-cohere/src/rerank.ts)). This is useful as an optional precision stage over a wider Pinecone candidate set, but it adds another network call, provider, credential, and per-query cost. It should be benchmarked against Pali-language content before adoption; framework availability does not establish model quality for this corpus.

### Memory and checkpointing

LangChain agents use LangGraph persistence rather than a separate LangChain memory runtime. Short-term memory is graph state scoped to a thread; passing a checkpointer and a stable `thread_id` persists state so later turns and intermediate tool steps can resume the same conversation ([short-term memory](https://docs.langchain.com/oss/javascript/langchain/short-term-memory)). Long-term memory is a LangGraph store of JSON documents organized by namespace and key and can span threads; production examples use database-backed stores rather than `InMemoryStore` ([long-term memory](https://docs.langchain.com/oss/javascript/langchain/long-term-memory)).

This distinction matters for Pali Docs: chat history already arrives from the AI SDK client, so a checkpointer is not required merely to preserve visible conversation context. It becomes valuable for durable server-side threads, resumable interrupted work, or state that is not round-tripped through the browser. Long-term memory should be introduced only with explicit product semantics, retention rules, and user isolation.

### Streaming and structured output

LangChain can stream model tokens, reasoning content when supplied by the provider, tool calls/results, agent-step state updates, and arbitrary custom updates. Its current docs recommend the typed event-streaming API for new applications; the lower-level stream modes expose messages, updates, and custom data ([streaming](https://docs.langchain.com/oss/javascript/langchain/streaming)).

`createAgent` can validate a final structured response against Zod, Standard Schema, or JSON Schema. It chooses provider-native structured output when the model profile supports it and otherwise uses a tool-calling strategy; callers can explicitly select `providerStrategy` or `toolStrategy` ([structured output](https://docs.langchain.com/oss/javascript/langchain/structured-output)). This is relevant to follow-up suggestions or citation payloads, but provider/model support still matters: tool-based fallback requires reliable tool calling, and simultaneous tools plus native structured output requires a model that supports both.

### Observability and evaluation

LangChain components can be traced in LangSmith with environment configuration alone, or selectively with a `LangChainTracer`; the serverless guidance recommends synchronous callback flushing so traces finish before the function exits ([LangChain tracing](https://docs.langchain.com/langsmith/trace-with-langchain)). LangSmith also documents direct AI SDK tracing without LangChain. Its current page is labeled for AI SDK v5–v7 but contains inconsistent version wording for `wrapAISDK`, so compatibility with this repository's exact AI SDK 5 release must be verified before adoption ([AI SDK tracing](https://docs.langchain.com/langsmith/trace-with-vercel-ai-sdk)).

For RAG, LangSmith's official TypeScript tutorial covers datasets, application runs, and evaluators for answer relevance, answer accuracy, and retrieval quality ([RAG evaluation tutorial](https://docs.langchain.com/langsmith/evaluate-rag-tutorial)). Its evaluation system supports offline benchmarking/regression testing and online evaluators, using code, LLM-as-judge, pairwise, composite, and summary evaluators ([evaluation types](https://docs.langchain.com/langsmith/evaluation-types)). LangSmith is a hosted product by default, though the platform also documents cloud, hybrid, and self-hosted options ([observability overview](https://docs.langchain.com/langsmith/observability)).

## Fit with current TypeScript/AI SDK stack

### What fits well

- **Runtime and language:** LangChain JS is TypeScript-native and officially supports Node, Bun, Vercel/Next.js serverless and edge environments. The current installation docs require Node.js 22+ or Bun 1.0+ ([repository support matrix](https://github.com/langchain-ai/langchainjs), [installation](https://docs.langchain.com/oss/javascript/langchain/install)). The repository already uses Bun 1.4 and a Node runtime for the question route.
- **Existing retrieval seam:** `searchDocuments` already accepts a string and returns matches plus formatted context. It is a natural LangChain tool boundary; there is no requirement to adopt LangChain's Pinecone wrapper, embeddings, loaders, or splitters.
- **Existing UI:** The official `@ai-sdk/langchain` adapter converts AI SDK `UIMessage` values into LangChain messages and converts LangChain/LangGraph streams back into `UIMessageStream`. It supports text, tool calls/results, multimodal content, typed custom data, agent streams, and `streamEvents` ([adapter documentation](https://ai-sdk.dev/providers/adapters/langchain)). The React `useChat` surface can therefore remain unchanged.
- **OpenRouter:** LangChain has a dedicated `@langchain/openrouter` integration with streaming, tool calling, and structured output ([OpenRouter integration](https://docs.langchain.com/oss/javascript/integrations/chat/openrouter)). This is a cleaner match for the repository's default provider than pretending every OpenRouter capability is generic OpenAI.
- **Other OpenAI-compatible endpoints:** `ChatOpenAI` accepts a custom `configuration.baseURL`, custom headers, and an option to disable streaming usage metadata for proxies that reject `stream_options` ([ChatOpenAI custom URLs](https://docs.langchain.com/oss/javascript/integrations/chat/openai)). That can cover the current OpenCode endpoint, subject to endpoint compatibility.

### Friction

- **Two orchestration and message models:** The route currently uses AI SDK `streamText`, `tool`, `prepareStep`, `createUIMessageStream`, and custom data parts. A LangChain agent would replace the server-side orchestration rather than plug into `streamText`; `@ai-sdk/langchain` is then required at the transport boundary. Running both agent loops for one request would be incorrect and wasteful.
- **Provider duplication:** The current `lib/services/llm-provider.ts` returns an AI SDK `LanguageModel` from `@ai-sdk/openai-compatible`; LangChain expects a LangChain chat-model instance. Supporting both paths means maintaining two provider factories, or migrating the question route's model layer while leaving other AI SDK pipelines alone.
- **Package surface:** A practical agent path adds `langchain`, `@langchain/core`, a provider package, `@ai-sdk/langchain`, and `@langchain/langgraph` when checkpointing/stores are needed. Contextual compression may additionally require `@langchain/classic` and a reranker integration ([installation](https://docs.langchain.com/oss/javascript/langchain/install), [v1 migration](https://docs.langchain.com/oss/javascript/migrate/langchain-v1)).
- **Model variance:** The repository's default OpenRouter model is configured locally and may be changed without a code release. Tool calling and structured-output reliability must be evaluated per selected model; LangChain's common interface does not erase provider capability differences ([model capabilities](https://docs.langchain.com/oss/javascript/langchain/models)).

## Costs/risks

- **Latency and token cost:** Agentic RAG can invoke the model and retrieval tools multiple times, so latency is variable; two-step RAG is more predictable because the number of calls is bounded ([retrieval architecture comparison](https://docs.langchain.com/oss/javascript/deepagents/retrieval)). Pali Docs' existing one-search cache and five-step cap should remain explicit invariants in any prototype.
- **Framework weight and migration churn:** LangChain v1 intentionally moved legacy retrieval/chains into `@langchain/classic`, while current agent APIs live in `langchain`. Mixing modern agents with classic compression is supported by source but broadens the dependency and upgrade surface ([v1 migration guide](https://docs.langchain.com/oss/javascript/migrate/langchain-v1)).
- **Streaming regressions:** The current UI consumes application-specific status, task, reasoning, and suggestion parts. The adapter supports custom data, but every event and persistence behavior must be mapped deliberately; a text-only stream would regress the product ([AI SDK adapter](https://ai-sdk.dev/providers/adapters/langchain)).
- **State/privacy obligations:** Checkpointing stores conversation state, and long-term stores persist user/application data across threads. Production use therefore needs authenticated thread ownership, retention/deletion rules, encryption and secrets handling; in-memory implementations are explicitly presented as non-production choices ([short-term memory](https://docs.langchain.com/oss/javascript/langchain/short-term-memory), [long-term memory](https://docs.langchain.com/oss/javascript/langchain/long-term-memory)).
- **Observability data exposure and cost:** Traces may contain prompts, retrieved passages, tool inputs, and responses. LangSmith improves debugging and evaluation, but deployment choice, sampling, redaction, retention, and billing must be reviewed before production tracing ([observability overview](https://docs.langchain.com/langsmith/observability)).
- **Reranker uncertainty:** A hosted reranker adds cost and failure modes, while its effectiveness for Thai/Pali textbook queries is an empirical question. Adopt it only if a retrieval evaluation shows a quality gain over Pinecone scores and simple filtering.

## Recommendation

**Do not migrate the full RAG pipeline to LangChain now.** The current repository already has the minimum useful agentic behavior: model-selected search, a bounded step loop, single-query caching, context injection, tool disabling after retrieval, and UI progress streaming. Replacing this one-for-one would add dependencies without adding capability.

**Adopt the ecosystem in this order:**

1. **Measurement first:** instrument the existing AI SDK v5 route and build a representative dataset that separately scores retrieval relevance, groundedness/citation support, answer quality, search-call count, latency, and cost. LangSmith is one option after exact package compatibility and trace-data policy are verified; framework-neutral structured metrics remain a valid baseline ([AI SDK tracing](https://docs.langchain.com/langsmith/trace-with-vercel-ai-sdk), [RAG evaluation](https://docs.langchain.com/langsmith/evaluate-rag-tutorial)).
2. **Retrieval experiment second:** test a wider Pinecone candidate set followed by reranking outside the agent loop. Keep it only if the evaluation improves. Prefer direct composition around the existing `DocumentMatch` type; use `ContextualCompressionRetriever` only if multiple compressors/retrievers justify the classic abstraction.
3. **LangChain agent prototype third:** if measured failures require query rewriting, conditional second retrieval, provider fallback, or reusable middleware, implement one server-side `createAgent` whose search tool calls the existing `searchDocuments`. Preserve the current call cap and one-search policy in tool/middleware code. Use `ChatOpenRouter` for OpenRouter and a custom-base-URL `ChatOpenAI` for the OpenCode-compatible endpoint.
4. **Keep AI SDK at the UI boundary:** convert incoming messages with `toBaseMessages`, stream the LangChain agent once, and convert it with `toUIMessageStream`. Reproduce all current custom status/task/reasoning/suggestion events before cutover ([adapter documentation](https://ai-sdk.dev/providers/adapters/langchain)).
5. **Add checkpointing only for a defined durable-thread feature.** Do not duplicate browser-supplied chat history in a new database by default. If durable state is required, use a production checkpointer and authorize every `thread_id`.
6. **Escalate to explicit LangGraph only when topology demands it.** Examples are deterministic retrieve-grade-rewrite loops, parallel retrieval sources, approval interrupts, or resumable long-running work. Ordinary agentic retrieval should remain `createAgent`, because that API already compiles to LangGraph ([middleware composition](https://docs.langchain.com/oss/javascript/langchain/middleware/overview)).

**Decision criterion:** LangChain is justified when the evaluation suite demonstrates that its orchestration or retrieval components produce a material quality/reliability gain that cannot be achieved cleanly inside the existing AI SDK loop. LangSmith can be justified earlier because it measures the current system without forcing that architectural commitment.

## Sources

- [LangChain JS agents](https://docs.langchain.com/oss/javascript/langchain/agents)
- [LangChain JS tools](https://docs.langchain.com/oss/javascript/langchain/tools)
- [LangChain JS retrieval and RAG architectures](https://docs.langchain.com/oss/javascript/deepagents/retrieval)
- [LangChain JS middleware](https://docs.langchain.com/oss/javascript/langchain/middleware/overview)
- [LangChain JS streaming](https://docs.langchain.com/oss/javascript/langchain/streaming)
- [LangChain JS structured output](https://docs.langchain.com/oss/javascript/langchain/structured-output)
- [LangChain JS short-term memory](https://docs.langchain.com/oss/javascript/langchain/short-term-memory)
- [LangChain JS long-term memory](https://docs.langchain.com/oss/javascript/langchain/long-term-memory)
- [LangChain JS semantic-search tutorial](https://docs.langchain.com/oss/javascript/langchain/knowledge-base)
- [LangChain JS document loaders](https://docs.langchain.com/oss/javascript/integrations/document_loaders)
- [LangChain JS text splitters](https://docs.langchain.com/oss/javascript/integrations/splitters)
- [LangChain JS retrievers](https://docs.langchain.com/oss/javascript/integrations/retrievers)
- [LangChain JS v1 migration guide](https://docs.langchain.com/oss/javascript/migrate/langchain-v1)
- [`ContextualCompressionRetriever` source](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-classic/src/retrievers/contextual_compression.ts)
- [`CohereRerank` source](https://github.com/langchain-ai/langchainjs/blob/main/libs/providers/langchain-cohere/src/rerank.ts)
- [LangChain OpenRouter integration](https://docs.langchain.com/oss/javascript/integrations/chat/openrouter)
- [LangChain OpenAI-compatible custom URL configuration](https://docs.langchain.com/oss/javascript/integrations/chat/openai)
- [Vercel AI SDK LangChain adapter](https://ai-sdk.dev/providers/adapters/langchain)
- [LangSmith tracing for LangChain JS](https://docs.langchain.com/langsmith/trace-with-langchain)
- [LangSmith tracing for Vercel AI SDK](https://docs.langchain.com/langsmith/trace-with-vercel-ai-sdk)
- [LangSmith RAG evaluation tutorial](https://docs.langchain.com/langsmith/evaluate-rag-tutorial)
- [LangSmith evaluation types](https://docs.langchain.com/langsmith/evaluation-types)
- [LangSmith observability overview](https://docs.langchain.com/langsmith/observability)
