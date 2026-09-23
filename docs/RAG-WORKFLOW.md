# Chat RAG Workflow

## Scope

`POST /api/question` is the streaming chat endpoint for the current AI SDK agent foundation. This document describes the implemented route, runner, retriever, event, UI, configuration, cancellation, and evaluation contracts. LangGraph orchestration and response caching are not implemented here.

## Framework responsibilities

The application keeps framework concerns behind stable, framework-neutral boundaries:

| Boundary | Responsibility |
| --- | --- |
| `Retriever` | Owns query embedding, Pinecone search, metadata/revision filtering, ranking, context budgeting, provenance, and citation construction. |
| `@langchain/core` | May provide low-level model, message, and tool primitives or integrations. LangChain does not own the application workflow, and the first comparison does not use `createAgent`. |
| Future `LangGraphAgentTurnRunner` | Owns future orchestration state, nodes, and conditional edges for decide, retrieve, grade, rewrite, generate, validate, repair, suggestions, and the terminal outcome. It implements the same `AgentTurnRunner` contract as the current production AI SDK runner. |
| `AgentEventSink` | Adapts framework-neutral runner events for UI and trace consumers. The route owns HTTP setup, streaming, and cancellation. |

LangGraph is a future comparison runner, not part of the current production path. LangGraph types and messages must not escape the runner; the route and UI receive only the shared `AgentTurnRunner`, `AgentEventSink`, and result contracts. The comparison runner reuses the `Retriever` rather than owning Pinecone directly.

## Runtime boundaries

```text
QuestionClient → useAIChat (DefaultChatTransport)
  │ POST /api/question ({ messages })
  ▼
Route: app/api/question/route.ts
  ├─ read and validate the bounded raw request body
  ├─ preflight model and RAG configuration
  ├─ create the AI SDK stream and composite event sinks
  └─ pass req.signal to AgentTurnRunner
         │
         ▼
Runner: lib/agent/ai-sdk-runner.ts
  ├─ classify the latest turn for corpus retrieval
  ├─ answer chat-only requests directly
  └─ retrieve (at most two attempts), draft, validate citations, and suggest
         │
         ▼
Retriever: lib/rag/retriever.ts
  ├─ embed the query and query Pinecone
  ├─ validate metadata and scores
  ├─ rank, deduplicate, and apply count/context bounds
  └─ return grounded | insufficient-evidence | unavailable
         │
         ▼
AI SDK event sink → streamed UI message parts
  ├─ status/task/reasoning progress
  ├─ answer text, citations, and suggestions
  └─ one terminal outcome
```

## Data flow

```text
Browser text
  → UI messages (`useAIChat` / `QuestionClient`)
  → bounded safe request (`parseQuestionRequestBody`)
  → retrieval decision and query (`AgentTurnRunner`)
  → query embedding → Pinecone vector matches
  → accepted grounding envelope + citation allow-list
  → agent events (`AgentEventSink`)
  → streamed UI parts
  → rendered answer, process details, and citations
```

1. `QuestionClient` sends text through `useAIChat` and `DefaultChatTransport` as the conversation's UI messages. `parseQuestionRequestBody()` reads the raw body, enforces the 256 KiB body limit, retains only text parts, bounds messages/parts/text, and requires the final retained message to be a nonblank user message. Non-text client parts and messages with no retained text are not carried into the safe request.
2. `route.ts` preflights model/RAG configuration, then passes the safe messages and request signal to `createAiSdkAgentTurnRunner().runTurn()`. The runner's structured decision model chooses the direct chat path or produces a bounded retrieval query; direct chat does not query the corpus.
3. For retrieval, `retrieve()` trims the query, `generateQueryEmbedding()` creates a Pinecone `llama-text-embed-v2` query vector, and `queryPinecone()` returns metadata-bearing matches. The vector-store boundary drops records with missing identity/text/source/title/revision or a mismatched corpus revision, and normalizes invalid scores to `0`.
4. The retriever ranks and deduplicates candidates, applies score/count/context bounds without cutting passage text, XML-escapes accepted metadata and text, and returns a grounding envelope plus citations derived from those accepted passages. The runner gives the grounded answer model only that accepted evidence and citation allow-list; invalid or unknown citation IDs are not accepted, with at most one repair attempt.
5. Runner events are projected by `createAiSdkEventSink()` into schema-validated `data-status`, `data-task`, `data-reasoning`, `text-*`, `data-citations`, `data-suggestions`, and terminal `data-outcome` parts. The structured trace sink carries lifecycle metadata only: raw prompts, questions, rewritten query text, passage bodies, answers, and suggestions are intentionally not carried into traces.
6. `useAIChat` derives the visible phase and cancellation controls from streamed parts. `AIMessage` validates parts again, reduces task updates, joins answer text, and renders process details, while `CitationList` renders accepted citation metadata and creates `/docs/...` links only for safe source paths. Invalid citation parts are discarded at this UI boundary; unsafe source paths remain plain text rather than links.

