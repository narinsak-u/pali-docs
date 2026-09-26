# Task 2 report

## Files

- `apps/ingest/app/types.py` — attach the complete chunking policy to each searchable chunk.
- `apps/ingest/app/chunk.py` — hash the canonical serialized policy (version, maximum characters, overlap) into child identity and preserve deterministic policy metadata during rebuilds.
- `apps/ingest/app/manifest.py` — validate hierarchy, source/version, ACL, position, policy, parent identity, and child identity before creating a revision; include the complete policy in corpus revision identity.
- `apps/ingest/app/publisher.py` — reject incomplete/inconsistent searchable chunks before embedding and stage complete position, embedding, policy, hierarchy, provenance, ACL, and corpus revision metadata.
- `apps/ingest/tests/test_ingestion.py` — focused deterministic identity, revision, metadata, and invalid-record coverage.

## Tests and output

- Initial focused TDD run (before implementation): 3 expected failures covering maximum-character/overlap identity, incomplete manifest hierarchy, and revision policy sensitivity.
- `./.venv/bin/pytest tests/test_ingestion.py -q`
  - `12 passed in 0.04s`
- `./.venv/bin/python -m compileall -q app`
  - exit 0
- Multi-source manifest smoke check:
  - produced a deterministic `rev-…` revision for two documents and two chunks.

## Concerns

- Publication metadata serializes `chunkingPolicy` as canonical JSON because Pinecone metadata does not support nested objects.
- Chunk positions remain deterministic per source document (the existing chunker resets indices per source); manifest and publisher validation enforce that per-source contract.
- ADR-0001 and rollout #48 blocker were not modified.
