# Pali Docs Domain Context

## Core concepts

- **Principal** — an authenticated human or service identity making a request.
- **AccessScope** — the server-derived tenant, role, document, and visibility permissions that constrain what a Principal may retrieve.
- **Thread** — a Principal-owned conversation containing related user turns.
- **Run** — one execution of the RAG workflow for one Thread turn.
- **Checkpoint** — a persisted snapshot of a Run's resumable state. Checkpoints are optional and require explicit retention, deletion, encryption, and replay rules.
- **Document** — an authoritative source item supplied by an ingestion source.
- **Chunk** — a bounded passage derived from a Document and made searchable.
- **CorpusRevision** — an immutable identifier for one complete, internally consistent searchable corpus build.
- **Grounding** — the accepted evidence selected for one Run, including passages, provenance, and the CorpusRevision.
- **Citation** — a user-visible attribution pointing from an answer to accepted Grounding.
- **Outcome** — the terminal result of a Run: answered, insufficient evidence, retrieval unavailable, or failed.
- **Tenant** — an independently governed product or customer boundary. The initial product may have one tenant while preserving tenant-aware scope.
- **IngestionPublication** — the controlled act of making one validated CorpusRevision active.
- **ProductionBaseline** — the measured quality, latency, cost, and failure behavior of the current system used to evaluate a replacement.

## Additional relationships

- A Principal belongs to one or more Tenants through an authorization relationship.
- An AccessScope is derived from a Principal's authorized Tenant and visibility rules.
- An IngestionPublication activates exactly one validated CorpusRevision.
- A replacement workflow is acceptable only when it meets the ProductionBaseline and its explicit safety gates.

## Relationships

- A Principal may own multiple Threads.
- A Thread contains ordered Runs.
- A Run may reference one authorized AccessScope and one CorpusRevision.
- A Document produces one or more Chunks.
- A Chunk may be included in Grounding only when its metadata and AccessScope are valid for the Run.
- A Citation may reference only accepted Grounding from its Run.
- A Run reaches exactly one terminal Outcome.