The stream carries status and bounded summaries for progress, not a token-by-token model transcript: `answer.completed` becomes one text delta. Terminal outcomes distinguish answered, insufficient evidence, retrieval unavailable, and failure.


### Route

`app/api/question/route.ts` owns HTTP and stream setup:

- `parseQuestionRequestBody()` reads the request as bytes and rejects bodies larger than 256 KiB, including chunked bodies that exceed the limit without a usable `Content-Length`.
- `parseQuestionRequest()` accepts 1–20 user/assistant messages, at most 20 parts per message, at most 4,000 characters per text part, and at most 20,000 text characters in total. Non-text parts are discarded; messages with no retained text parts are removed. The final retained message must be a user message with nonblank text.
- `getModelConfig()` and `getRagConfig()` run before the UI stream is created. A direct greeting therefore still requires valid route-wide model and RAG configuration.
- The route creates an `AgentTurnRunner`, `createAiSdkEventSink(writer)`, and `createStructuredTraceSink(...)`, combines them with `createCompositeEventSink(...)`, and passes `req.signal` to `runner.runTurn(...)`. The route runtime is Node.js and `maxDuration` is 120 seconds.
- Invalid request bodies return HTTP 400 (`invalid_request`). Setup failures return HTTP 429 for quota errors or HTTP 500 (`internal_error`) without exposing configuration details. Once the stream callback is running, runner/route failures are emitted as terminal `run.failed`/`data-outcome` events; a stream-framework error uses the generic `onError` message.

### Runner

`createAiSdkAgentTurnRunner()` owns model stages and turn policy:

1. Emit `run.started`, then call the structured `retrievalDecisionSchema` model stage. Retrieval is required for Pali language, grammar, vocabulary, translation, text, and Buddhist-concept questions. Only greetings, thanks, farewells, or chat-usage help that makes no Pali factual claim are eligible for the direct path.
2. The direct path calls `draftDirectAnswer` without retrieval or citation IDs, optionally calls `generateSuggestions`, then emits `answer.completed`, `citations.completed` with an empty list, optional `suggestions.completed`, and `run.completed` (`answered`). Direct-answer policy says not to make unsupported Pali factual claims.
3. The grounded path calls `retrieve({ query, attempt }, signal)` at most **two times**. If attempt one returns `insufficient-evidence`, `rewrite(...)` produces one bounded replacement query and attempt two runs. An unavailable embedding or vector store does not trigger a rewrite; it emits retrieval failure and completes as `retrieval-unavailable`.
4. A grounded draft is generated against the accepted evidence envelope. `citationIds` must be nonempty and every ID must be in the accepted citation allow-list. Unknown or missing IDs trigger at most **one** `repairCitations` model call. A still-invalid draft emits `run.failed` with `invalid_citations`; validation is never weakened.
5. Suggestions are an optional separate model stage after a validated answer. A non-abort suggestion error is swallowed and the answer remains successful. An abort is propagated and fails the run.

The implemented terminal outcomes are:

| Outcome | Meaning |
| --- | --- |
| `answered` | Direct answer completed, or grounded answer completed with validated citations. |
| `insufficient-evidence` | The permitted retrieval attempts produced no accepted passages. |
| `retrieval-unavailable` | Query embedding or Pinecone lookup was unavailable. The runner result carries `embedding_unavailable` or `vector_store_unavailable`; the stream reports the code on the failed retrieval task before the terminal outcome. |
| `failed` | Cancellation, invalid citations after repair, quota, model, sink, or other runner failure. `run.failed` carries a code such as `aborted`, `invalid_citations`, `insufficient_quota`, or `runner_error` when available. |

### Retriever

`retrieve({ query, attempt }, signal)` owns query-time retrieval and returns a typed `GroundingBundle`:

