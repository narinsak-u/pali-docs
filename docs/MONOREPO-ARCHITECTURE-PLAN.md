# Next.js + FastAPI + LangGraph Monorepo Plan

## Decision summary

Split the product into a Next.js frontend/BFF and a Python FastAPI backend, but migrate in stages:

1. Keep the current Next.js RAG path as the baseline and rollback path.
2. Add a Python FastAPI service for the question/RAG workflow.
3. Keep Next.js as the public BFF while the backend contract stabilizes.
4. Run LangGraph behind FastAPI; keep LangChain selective.
5. Move ingestion to a separate Python worker.
6. Compare the new path against the current runner before traffic promotion.

This is an extraction, not a rewrite.

## Target topology

```text
                          ┌─────────────────────────────┐
                          │ Vercel                       │
                          │ Next.js UI + thin BFF        │
                          │ useChat / AI SDK adapter     │
                          └──────────────┬──────────────┘
                                         │ versioned HTTPS/SSE
                                         ▼
                          ┌─────────────────────────────┐
                          │ FastAPI                      │
                          │ auth token validation        │
                          │ request budget/cancellation  │
                          │ event adapter                │
                          └──────────────┬──────────────┘
                                         ▼
                          ┌─────────────────────────────┐
                          │ LangGraph                    │
                          │ classify → retrieve →        │
                          │ evidence → answer → cite     │
                          └──────────────┬──────────────┘
                                         ▼
                          ┌─────────────────────────────┐
                          │ Retrieval policy             │
                          │ ACL + revision + score      │
                          │ provenance + citations      │
                          └──────────────┬──────────────┘
                                         ▼
                                      Pinecone

  Sources → LangChain ingestion worker → staging index → evaluated CorpusRevision
                                           │
                                           ▼
                                    promotion manifest

  PostgreSQL: Threads, Runs, manifests, optional checkpoints
  Redis: distributed limits, short-lived coordination, optional event fan-out
```

## Domain model

The canonical glossary is [`../CONTEXT.md`](../CONTEXT.md).

- `Principal` is the authenticated human or service identity.
- `AccessScope` is server-derived authorization scope; request JSON cannot widen it.
- `Thread` is an owned conversation.
- `Run` is one graph execution for one turn.
- `Checkpoint` is optional resumable graph state, not ordinary chat history.
- `Document` produces searchable `Chunk` records.
- `CorpusRevision` identifies one complete searchable corpus build.
- `Grounding` is the accepted evidence for a run.
- `Citation` can reference only accepted grounding.
- `Outcome` is exactly one terminal result.

## Repository layout

```text
apps/
  web/                         # Next.js UI and thin BFF
    app/
    components/
    hooks/
  api/                         # FastAPI service and LangGraph runner
    app/
      api/
      agent/
      rag/
      auth/
      config/
      telemetry/
  ingest/                      # separate Python ingestion worker
    app/
      sources/
      normalize/
      chunk/
      embed/
      publish/

packages/
  contracts/                   # OpenAPI + JSON Schema + generated clients
  evals/                       # shared cases, manifests, metric definitions

infra/
  deployment/
  postgres/
  redis/
  vector/
```

Keep Bun for `apps/web`. Use `just` as the root command runner; recipes delegate to Bun for the frontend and Python tooling for `apps/api` and `apps/ingest`. Do not force Python into the JavaScript package manager. Share schemas, not runtime implementation code.

## Command runner

The root `justfile` is the only documented command entry point for local development and CI:

```text
just dev-web
just dev-api
just run-ingest
just test
just eval
just check-contracts
just ci
```

Recipes may call `bun`, Python tooling, and container CLIs internally. CI and contributor documentation call `just`, so command names remain stable if an underlying tool changes.

## Ownership boundaries

### `apps/web`

Owns UI rendering, browser interaction, authentication UX, same-origin BFF endpoints, AI SDK stream adaptation, and public error presentation.

It must not own Pinecone queries, graph transitions, provider keys, ACL decisions, or LangChain/LangGraph types.

### `apps/api`

Owns FastAPI request handling, internal-token validation, request budgets, cancellation, model calls, LangGraph execution, typed outcomes, and framework-neutral events.

The API must not accept tenant or ACL scope as trusted client input. It derives `AccessScope` from the validated Principal.

### `apps/ingest`

Owns source loading, normalization, chunking, embedding, metadata validation, staging writes, evaluation, and atomic `CorpusRevision` promotion.

It must not mutate the active revision implicitly and must not run inside an online request.

### Pinecone

Owns vector indexing and nearest-neighbor search. The application owns namespace/metadata filters, score calibration, corpus revision checks, deduplication, context budgets, provenance, and citations.

### PostgreSQL

Owns product authority: Threads, Runs, ingestion manifests, active-revision records, audit metadata, and checkpoints if durability becomes necessary. Pinecone is not the source of truth for conversations or publication state.

## Network contracts

### Browser to Next.js BFF

Keep the existing AI SDK UI-message stream during migration. `useChat` continues calling a same-origin Next.js endpoint.

### Next.js BFF to FastAPI

Use a versioned JSON request and framework-neutral SSE event stream:

```json
{
  "schemaVersion": "v1",
  "runId": "run_123",
  "threadId": "thread_123",
  "messages": [],
  "clientRequestId": "req_123"
}
```

Each event carries:

```json
{
  "schemaVersion": "v1",
  "runId": "run_123",
  "eventId": "evt_123",
  "sequence": 17,
  "eventType": "answer.delta",
  "timestamp": "2026-01-01T00:00:00Z",
  "payload": {}
}
```

Required invariants:

- `runId` correlation is mandatory.
- `sequence` is monotonic per run.
- exactly one terminal event is emitted.
- cancellation has an explicit terminal interpretation.
- backend events never expose raw LangGraph state or private messages.
- citations reference only accepted grounding IDs.

