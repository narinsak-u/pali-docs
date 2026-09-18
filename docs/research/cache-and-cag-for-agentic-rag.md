# LangCache, semantic caching, and CAG for agentic RAG

## Executive summary

Pali Docs should treat caching as a layered complement to retrieval, not as one interchangeable feature:

- **Keep retrieval as the authoritative path for the changing Pali corpus.** The current request embeds a query, searches Pinecone, and supplies the top matches to an AI SDK tool-calling loop (`lib/services/rag-pipeline.ts`, `lib/services/vector-store.ts`, and `app/api/question/route.ts`). Neither response caching nor provider prompt caching makes new or changed documents discoverable.
- **Use provider prompt caching first where the selected OpenRouter model actually supports it.** It can reduce repeated processing of stable system instructions, tool schemas, conversation prefixes, or a deliberately small static corpus prefix. It is exact-prefix/KV-state reuse, not semantic answer reuse, and the model still generates a new answer. OpenRouter documents provider-dependent support, sticky routing, and per-request cached-token metrics: [OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching).
- **Pilot semantic response caching only for stable, standalone FAQ-like questions.** Redis LangCache is currently a Redis product: a managed semantic response-cache service with REST and JavaScript/Python SDKs, automatic prompt embeddings, similarity thresholds, TTLs, attributes, deletion, and metrics. It is not a LangChain component and does not require adopting LangChain or LangGraph. Redis Cloud LangCache is documented as public preview; self-managed LangCache is private preview and requires Kubernetes plus a license ([overview](https://redis.io/docs/latest/develop/ai/context-engine/langcache/), [self-managed deployment](https://redis.io/docs/latest/operate/iris/langcache/self-managed/)).
- **Do not replace corpus retrieval with full CAG now.** The original CAG paper preloads the entire knowledge set into a long-context model and reuses its precomputed KV cache. Its stated applicability condition is a limited, manageable corpus that fits the context; its results also show generation cost increasing and quality advantages narrowing as context grows ([Chan et al., 2025](https://arxiv.org/html/2412.15605)). A versioned, static “core Pali reference” could be evaluated as a CAG prefix, while Pinecone remains the freshness and long-tail layer.

## Capabilities

### What “LangCache” means now

Redis uses **LangCache** as the product name for a semantic cache of complete LLM, RAG, or agent responses. Before an LLM call, the application sends a prompt to LangCache; LangCache embeds it and searches stored prompt embeddings. A hit returns the prior response and skips the LLM; a miss returns empty, after which the application generates and stores a response ([Redis LangCache architecture](https://redis.io/docs/latest/develop/ai/context-engine/langcache/)). This differs from:

- LangChain's generic LLM cache interfaces;
- a RAG vector index, which stores document chunks and returns evidence for generation; and
- a provider prompt cache, which reuses model prefix computation but still runs inference.

LangCache exposes a provider-neutral REST API and an official JavaScript package, `@redis-ai/langcache` ([API and SDK examples](https://redis.io/docs/latest/develop/ai/context-engine/langcache/api-examples/)). Its current controls include:

- a cache-wide default similarity threshold, with a per-search override;
- exact, semantic, or combined search strategies;
- TTL and eviction controls;
- up to five custom attributes, defined when the service is created and not editable afterward;
- deletion by entry ID, deletion by an all-matching attribute filter, and whole-cache flush; and
- Redis Cloud graphs for cache-hit ratio, search volume, and lookup latency ([service creation](https://redis.io/docs/latest/operate/iris/langcache/create-service/), [invalidation API](https://redis.io/docs/latest/develop/ai/context-engine/langcache/api-examples/), [monitoring](https://redis.io/docs/latest/operate/iris/langcache/monitor-cache/)).

### Four different cache layers

1. **Embedding cache.** Reuses an embedding for the same input. Pali Docs already has a process-local exact-string LRU with 100 entries and a one-hour TTL in `lib/services/embedding.ts`. It avoids an embedding API call but not Pinecone search or generation. Query embeddings remain valid across corpus edits, but must not survive an embedding-model, input-mode, normalization, or dimensionality change unless those values are part of the key/version.
2. **Retrieval-result cache.** Reuses document IDs/text returned for a query. It avoids both embedding and Pinecone lookup, but its key must include at least normalized query, `topK`, namespace/filter policy, embedding/retrieval version, and corpus revision. A corpus reindex or document change must move to a new revision or purge affected results. Exact caching is safer here than semantic result reuse because two nearby questions can still require different evidence.
3. **Semantic response cache.** Matches a new prompt to a prior prompt by embedding similarity and returns the prior final answer. A hit skips retrieval, tool execution, and generation. Redis explicitly distinguishes this from RAG vector search and warns that a loose threshold can return wrong answers while a strict one collapses hit rate ([Redis semantic-cache design](https://redis.io/docs/latest/develop/use-cases/semantic-cache/)).
4. **Provider prompt/prefix cache.** Reuses internal attention state for an unchanged prompt prefix. OpenAI states that its cache stores KV tensors, requires an exact rendered prefix match, and still processes new input and generates a response ([OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching/)). Anthropic similarly caches the `tools`, `system`, and `messages` prefix up to a breakpoint ([Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)). Gemini currently enables implicit caching for Gemini 2.5 and newer models and reports cached tokens in usage metadata ([Gemini context caching](https://ai.google.dev/gemini-api/docs/caching)).

These layers compose: an embedding or retrieval hit accelerates RAG; a provider prefix hit accelerates generation; a semantic response hit bypasses RAG and generation altogether.

### CAG versus KV/prefix caching

A transformer KV cache stores the attention keys and values of already processed tokens so they do not have to be recomputed for later tokens; it is model/layer state whose memory grows with sequence length ([Hugging Face Transformers cache explanation](https://huggingface.co/docs/transformers/en/cache_explanation)). **CAG is an application architecture built on that mechanism**, not a synonym for every prompt cache.

The original CAG method formats the whole relevant document collection into one model context, computes and stores that corpus KV state offline, loads it for each question, and truncates question-specific appended state between requests. It removes online retrieval only because every needed document is already in context ([CAG method](https://arxiv.org/html/2412.15605#S2)). The authors evaluated 21k–85k-token knowledge sets with Llama 3.1 8B, reported competitive or better BERTScore on their SQuAD/HotPotQA setup, and explicitly limited the recommendation to manageable knowledge bases; they also propose hybrid CAG plus selective retrieval ([experiments and limitations](https://arxiv.org/html/2412.15605#S3), [conclusion](https://arxiv.org/html/2412.15605#S4)). These results are evidence for a repository-specific experiment, not proof that a complete Pali corpus will fit or retain retrieval quality.

A provider prompt cache can approximate hosted CAG by placing a versioned corpus before the changing question, but it is weaker operationally than the paper's local, persisted KV artifact:

- cache eligibility, lifetime, routing, and pricing remain provider/model dependent;
- reuse requires an exact common prefix, not semantic similarity;
- a changed document invalidates reuse from the first changed token onward; and
- it reduces prefix-processing cost/latency, but does not reduce the model's need to attend over a long context or generate output.

## Fit with current TypeScript/AI SDK stack

- **Low integration friction for LangCache, but new infrastructure.** The REST API or official JavaScript SDK can wrap the current `streamText` call without LangChain. However, a cache hit must reproduce the endpoint's observable stream, not merely return an answer string: `app/api/question/route.ts` also emits status, search-task, retrieved-excerpt, reasoning, and suggestion data. Either cache a versioned structured response envelope or explicitly define a reduced cache-hit UX.
- **Current caches are narrow.** `lib/services/embedding.ts` caches exact text only inside one Node process. `app/api/question/route.ts` caches search matches only inside a single request so the agent cannot call Pinecone twice. There is no cross-instance retrieval cache or response cache.
- **Current provider abstraction makes support conditional.** `lib/services/llm-provider.ts` uses AI SDK's generic `createOpenAICompatible` adapter for OpenRouter or OpenCode. The adapter supports request transformation and metadata extraction, but provider-specific behavior is endpoint dependent ([AI SDK OpenAI-compatible provider](https://ai-sdk.dev/providers/openai-compatible-providers)). OpenRouter says most supported providers cache automatically, some require explicit markers, and it exposes `cached_tokens`/`cache_write_tokens`; therefore model selection and observed usage metadata, not the OpenAI-compatible API shape alone, determine whether Pali Docs benefits ([OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)).
- **The agent loop has both cache-friendly and cache-hostile parts.** Stable system instructions and tool definitions are good prefix candidates. After retrieval, `prepareStep` replaces the system prompt with query-specific passages, so the long portion differs per question and cannot share an exact provider prefix across unrelated queries. Appending rather than rewriting stable content improves prefix reuse; AI SDK documents message-level provider options and incremental caching for agent steps ([AI SDK dynamic prompt caching](https://ai-sdk.dev/cookbook/node/dynamic-prompt-caching)).
- **Full CAG is not yet justified by measured corpus size.** No current runtime path builds a complete corpus prompt or a corpus-revision identifier. Before any CAG cutover, measure rendered tokens for the production corpus, update frequency, first-token latency, cached-token rate, answer quality, citation/evidence behavior, and cold-cache behavior on the exact target model through OpenRouter.

## Decision matrix

| Approach | Hit semantics | Work skipped on hit | Freshness/invalidation | Can replace retrieval for changing Pali corpus? | Repository fit |
|---|---|---|---|---|---|
| Existing exact embedding LRU | Byte-identical query in one process | Embedding call | TTL/restart; version key on embedding changes | No | Keep; inexpensive and already present |
| Versioned exact retrieval cache | Exact normalized query + retrieval policy + corpus revision | Embedding and Pinecone query | Change revision on any index/corpus deployment; bounded TTL | No; only accelerates a known revision | Good second optimization if measurements show retrieval cost/latency |
| Redis LangCache semantic response cache | Exact and/or similarity-thresholded prior prompt, optionally attribute-filtered | Retrieval, agent steps, and LLM generation | TTL; delete ID; delete by attributes; flush; include corpus/prompt/model/access revisions | Only for cache hits whose response scope and corpus revision still match; misses still need retrieval | Targeted pilot for stable FAQ traffic, not a global front door |
| Provider prompt/prefix cache | Exact common token prefix/KV state | Reprocessing cached prefix | Provider TTL/routing; changed prefix becomes cold | No; it accelerates generation but does not discover documents | Best first experiment on a confirmed supported OpenRouter route/model |
| Corpus-in-context CAG | Entire versioned corpus preloaded as context/KV state | Online retrieval; possibly corpus prefill on a warm cache | Rebuild/warm on corpus or model/prompt change | Only while the complete authoritative corpus fits and is acceptably static | Experimental static-core path; unsuitable as the sole current design |
| Hybrid static-core CAG + RAG | Stable common corpus plus retrieval for fresh/long-tail material | Core retrieval and repeated core prefix processing | Independently version core prefix and dynamic index | Yes, because RAG remains the freshness path | Most plausible CAG experiment after measurement |

## Costs/risks

### Correctness, isolation, and invalidation

Semantic similarity is a probabilistic reuse decision, not proof that two questions have the same answer. Redis's monitoring guide cautions that a higher hit ratio can reflect overly lenient matching and worse relevance ([LangCache monitoring](https://redis.io/docs/latest/operate/iris/langcache/monitor-cache/)). Pali grammatical questions can differ by a negation, case, tense, quoted form, or requested source while remaining close in embedding space. Begin with exact search and a conservative semantic threshold; admit semantic hits only after an evaluation set measures false-hit rate, not just answer similarity or cache-hit ratio.

Every response-cache lookup must apply hard equality boundaries before similarity. At minimum reserve attributes or separate caches for `corpusRevision`, `systemPromptRevision`, `modelId`, `locale`, and `accessScope`/tenant. LangCache search returns only entries matching supplied attributes, and self-managed LangCache defines a cache itself as the logical isolation boundary ([attribute filtering](https://redis.io/docs/latest/develop/ai/context-engine/langcache/api-examples/#attributes), [isolation boundary](https://redis.io/docs/latest/operate/iris/langcache/self-managed/#api-surfaces)). A tenant or authorization boundary must never rely on the similarity threshold. Because Redis Cloud currently limits a service to five immutable custom-attribute definitions, decide the boundary schema before creation or use separate cache services.

Treat cached answers as derived, non-authoritative data. Corpus publication should atomically advance a revision used by retrieval-result keys, semantic-cache attributes, and CAG prefixes. Old entries may then expire naturally or be deleted by revision attribute; urgent corrections require deletion/flush. LangCache supports these operations, but no documented feature automatically knows that a Pali source changed, so the application/indexing workflow owns invalidation.

### Cost and latency

- Embedding caching has the smallest blast radius but saves only embedding work.
- Retrieval-result caching saves Pinecone work but can serve stale or differently ranked passages if its key omits `topK`, namespace, filters, or index revision.
- Semantic response caching has the largest potential saving because it skips output generation, but every lookup still incurs embedding, cache, and network cost; Redis notes that lookup latency depends strongly on embedding-provider and network performance ([monitoring](https://redis.io/docs/latest/operate/iris/langcache/monitor-cache/)).
- Provider prompt caching still incurs a model call, uncached suffix work, attention over context, and output tokens. It pays only where a sufficiently long stable prefix is reused before expiry. Provider pricing and thresholds change, so use current provider billing/usage fields rather than hard-coded savings assumptions.
- CAG removes retrieval latency but moves cost into long-context prefill/cache warming, KV memory/storage, and attention over the corpus. A cold cache or corpus update exposes those costs again.

### Observability

For every layer record `hit|miss|bypass|error`, latency, cache version, corpus revision, model/provider, and downstream token/LLM/retrieval usage. For semantic responses also record match strategy, similarity score, matched entry ID, TTL age, attribute scope, and a sampled human/evaluation verdict. Do not log raw user prompts or cached answers where that violates the data policy. Redis Cloud's built-in hit ratio, request count, and latency graphs are useful operational signals but do not measure answer correctness ([metrics reference](https://redis.io/docs/latest/operate/iris/langcache/monitor-cache/)). OpenRouter exposes provider cache reads/writes in usage metadata and a cache discount for cost analysis ([usage fields](https://openrouter.ai/docs/guides/best-practices/prompt-caching#inspecting-cache-usage)).

## Recommendation

1. **Retain Pinecone RAG as the source-of-truth path.** Introduce a `corpusRevision` first; it is the prerequisite for safe retrieval, response, and CAG caching.
2. **Measure before adding a service.** Capture current embedding latency, Pinecone latency, generation latency, repeated-query rate, exact duplicate rate, candidate semantic duplicate rate, token usage, and corpus rendered-token size. Without repetition, semantic caching adds latency and operations without meaningful hits.
3. **Enable/verify provider prefix caching on a supported production model.** Keep system instructions and tool schemas stable and first; inspect OpenRouter `cached_tokens` and `cache_write_tokens`. Do not assume the default free Gemma route supports useful caching merely because the endpoint is OpenAI-compatible.
4. **If retrieval is material, add a small versioned exact retrieval cache before semantic response caching.** Key it by normalized query plus all retrieval controls and `corpusRevision`; keep a bounded TTL. This preserves fresh generation and the existing evidence UI while removing repeat retrieval work.
5. **Pilot LangCache only on a strict eligibility lane:** standalone, public-corpus, stable FAQ questions; no user-specific context; validated answer shape; exact-first then conservative semantic matching. Use hard scope attributes, short TTL, revision-based delete, and a kill switch. Compare false-hit rate and end-to-end quality against uncached RAG. Preview status and the added Redis/embedding dependency argue against making it mandatory at first.
6. **Evaluate CAG only as a benchmarked static-core hybrid.** Build a versioned core reference that fits comfortably—not merely nominally—inside the selected model's effective context, place it at an exact stable prefix, and keep Pinecone available for changed, restricted, or long-tail material. Promote CAG to retrieval replacement only if the complete authoritative corpus fits, corpus updates are infrequent enough to tolerate cache rebuilds, cold and warm economics are favorable, and repository-specific answer/evidence evaluations beat or match RAG.

## Sources

- Redis, [Redis LangCache overview](https://redis.io/docs/latest/develop/ai/context-engine/langcache/)
- Redis, [Create a LangCache service](https://redis.io/docs/latest/operate/iris/langcache/create-service/)
- Redis, [LangCache API and SDK examples](https://redis.io/docs/latest/develop/ai/context-engine/langcache/api-examples/)
- Redis, [Monitor a LangCache service](https://redis.io/docs/latest/operate/iris/langcache/monitor-cache/)
- Redis, [Redis semantic cache](https://redis.io/docs/latest/develop/use-cases/semantic-cache/)
- Redis, [Self-managed LangCache](https://redis.io/docs/latest/operate/iris/langcache/self-managed/)
- Chan, Chen, Cheng, and Huang, [“Don't Do RAG: When Cache-Augmented Generation is All You Need for Knowledge Tasks”](https://arxiv.org/html/2412.15605), WWW Companion 2025
- CAG authors, [reference implementation](https://github.com/hhhuang/CAG)
- OpenAI, [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching/)
- Anthropic, [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Google, [Gemini API context caching](https://ai.google.dev/gemini-api/docs/caching)
- OpenRouter, [Prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)
- Vercel, [AI SDK OpenAI-compatible providers](https://ai-sdk.dev/providers/openai-compatible-providers)
- Vercel, [AI SDK dynamic prompt caching](https://ai-sdk.dev/cookbook/node/dynamic-prompt-caching)
- Hugging Face, [Transformers KV-cache explanation](https://huggingface.co/docs/transformers/en/cache_explanation)