- `generateQueryEmbedding()` uses Pinecone inference model `llama-text-embed-v2`, `inputType: "query"`, and `truncate: "END"`. It has a process-local exact-string `LRUCache` keyed by model/input type/query, capped at 100 entries with a one-hour TTL.
- `queryPinecone()` queries `PINECONE_NAMESPACE` (empty by default), requests `RAG_CANDIDATE_TOP_K` matches with metadata, and checks cancellation immediately before the paid query.
- A match is discarded unless its vector ID, `text`, `source`, `title`, and `corpusRevision` metadata are nonempty and its corpus revision exactly equals `PINECONE_CORPUS_REVISION`. `section` is optional. A non-finite or non-number Pinecone score is **coerced to `0`**, not discarded; `RAG_MIN_SCORE` then determines whether it survives selection (so the default threshold `0` accepts it).
- Candidates at or above `RAG_MIN_SCORE` are sorted by descending score with stable input-order ties. Duplicate vector IDs are removed after sorting, so the first (highest-scoring) copy wins. Selection stops at `RAG_ACCEPTED_TOP_K` or at the first passage that would exceed `RAG_MAX_CONTEXT_CHARS`; passage text is never cut and later passages are not considered after that budget break.
- Accepted metadata and text are XML-escaped and wrapped in `<retrieved-passages corpus-revision="...">`. The grounding prompt labels this block as untrusted evidence data, not instructions, and supplies only the accepted vector IDs as the citation allow-list.
- Empty/blank queries or zero accepted passages return `insufficient-evidence`. Embedding and vector-store exceptions return `unavailable` bundles with stable error codes; aborts are rethrown rather than converted to provider-unavailable results.

### Cancellation

The request signal is threaded route → runner → every AI SDK model stage → retriever. The runner checks between stages and after retrieval before starting the next paid stage. The retriever checks immediately before calling the embedding service and before calling Pinecone. Model calls receive `abortSignal`.

The embedding and vector-store functions themselves do not accept a signal that can interrupt an already-started Pinecone operation. In particular, Pinecone SDK v6.1 query options have no `AbortSignal`; an in-flight embedding or query may finish after cancellation. If that happens, the runner checks the signal before generation or the next stage. Once cancellation is observed, the runner emits terminal `run.failed` with code `aborted`; no later model stage starts.

## Events and streamed message parts

The framework-neutral event vocabulary from `lib/agent/types.ts` is:

- `run.started`
- `retrieval.started`, `retrieval.completed`, `retrieval.failed`
- `query.rewritten`
- `generation.started`
- `answer.completed`
- `citations.completed`
- `suggestions.completed`
- `run.completed`, `run.failed`

`createAiSdkEventSink()` validates every public data payload with the schemas in `lib/schemas/ai-data-parts.ts` before writing it:

| Agent event / stream part | Current payload and UI purpose |
| --- | --- |
| `run.started` → `data-status` | `phase: "thinking"`. |
| `retrieval.started` → `data-status` + `data-task` | `phase: "searching"`; task ID is `${runId}:retrieval:${attempt}`, status `running`, label `ค้นหาเอกสาร`, and the generated query. |
| `retrieval.completed` → `data-task` + `data-reasoning` | Task becomes `done` with match count; reasoning is a bounded Thai summary. |
| `retrieval.failed` → `data-task` | Active retrieval task becomes `error`; `message` is the stable error code. |
| `query.rewritten` → `data-reasoning` | Bounded summary `ปรับคำค้นหาเพื่อค้นหาอีกครั้ง`; the rewritten query is not emitted in this reasoning part. |
| `generation.started` → `data-status` | `phase: "answering"`. |
| `answer.completed` → text start/delta/end | One text delta contains the completed answer; it is not token-by-token model streaming. |
| `citations.completed` → `data-citations` | Validated citations with `id`, `source`, `title`, and optional `section`; direct answers send an empty list. |
| `suggestions.completed` → `data-suggestions` | One to three follow-up questions. |
| `run.completed` → `data-outcome` | `answered`, `insufficient-evidence`, or `retrieval-unavailable`; no failure code is attached. |
| `run.failed` → `data-outcome` | `failed` with an optional stable code. |

The event sink rejects writes after a terminal event and requires an active retrieval task for `retrieval.failed`. `createStructuredTraceSink()` records only event type, run ID, timestamp, attempt, match count, outcome, error code, and derived durations. It does not include prompts, questions, rewritten query text, passage bodies, answers, or suggestions in its trace records. The route currently sends those records to `console.info`; the repository does not define durable trace storage.

### UI consumers

`hooks/use-ai-chat.ts` uses `DefaultChatTransport({ api: "/api/question" })`, derives the visible phase from `data-status` and running task parts, and exposes `stop()` from `useChat` to cancel the request. `app/(home)/question/QuestionClient.tsx` renders user messages, `AIMessage`, `ChatStatus`, errors, stop/regenerate/clear controls, and selectable suggestions.

