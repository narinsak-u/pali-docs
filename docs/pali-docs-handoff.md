# Pali Docs Monorepo Handoff

## Continuation focus

Continue the staged migration work in `/home/narin/github-repo/hobbies/pali-docs`, especially the remaining Phase 4 rollout gate and eventual Phase 5 runtime cleanup. Do not remove the TypeScript runner until the documented rollback window expires.

## Repository state

- Branch: `agentic-rag-foundation`
- Worktree was clean after the latest documentation cleanup.
- No push or merge was performed.
- Current architecture and rollout plan: `docs/MONOREPO-ARCHITECTURE-PLAN.md`
- Phase 4 design: `docs/superpowers/specs/2026-09-18-shadow-controlled-traffic-design.md`
- Phase 4 implementation plan: `docs/superpowers/plans/2026-09-18-shadow-controlled-traffic-plan.md`
- Phase 4 execution ledger and review history: `.superpowers/sdd/SHADOW-CONTROLLED-TRAFFIC/progress.md`

## What is implemented

The repository now contains:

- Next.js app relocated to `apps/web`.
- FastAPI/LangGraph service in `apps/api`.
- Contract schemas in `packages/contracts`.
- Revisioned ingestion worker in `apps/ingest`.
- Deterministic rollout policy and BFF fallback.
- Paired TypeScript/FastAPI comparison command: `just compare-rag`.
- Server-side FastAPI timeout, pre-stream AI SDK fallback, and no post-stream retry.
- Private corpus-revision validation for comparison requests.
- Accepted retrieval source IDs propagated through backend events and comparison records.

Relevant implementation commits are visible in `git log`; the latest Phase 4 fixes are `1a78515` and `b770944`, and the latest docs cleanup is `469aba2`.

## Verification evidence

- `just test`: web 21 files / 167 tests, API 20 tests, ingest 5 tests passed.
- `just check-contracts`: passed.
- `just build`: compiled, type-checked, and generated 110 pages; stopped only at the existing post-build Algolia indexing step because credentials are unavailable.
- `just compare-rag`: exits nonzero before runner/network creation because `data/rag-eval-cases.json` is intentionally incomplete.
- The comparison gate still needs an authoritative corpus revision, source-ID mapping, reviewed cases, and baseline. Do not fabricate these values.

## Current data-flow summary

User queries enter Next.js `/api/question`, are validated, assigned a server-owned run ID, and routed to the TypeScript runner by default or to FastAPI/LangGraph under controlled configuration. Pre-stream backend failures fall back to TypeScript; post-stream failures do not retry. Ingestion flows from MDX normalization through chunking, passage embedding, Pinecone staging, integrity evaluation, immutable manifest creation, and atomic active-revision promotion. The full diagrams and contracts are documented in `docs/RAG-WORKFLOW.md` and the architecture plan.

## Safe next actions

1. Obtain the missing authoritative evaluation artifacts outside the repository.
2. Run `just compare-rag` against the frozen corpus revision and review its paired metrics.
3. Perform the controlled traffic rollout and observe the rollback window.
4. Only after that window expires, audit and remove obsolete runtime paths according to Phase 5.

The current Phase 5 documentation cleanup updated `docs/RAG-WORKFLOW.md` and `docs/TODO.md`; runtime deletion is intentionally deferred.

## Suggested skills

- `using-superpowers` — session bootstrap and skill selection.
- `executing-plans` or `subagent-driven-development` — continue the written Phase 4/5 plan with review checkpoints.
- `requesting-code-review` — required before merging additional rollout or cleanup changes.
- `verification-before-completion` — verify tests, build, contracts, and fail-closed rollout behavior before claiming completion.
- `finishing-a-development-branch` — when deciding whether to merge, push, or keep the branch.
- `ponytail-audit` — for the eventual Phase 5 deletion audit; apply no runtime deletions until the rollback gate is satisfied.

## Sensitive-data handling

Environment variable names may be referenced, but do not copy values, tokens, API keys, credentials, or personal data into the next session or this handoff.