Keep the contract in `packages/contracts`; generate TypeScript types and validate Python models from the same schemas.

## LangGraph shape

```text
START
  → classify_intent
  ├─ direct → generate_direct → suggestions → complete
  └─ corpus_needed
       → retrieve
       → evidence_policy
          ├─ unavailable → complete
          ├─ insufficient and attempts < 2 → rewrite_query → retrieve
          ├─ insufficient and attempts exhausted → complete
          └─ grounded → generate_answer
               → validate_citations
                  ├─ valid → suggestions → complete
                  ├─ invalid and repair unused → repair_answer → validate_citations
                  └─ invalid and repair exhausted → failed
```

Preserve the current hard bounds: two retrieval attempts and one citation repair. Deterministic evidence and citation checks remain mandatory even if a model grader is added.

Implement the graph as a compiled Python graph reused by the service process. Keep LangGraph state private. Add checkpointing only when a concrete durable-workflow requirement exists.

## Ingestion and publication

```text
source
  → load
  → normalize
  → chunk
  → validate source identity/ACLs
  → embed with explicit model/input mode
  → write staging revision
  → run evaluation and integrity checks
  → atomically promote active CorpusRevision
```

Required manifest fields include source IDs, content hashes, source version, ACL metadata, chunking policy, embedding model, embedding input mode, retrieval policy version, and corpus revision. Keep a last-known-good revision for rollback.

## Authentication and isolation

1. Next.js authenticates the browser session.
2. Next.js sends a short-lived signed internal identity token to FastAPI.
3. FastAPI validates the token independently.
4. FastAPI derives Principal and AccessScope from trusted claims.
5. Retrieval applies scope filters before results reach the model.
6. Thread and checkpoint access is authorized by Principal; IDs are not capabilities.

Initial deployment may have one product tenant, but the AccessScope boundary is required now. Cross-scope leakage is a zero-tolerance test failure.

## Rollout phases

### Phase 0 — prerequisites

- Define identity and AccessScope claims.
- Add distributed request limits and spend budgets.
- Fail closed on malformed vector scores and metadata.
- Produce immutable ingestion manifests and active-revision rollback.
- Complete the RAG evaluation corpus and baseline.
- Freeze the event and request schemas.

Gate: unsafe input, unauthorized scope, malformed evidence, and missing baseline are rejected.

### Phase 1 — monorepo and contracts

- Move the current Next.js app to `apps/web` without behavior changes.
- Add `apps/api` health/config scaffolding and `apps/ingest` package boundaries.
- Add `packages/contracts` and generated clients/types.
- Add contract tests for request bounds, event ordering, terminal events, cancellation, and citation projection.

Gate: the existing frontend still passes its current behavior and the new service can validate the contract.

### Phase 2 — backend parity

- Implement the FastAPI question endpoint.
- Port the current runner behavior into LangGraph nodes.
- Port retrieval policy behind a Python application-owned retriever.
- Keep model/provider configuration only in FastAPI.
- Keep Next.js BFF adapter and current TypeScript runner as rollback.

Gate: identical evaluation cases and corpus revision produce equivalent outcomes, citation validity, and failure semantics.

### Phase 3 — ingestion worker

- Port loaders, normalization, chunking, embedding, and publishing to `apps/ingest`.
- Stage and evaluate revisions before promotion.
- Verify metadata, ACL, source identity, and embedding version invariants.

Gate: active revision changes are atomic and reversible.

### Phase 4 — shadow and controlled traffic

- Shadow the FastAPI/LangGraph path against the current runner.
- Compare correctness, grounding, citation precision/completeness, retrieval recall, latency, tokens, cost, cancellations, and failures.
- Promote an internal cohort, then a small percentage.
- Keep the TypeScript runner available through a feature flag during rollback window.

Gate: material quality/reliability benefit or a documented durable-workflow need without violating security, latency, cost, or cancellation budgets.

### Phase 5 — cleanup

- Remove the old runner only after rollback expiry.
- Remove duplicate provider calls and obsolete adapters.
- Keep one owner for each contract and metric.

## Verification requirements

- Contract tests run against both event producers and the Next.js adapter.
- Golden RAG cases compare both runners on the same corpus revision.
- Adversarial cases cover prompt injection, poisoned passages, citation spoofing, ACL leakage, malformed metadata, oversized input, replayed requests, and concurrent thread runs.
- Failure injection covers Pinecone outage, model timeout, malformed stream, client disconnect, cancellation, checkpoint outage, and stale corpus revision.
- Telemetry records run ID, stage, duration, outcome, provider/model version, corpus revision, token/cost estimates, and error code without raw prompts, passages, or secrets.
- Production SLO values are frozen after baseline measurement; cross-scope leakage is always zero.

## Explicit non-goals

- No hard cutover before parity.
- No LangGraph Agent Server requirement in the first implementation.
- No collaborating agents, long-term memory, semantic answer cache, or human approval without a concrete product requirement.
- No unbounded graph loops, retries, token budgets, or checkpoint retention.
- No duplicate TypeScript/Python business logic hidden behind “shared” packages.
- No direct browser access to Pinecone or model providers.

## Source documents

- [`CONTEXT.md`](../CONTEXT.md)
- [`docs/RAG-WORKFLOW.md`](RAG-WORKFLOW.md)
- [`docs/TODO.md`](TODO.md) — graph behavior checklist; this plan supersedes its single-process deployment assumptions.
- [`docs/research/next-fastapi-langgraph-monorepo.md`](research/next-fastapi-langgraph-monorepo.md)
- [`IMPROVEMNETS.md`](../IMPROVEMNETS.md)