`components/ai/ai-message.tsx` validates incoming reasoning/task/suggestion/citation/outcome parts again, reduces repeated task updates by task ID, renders answer text and citations, and maps terminal outcomes to UI messages. `failed` with code `aborted` intentionally renders no error message. `CitationList` only turns safe source paths into `/docs/...` links; unsafe paths remain plain text.

## Configuration

Configuration is parsed by `lib/config/model.ts` and `lib/config/rag.ts`. Missing required values, empty strings, unknown provider names, and values outside the listed ranges fail preflight.

### Model provider

| Variable | Requirement and default |
| --- | --- |
| `PROVIDER_NAME` | Optional only when absent; defaults to `openrouter`. Accepted values: `openrouter`, `opencode`. Empty or unknown values are invalid. |
| `OPENROUTER_API_KEY` | Required and nonempty when `PROVIDER_NAME=openrouter`. |
| `OPENROUTER_LLM_MODEL` | Required and nonempty when `PROVIDER_NAME=openrouter`; no built-in model default. |
| `OPENCODE_API_KEY` | Required and nonempty when `PROVIDER_NAME=opencode`. |
| `OPENCODE_LLM_MODEL` | Required and nonempty when `PROVIDER_NAME=opencode`; no built-in model default. |

`lib/services/llm-provider.ts` maps OpenRouter to `https://openrouter.ai/api/v1` and OpenCode to `https://opencode.ai/zen/go/v1`, using the selected model ID.

### RAG and retrieval policy

| Variable | Requirement and default |
| --- | --- |
| `PINECONE_API_KEY` | Required, nonempty. |
| `PINECONE_INDEX_NAME` | Required, nonempty. |
| `PINECONE_NAMESPACE` | Optional; defaults to the empty/default namespace. |
| `PINECONE_CORPUS_REVISION` | Required, nonempty revision used to accept matching passage metadata and label grounding context. |
| `RAG_CANDIDATE_TOP_K` | Integer 1–50; default `20`. |
| `RAG_ACCEPTED_TOP_K` | Integer 1–12; default `8`. |
| `RAG_MIN_SCORE` | Number 0–1; default `0`. |
| `RAG_MAX_CONTEXT_CHARS` | Integer 1,000–50,000; default `12000`. |


## Safe rollout and rollback

The route selects the backend per request using these environment controls:

| Control | Operational meaning |
| --- | --- |
| `RAG_BACKEND=ai-sdk` | Explicit safe rollback. Every request uses the known-good AI SDK path, regardless of the traffic percentage. |
| `RAG_BACKEND=langgraph` | Explicit preview mode. Every request attempts the FastAPI/LangGraph backend; use only for controlled preview traffic while the comparison and live gates remain incomplete. |
| `RAG_BACKEND` absent | Uses `RAG_LANGGRAPH_TRAFFIC_PERCENT`. The server creates a request ID and assigns each request deterministically to AI SDK or LangGraph from that ID. |
| `RAG_LANGGRAPH_TRAFFIC_PERCENT` | Integer percentage from `0` through `100` used only when `RAG_BACKEND` is absent. Missing or invalid values fail closed to `0`, so requests use AI SDK. |

LangGraph backend calls require both `FASTAPI_BASE_URL` and `FASTAPI_INTERNAL_TOKEN`. Before any backend SSE bytes are consumed, missing configuration, a request error, a non-success status, or a non-SSE response falls back to AI SDK for that request. After the LangGraph stream has started, stream failures are surfaced as stream errors and are not retried through AI SDK; this prevents duplicate model calls and inconsistent answers. To roll back, set `RAG_BACKEND=ai-sdk` and redeploy or restart the affected service. To preview, set `RAG_BACKEND=langgraph` only in the isolated preview environment, verify the backend credentials, and remove the override before percentage-based rollout.

## Pinecone ingestion and rollout prerequisite

This repository owns the query-time application path, not the production Pinecone ingestion pipeline. To produce citation-safe retrieval, the external ingestion owner must publish a complete index build whose chunks have nonempty `text`, stable authoritative `source`, human-readable `title`, optional `section`, and metadata `corpusRevision` matching one immutable `PINECONE_CORPUS_REVISION`. Indexed passages must use Pinecone `inputType: "passage"` while this runtime uses `inputType: "query"` for searches, and the evaluation owner needs the authoritative source-ID mapping.

The application can reject records with missing or mismatched metadata, but it cannot repair externally ingested records or invent source IDs. The repository does not contain ingestion code, a production-index inspection, or an application check that proves the external index used `inputType: "passage"`; those rollout facts must be verified outside this query path. Any traffic rollout also needs an abuse budget and distributed rate limit appropriate for the two-attempt retrieval policy.

