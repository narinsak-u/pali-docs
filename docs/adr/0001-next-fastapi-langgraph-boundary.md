# ADR 0001: Separate Next.js UI from FastAPI LangGraph Runtime

- Status: Accepted
- Date: 2026-09-18

## Context

The current repository is a single Bun-managed Next.js application. Its question route, AI SDK stream, agent runner, retrieval policy, and Pinecone integration run in one deployment. The desired product architecture separates the frontend from Python FastAPI and LangChain/LangGraph logic while retaining Vercel AI SDK UI behavior.

The split changes deployment, authentication, streaming, graph state, ingestion, and rollback boundaries. A direct rewrite would remove the current working runner before the new backend has parity evidence.

## Decision

Use a staged monorepo extraction:

- `apps/web` contains the Next.js frontend and a thin public BFF.
- `apps/api` contains FastAPI, model calls, LangGraph orchestration, and framework-neutral event production.
- `apps/ingest` contains the separate LangChain ingestion/publishing worker.
- `packages/contracts` contains versioned OpenAPI/JSON Schema contracts and generated clients/types.
- PostgreSQL owns product metadata and optional graph checkpoints; Pinecone owns vector search.
- The Next.js BFF remains the browser-facing AI SDK adapter during migration.
- FastAPI derives authorization scope from a validated internal identity token.
- LangGraph state and LangChain messages remain private to the backend.
- Checkpointing is deferred until a concrete resume, approval, background-job, or replay requirement exists.
- The current TypeScript runner remains the rollback path until shadow and controlled-rollout gates pass.

## Alternatives considered

### Hard cutover to public FastAPI

Rejected initially. It increases simultaneous risk across authentication, CORS, stream framing, deployment, and client behavior. It can be reconsidered after the internal contract is proven.

### Keep all logic in Next.js

Rejected as the target architecture. It preserves the current deployment coupling and does not provide a Python LangChain/LangGraph runtime boundary.

### Expose raw LangGraph events to the browser

Rejected. LangGraph state and event formats are backend implementation details. A versioned adapter is required for stable UI behavior and to prevent private state leakage.

### Run ingestion inside FastAPI

Rejected. Ingestion is expensive, mutable, and failure-prone; it must not compete with latency-sensitive online requests or publish partially indexed data.

### Use LangGraph checkpoints immediately

Rejected. Checkpoint persistence creates retention, deletion, encryption, authorization, replay, and concurrency obligations that are not yet required by the product.

## Consequences

### Positive

- Python owns the requested LangChain/LangGraph runtime.
- The browser keeps a stable AI SDK experience.
- Ingestion and online serving scale independently.
- The current runner provides a rollback and comparison baseline.
- Contracts can be tested independently of either framework.

### Negative

- There is an internal HTTP/SSE hop during migration.
- The repository temporarily contains two runners.
- CI and deployment manage both Bun and Python toolchains.
- Event and identity contracts require deliberate versioning.

## Follow-up constraints

- Preserve bounded retrieval and citation-repair attempts.
- Apply ACL and corpus-revision filters before model input.
- Never treat `threadId` as an authorization capability.
- Keep raw prompts, passages, and secrets out of ordinary telemetry.
- Remove the old runner after a documented rollback window, not indefinitely.
