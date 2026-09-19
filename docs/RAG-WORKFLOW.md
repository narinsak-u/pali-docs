# Chat RAG Workflow

## Scope

`POST /api/question` is the streaming chat endpoint for the current AI SDK agent foundation. This document describes the implemented route, runner, retriever, event, configuration, and evaluation contracts. LangGraph orchestration and corpus-versioned response caching are not implemented here and are not deployment claims.

## Runtime boundaries

```text
Client
  │ POST /api/question ({ messages })
  ▼
Route: app/api/question/route.ts
  ├─ read and validate the bounded raw request body
  ├─ preflight model and RAG configuration
  ├─ create the AI SDK stream and event sinks
  └─ pass req.signal to AgentTurnRunner
         │
         ▼
Runner: lib/agent/ai-sdk-runner.ts
  ├─ decide whether the turn needs corpus evidence
  ├─ run a direct-answer path for greetings/chat help
  └─ run the grounded path (at most two retrieval attempts)
         │
         ▼
Retriever: lib/rag/retriever.ts
  ├─ generate a Pinecone query embedding
  ├─ query Pinecone for candidates
  ├─ validate, score, deduplicate, and budget passages
  └─ return grounded | insufficient-evidence | unavailable
         │
         ▼
Runner
  ├─ draft against the accepted evidence
  ├─ validate citation IDs; allow one repair attempt
  ├─ optionally generate 1–3 follow-up suggestions
  └─ emit one terminal outcome
         │
         ▼
AI SDK event adapter → streamed UI message parts
```

### Route

The route owns HTTP concerns only:

- `parseQuestionRequestBody()` reads the body as bytes and rejects a body larger than 256 KiB, including chunked bodies without a trustworthy `Content-Length`.
- The validated request contains 1–20 user/assistant messages, at most 20 parts per message, at most 4,000 characters per text part, and at most 20,000 text characters in total. Non-text AI SDK parts are discarded. The final retained message must be a user message with nonblank text.
- `getModelConfig()` and `getRagConfig()` run before the stream is committed. Consequently, direct greetings also require a valid route-wide RAG deployment configuration.
- The route creates an `AgentTurnRunner`, an AI SDK UI event sink, and a structured trace sink. It passes the request `AbortSignal` to the runner.
- Invalid requests return HTTP 400. Configuration/setup failures return HTTP 500 without exposing private configuration details. Once streaming has begun, quota, cancellation, and internal failures are represented by a terminal `data-outcome` part.

### Runner

The runner owns turn policy and model stages:

1. It emits `run.started` and classifies the latest turn.
2. Greetings, thanks, farewells, and chat-usage requests take the direct path. That path is instructed not to make unsupported Pali factual claims.
3. Pali language, grammar, vocabulary, translation, textual, and Buddhist-concept questions take the retrieval path.
4. The retrieval path makes at most **two attempts**. After an `insufficient-evidence` first attempt, the runner rewrites the query once and retries. An unavailable embedding or vector store ends immediately as `retrieval-unavailable` rather than being presented as weak evidence.
5. A grounded draft may cite only IDs from the accepted passages. Missing or unknown citation IDs trigger at most **one citation-repair attempt**. If the repaired draft is still invalid, the turn fails with `invalid_citations`; citation validation is never weakened.
6. Suggestions are a separate optional model stage after a validated answer. Suggestion failure does not discard the answer, while cancellation still terminates the run.

The implemented terminal outcomes are:

| Outcome | Meaning |
| --- | --- |
| `answered` | A direct answer completed, or a grounded answer completed with validated citations. |
| `insufficient-evidence` | Both permitted retrieval attempts returned no accepted evidence. |
| `retrieval-unavailable` | Query embedding or Pinecone lookup was unavailable. The runner result carries the retrieval error code; the stream also exposes it on the failed retrieval task before the terminal outcome. |
| `failed` | The run was cancelled or failed in the runner, route, or citation validation. The outcome includes a code when available. |

### Retriever

`retrieve({ query, attempt }, signal)` owns Pinecone-specific retrieval and always returns a typed `GroundingBundle`:

- Runtime search text is embedded with `llama-text-embed-v2`, `inputType: "query"`, and `truncate: "END"`.
- Pinecone is queried with `RAG_CANDIDATE_TOP_K` and metadata included, in `PINECONE_NAMESPACE` (the default empty string selects the default namespace).
- Matches without a nonempty vector ID or nonempty `text`, `source`, and `title` metadata are discarded. `section` is optional.
- Candidates below `RAG_MIN_SCORE` are discarded, remaining passages are sorted by score, duplicate vector IDs are removed, and only the first `RAG_ACCEPTED_TOP_K` complete passages that fit `RAG_MAX_CONTEXT_CHARS` are accepted. Passage text is never cut mid-passage to fit the context budget.
- Accepted passage content and metadata are XML-escaped and wrapped in a `<retrieved-passages>` envelope labeled with `PINECONE_CORPUS_REVISION`. Retrieved content is treated as untrusted evidence, not instructions.
- An empty query or zero accepted passages returns `insufficient-evidence`. Embedding and vector-store failures return explicit `unavailable` bundles.

### Cancellation

The request signal is threaded route → runner → model stages → retriever. The runner checks it between stages and forwards it to AI SDK model calls, including a check after retrieval returns and before the next paid stage starts. The retriever checks cancellation immediately before each paid embedding and Pinecone query call. Pinecone SDK v6.1 does not accept an `AbortSignal` for the vector query, so an already in-flight Pinecone inference/query cannot be forcibly interrupted by this code. If cancellation arrives while a successful Pinecone query is in flight, `retrieve()` may still select passages and return them; the runner then observes cancellation at its next boundary check before generation. Once observed, cancellation emits a terminal failed outcome with code `aborted` and no later model stage starts.

## Events and streamed message parts

The framework-neutral runner emits this current event vocabulary:

- `run.started`
- `retrieval.started`, `retrieval.completed`, `retrieval.failed`
- `query.rewritten`
- `generation.started`
- `answer.completed`
- `citations.completed`
- `suggestions.completed`
- `run.completed`, `run.failed`

`createAiSdkEventSink()` validates and projects those events into the public stream:

| Stream part | Current payload/purpose |
| --- | --- |
| `data-status` | Phase: `thinking`, `searching`, or `answering`. |
| `data-task` | Retrieval task ID, status (`running`, `done`, or `error`), and optional query, match count, or message. |
| `data-reasoning` | A bounded summary for a rewrite or completed retrieval; no raw prompt is emitted. |
| text start/delta/end | The completed answer text. |
| `data-citations` | Validated citations with `id`, `source`, `title`, and optional `section`. |
| `data-suggestions` | One to three optional follow-up questions. |
| `data-outcome` | Terminal `answered`, `insufficient-evidence`, `retrieval-unavailable`, or `failed`, plus an optional code. |

Structured traces record lifecycle type, timing, attempt, match count, outcome, and error code as applicable. They do not persist prompt text, passage bodies, questions, answers, or suggestions.

## Configuration

Configuration is parsed by `lib/config/model.ts` and `lib/config/rag.ts`. Empty required values and values outside the documented ranges fail route preflight.

### Model provider

| Variable | Requirement and default |
| --- | --- |
| `PROVIDER_NAME` | Optional only when absent; defaults to `openrouter`. Accepted values: `openrouter`, `opencode`. An empty or unknown value is invalid. |
| `OPENROUTER_API_KEY` | Required and nonempty when `PROVIDER_NAME=openrouter`. |
| `OPENROUTER_LLM_MODEL` | Required and nonempty when `PROVIDER_NAME=openrouter`; there is no built-in model default. |
| `OPENCODE_API_KEY` | Required and nonempty when `PROVIDER_NAME=opencode`. |
| `OPENCODE_LLM_MODEL` | Required and nonempty when `PROVIDER_NAME=opencode`; there is no built-in model default. |

### RAG and retrieval policy