### Paired rollout comparison

Run the paired AI SDK/LangGraph comparison through the root command:

```bash
just compare-rag
```

This command fails closed before runner creation or network calls until `data/rag-eval-cases.json` has an authoritative corpus revision, an outcome-accuracy baseline, and the reviewed evaluation cases required by the readiness gate. The checked-in manifest is intentionally incomplete, so a nonzero result from `just compare-rag` is expected at present. Do not fabricate corpus revisions, baselines, source IDs, or reviewed cases to make the comparison pass.


## Evaluation gate

Run the production-path evaluator with:

```bash
bun run eval:rag
```

`scripts/evaluate-rag.ts` parses `data/rag-eval-cases.json` and fails closed before `getRagConfig()`, model configuration, or paid/external calls when the manifest is incomplete or does not meet readiness checks. A ready manifest requires at least 30 cases and these minimum cohorts: 10 Thai single-source, 5 English single-source, 5 multi-source, 5 paraphrase/terminology, 3 insufficient-evidence, and 2 retrieved-prompt-injection cases. Grounded cases need authoritative expected source IDs; the manifest also supplies a non-null corpus revision and outcome-accuracy baseline.

The evaluator requires the manifest revision to equal `PINECONE_CORPUS_REVISION`, supports only `RAG_EVAL_RUNNER=ai-sdk` (the default), and writes timestamped JSONL to `RAG_EVAL_OUTPUT_DIR` (default `results/rag-evaluation`). It runs the production AI SDK runner and retriever, records expected/retrieved/cited **source IDs**, outcomes, retrieval-attempt count, model ID, corpus revision, and total/retrieval/generation timings. It does not record vector IDs, raw prompts, rewritten queries, passage bodies, questions, answers, suggestions, or citation titles/sections.

`actualOutcome` is `grounded` only when an `answered` result has at least one citation and every cited source is among observed accepted source IDs; an `answered` result without such citations is recorded as `unsupported-answer`. Gate violations include outcome accuracy below baseline, citation precision below 1.0, unsupported answers, more than two retrieval attempts, citations outside accepted evidence, or forbidden citations. Any violation sets a nonzero process exit code. The checked-in `data/rag-eval-cases.json` is currently `status: "incomplete"`, so the evaluation gate is not runnable against a production corpus yet.

## Readiness status

The route, AI SDK runner, retriever, event adapter, UI data-part handling, and fail-closed evaluator are implemented in application code. Production citation rollout and a ready evaluation baseline remain blocked on external ingestion, authoritative source IDs, and a matching immutable corpus revision. The source set does not establish whether a real-browser smoke run has occurred; that is an operational verification question, not a runtime fallback.

## Key files

| File | Responsibility |
| --- | --- |
| `app/api/question/route.ts` | HTTP validation, configuration preflight, stream construction, and cancellation handoff. |
| `lib/schemas/question-request.ts` | Raw-body size and message/text bounds plus final-user validation. |
| `lib/agent/ai-sdk-runner.ts` | Retrieval decision, direct path, two-attempt loop, answer stages, citation repair, suggestions, and outcomes. |
| `lib/agent/types.ts` | Framework-neutral runner, result, and event contracts. |
| `lib/agent/ai-sdk-event-sink.ts` | Validated projection from agent events to AI SDK UI message parts. |
| `lib/agent/structured-trace-sink.ts` | Content-free lifecycle and timing records. |
| `lib/rag/retriever.ts` | Retrieval selection policy and safe evidence-envelope construction. |
| `lib/services/embedding.ts` | Pinecone query embedding and process-local embedding cache. |
| `lib/services/vector-store.ts` | Pinecone lookup, metadata/revision filtering, and score normalization. |
| `lib/config/model.ts` | Provider-specific model configuration. |
| `lib/config/rag.ts` | Pinecone and retrieval-policy configuration. |
| `hooks/use-ai-chat.ts` | AI SDK transport, phase derivation, cancellation, and client error handling. |
| `components/ai/ai-message.tsx` | Stream-part validation and answer/process/citation/outcome rendering. |
| `scripts/evaluate-rag.ts` | Fail-closed production runner/retriever evaluation CLI. |
| `lib/rag/evaluation.ts` | Manifest readiness checks, aggregate metrics, and gate violations. |
| `data/rag-eval-cases.json` | Evaluation manifest; currently incomplete pending external corpus/source data. |
| `components/ai/citation-list.tsx` | Citation rendering and safe `/docs/...` link derivation. |
| `components/ai/chat-status.tsx` | Visible thinking/searching/answering phase indicator. |