| Variable | Requirement and default |
| --- | --- |
| `PINECONE_API_KEY` | Required, nonempty. |
| `PINECONE_INDEX_NAME` | Required, nonempty. |
| `PINECONE_NAMESPACE` | Optional; defaults to the empty/default namespace. |
| `PINECONE_CORPUS_REVISION` | Required, nonempty immutable revision for the complete deployed index build. |
| `RAG_CANDIDATE_TOP_K` | Integer 1–50; default `20`. |
| `RAG_ACCEPTED_TOP_K` | Integer 1–12; default `8`. |
| `RAG_MIN_SCORE` | Number 0–1; default `0`. |
| `RAG_MAX_CONTEXT_CHARS` | Integer 1,000–50,000; default `12000`. |

## Pinecone ingestion and deployment prerequisite

This repository owns the query-time application path; it does **not** contain or own the production Pinecone ingestion pipeline. `scripts/update-index.mjs` updates the Algolia `docs` index only and never writes Pinecone.

Before production rollout, the external ingestion owner must publish a complete, consistently versioned index build that:

1. stores nonempty `text`, a stable authoritative `source` ID, and a human-readable `title` on every chunk; `section` is optional;
2. stamps every chunk with revision metadata and publishes one immutable `PINECONE_CORPUS_REVISION` for the complete build;
3. supplies the authoritative `source`-ID mapping used by the evaluation manifest;
4. embeds indexed passages with Pinecone `inputType: "passage"` while this runtime continues to embed searches with `inputType: "query"`; and
5. is protected by an authenticated-user or platform abuse budget and a distributed rate limit for `/api/question` before two-attempt retrieval is enabled for unrestricted production traffic.

The current production index sample contains text-only metadata and the available environment has no authoritative corpus revision. Application code can reject citation-unsafe matches and fail configuration preflight, but it cannot repair externally ingested records or invent source IDs.

## Evaluation gate

Run the production-path evaluation with:

```bash
bun run eval:rag
```

The command uses the implemented AI SDK runner and retriever, checks that the manifest revision equals `PINECONE_CORPUS_REVISION`, writes timestamped JSONL records under `results/rag-evaluation` by default, and exits nonzero for gate violations. `RAG_EVAL_RUNNER` defaults to `ai-sdk` (the only supported value), and `RAG_EVAL_OUTPUT_DIR` can override the output directory. Records contain the case ID, runner, corpus revision, model ID, outcomes, reviewed/retrieved/cited source IDs, attempt count, and stage timings. They do not contain a vector ID, raw prompt, rewritten query, passage body, question, answer, suggestion, or citation title/section.

`data/rag-eval-cases.json` is intentionally `incomplete`. The CLI fails closed before configuration parsing or paid/external calls until it has at least 30 reviewed cases with the required cohort mix, authoritative source IDs for grounded cases, a matching corpus revision, and a checked-in outcome baseline.

## Readiness status

The route, AI SDK runner, retriever, event adapter, UI data parts, and fail-closed evaluation machinery are implemented in application code. Real browser smoke, the authoritative 30-case baseline, citation rollout, and unrestricted production rollout remain blocked until compliant re-ingestion publishes the authoritative source-ID mapping and immutable `PINECONE_CORPUS_REVISION`. Those are external rollout prerequisites, not missing application fallback logic; do not weaken citation validation to bypass them.

## Key files

| File | Responsibility |
| --- | --- |
| `app/api/question/route.ts` | HTTP validation, config preflight, stream construction, cancellation handoff. |
| `lib/agent/ai-sdk-runner.ts` | Turn policy, two-attempt retrieval loop, answer stages, citation repair, terminal outcomes. |
| `lib/agent/types.ts` | Framework-neutral runner, result, and event contracts. |
| `lib/agent/ai-sdk-event-sink.ts` | Validated projection from agent events to AI SDK UI message parts. |
| `lib/agent/structured-trace-sink.ts` | Content-free lifecycle and timing traces. |
| `lib/rag/retriever.ts` | Retrieval policy and safe evidence-envelope construction. |
| `lib/services/embedding.ts` | Pinecone query embedding. |
| `lib/services/vector-store.ts` | Pinecone lookup and citation-safe metadata mapping. |
| `lib/config/model.ts` | Provider-specific model configuration. |
| `lib/config/rag.ts` | Pinecone and retrieval-policy configuration. |
| `scripts/evaluate-rag.ts` | Fail-closed production runner/retriever evaluation CLI. |
| `data/rag-eval-cases.json` | Evaluation manifest and current external prerequisite. |
