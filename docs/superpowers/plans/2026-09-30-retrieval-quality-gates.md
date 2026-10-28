# Retrieval Quality Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the reachable #42 retrieval-quality hardening without fabricating authoritative corpus or ProductionBaseline artifacts.

**Architecture:** Keep the existing Retriever interface as the single retrieval seam shared by TypeScript and Python. Harden vector-response integrity and hierarchy expansion at each adapter, then prove the existing comparison/evaluation interfaces fail closed before any provider or network call when authoritative artifacts are incomplete.

**Tech Stack:** TypeScript, Vitest, Python 3.11, pytest, Pinecone adapters, deterministic lexical reranker, Zod/Pydantic validation.

**Spec:** GitHub issue #42 — Evaluation-gated hierarchical retrieval and reranking.

## Global Constraints

- Invalid, missing, boolean, non-finite, or otherwise unusable vector scores are never accepted as evidence.
- Retrieval remains bounded by candidate count, accepted count, context characters, parent-context characters, attempts, timeout, cost, and cancellation.
- Hierarchy expansion must preserve AccessScope, CorpusRevision, provenance, and citation allow-lists.
- Reranking is deterministic in this implementation and falls back to dense ordering when disabled, unavailable, timed out, cancelled, or malformed.
- New retrieval-quality behavior remains disabled by default.
- The TypeScript runner and LangGraph fallback remain available; no public browser stream changes.
- Authoritative reviewed cases, source mappings, CorpusRevision, and ProductionBaseline values must not be guessed or committed.
- Tests assert observable grounding/evaluation behavior, not private helper layout or copied configuration.

---

### Task 1: Align malformed-score handling across retrievers

**Files:**
- Modify: `apps/web/lib/services/vector-store.ts`
- Modify: `apps/api/app/rag/retriever.py`
- Test: `apps/web/tests/vector-store.test.ts`
- Test: `apps/api/tests/test_retriever.py`
- Test: `tests/fixtures/retrieval-parity.json` only if the shared fixture needs a malformed-score case

**Interfaces:**
- Consumes: Pinecone query responses at the TypeScript and Python vector-adapter seams.
- Produces: the same explicit unavailable/error behavior whenever any returned match has an unusable score; valid matches are never silently promoted around an integrity violation.

- [ ] **Step 1: Write failing TypeScript and Python tests**

Add one mixed-response case to each adapter: one valid match plus one `NaN`, infinity, boolean, string, or missing score. Assert the adapter rejects the response with the stable malformed-score error instead of returning the valid match or an empty insufficient-evidence result.

```typescript
it("rejects any response containing a malformed score", async () => {
  mockedNamespace.mockReturnValue({
    query: vi.fn().mockResolvedValue({ matches: [validMatch, malformedMatch] }),
  });
  await expect(queryPinecone([0.1], 5)).rejects.toThrow(
    "Pinecone returned malformed scores",
  );
});
```

```python
@pytest.mark.asyncio
async def test_retriever_rejects_mixed_valid_and_malformed_scores() -> None:
    retriever = PineconeRetriever(
        settings=settings(),
        embedder=lambda _query: [0.1],
        query_fn=lambda *_args: {"matches": [match("valid"), match("bad", score=float("nan"))]},
    )
    result = await retriever.retrieve("query", attempt=1)
    assert isinstance(result, UnavailableBundle)
    assert result.error_code == "vector_store_unavailable"
```

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run:

```bash
bunx vitest run apps/web/tests/vector-store.test.ts
apps/api/.venv/bin/pytest -q apps/api/tests/test_retriever.py
```

Expected: the new mixed-score assertions fail because both adapters currently tolerate malformed scores when valid matches remain.

- [ ] **Step 3: Implement the smallest parity fix**

Track malformed score data independently from valid passages. After processing the response, raise the adapter's existing retrieval-integrity error whenever malformed score data was observed, regardless of whether valid passages were also collected. Preserve existing metadata/revision/scope filtering for responses whose scores are all valid.

- [ ] **Step 4: Run focused tests and the shared parity tests**

Run the two focused commands above plus:

```bash
apps/api/.venv/bin/pytest -q apps/api/tests/test_retrieval_parity.py
bunx vitest run apps/web/tests/retriever.test.ts apps/web/tests/vector-store.test.ts
```

Expected: all pass; malformed scores produce unavailable behavior in both adapters, while valid mixed metadata/revision cases retain valid records.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/services/vector-store.ts apps/web/tests/vector-store.test.ts apps/api/app/rag/retriever.py apps/api/tests/test_retriever.py tests/fixtures/retrieval-parity.json
git commit -m "🛡️ fix(rag/integrity): reject malformed vector scores"
```

---

### Task 2: Preserve hierarchy expansion under malformed optional metadata

**Files:**
- Modify: `apps/web/lib/rag/retriever.ts`
- Modify: `apps/api/app/rag/retriever.py`
- Test: `apps/web/tests/retriever.test.ts`
- Test: `apps/api/tests/test_retrieval_parity.py` or `apps/api/tests/test_retriever.py`

**Interfaces:**
- Consumes: validated child passages with optional parent metadata.
- Produces: bounded GroundingBundle context with child citations only, without dropping unrelated children when parent expansion metadata is incomplete.

- [ ] **Step 1: Write failing hierarchy-preservation tests**

Use the existing retriever mocks to return two children sharing source/section/parent identity with `parentText: ""`, plus an unrelated child. With hierarchy expansion enabled, assert both children remain eligible and only non-empty parent metadata expands context. Repeat the raw Pinecone payload case in Python to prove the adapters normalize empty parent text consistently.

```typescript
it("does not collapse siblings when parent context is empty", async () => {
  Object.assign(mockedConfig, { RAG_HIERARCHY_EXPANSION: true });
  mockedQuery.mockResolvedValue([
    passage("child-a", 0.9, {
      source: "part-1/guide",
      sourceVersion: "source-version-1",
      section: "section-1",
      parentId: "parent-1",
      parentText: "",
    }),
    passage("child-b", 0.8, {
      source: "part-1/guide",
      sourceVersion: "source-version-1",
      section: "section-1",
      parentId: "parent-1",
      parentText: "",
    }),
  ]);
  const result = await retrieve({ query: "query", attempt: 1 });
  expect(result.status === "grounded" && result.passages.map(({ id }) => id)).toEqual([
    "child-a",
    "child-b",
  ]);
});
```

- [ ] **Step 2: Run the focused hierarchy tests and verify failure**

Run:

```bash
bunx vitest run apps/web/tests/retriever.test.ts
apps/api/.venv/bin/pytest -q apps/api/tests/test_retrieval_parity.py
```

Expected: the TypeScript sibling-preservation assertion fails because an empty parent text currently participates in the expansion key; Python's normalized payload test should pass before the implementation change.

- [ ] **Step 3: Implement the narrow expansion guard**

Only group and deduplicate passages when the complete parent expansion identity is present: source, source version, section, parent ID, and non-empty parent text. Otherwise retain each child as an independent candidate. Do not change citation IDs, accepted-count limits, scope filtering, or context-budget rules.

- [ ] **Step 4: Run hierarchy, citation, scope, and context-budget tests**

Run:

```bash
bunx vitest run apps/web/tests/retriever.test.ts apps/web/tests/vector-store.test.ts
apps/api/.venv/bin/pytest -q apps/api/tests/test_retriever.py apps/api/tests/test_retrieval_parity.py
```

Expected: child citations remain the only citation IDs, parent context stays bounded, and both adapters retain the same accepted passage ordering for the shared fixture.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/rag/retriever.ts apps/web/tests/retriever.test.ts apps/api/tests/test_retriever.py apps/api/tests/test_retrieval_parity.py
git commit -m "🛡️ fix(rag/hierarchy): preserve incomplete-parent children"
```
---

### Task 3: Prove fail-closed comparison readiness

**Files:**
- Modify: no production file unless the artifact-gate tests expose a missing check.
- Test: `apps/web/tests/compare-rag.test.ts`
- Test: `apps/web/tests/provider-evaluation.test.ts`
- Do not modify: `apps/web/data/rag-eval-cases.json` with fabricated production values.

**Interfaces:**
- Consumes: reviewed-case artifact, ProductionBaseline artifact, configured CorpusRevision, provider runners, and authenticated serving identity.
- Produces: no runner/network call when readiness or artifact lineage is invalid; otherwise an attested comparison and deterministic promotion decision.

- [ ] **Step 1: Add direct artifact-gate behavior tests**

Import the existing `assertReviewedCasesArtifactReady` and `parseProductionBaselineArtifact` seams into the provider-evaluation tests. Assert malformed reviewed cases fail for missing authoritative source mappings and incomplete required cohorts; assert baseline parsing rejects missing attestation, wrong source issue, wrong provider, and unknown fields. Keep the existing passing promotion test as the positive attestation path.

```typescript
it("rejects incomplete reviewed cases before provider execution", () => {
  expect(() =>
    assertReviewedCasesArtifactReady({
      artifactType: "ReviewedEvaluationCases",
      schemaVersion: 1,
      authoritative: true,
      corpusRevision: "corpus-1",
      cases: [evaluationCase],
    }),
  ).toThrow("authoritative reviewed-case artifact is not ready");
});
```

- [ ] **Step 2: Run the focused evaluation tests and verify the expected failure**

Run:

```bash
bunx vitest run apps/web/tests/compare-rag.test.ts apps/web/tests/provider-evaluation.test.ts apps/web/tests/rag-evaluation.test.ts
```

Expected: the new parser/gate assertions fail only if the existing implementation accepts incomplete or non-authoritative artifacts.

- [ ] **Step 3: Implement only missing fail-closed checks**

Reuse the existing `assertComparisonReady`, reviewed-case validation, baseline validation, CorpusRevision comparison, runtime identity checks, attestation checks, and promotion decision. Do not add a parallel evaluator or populate the incomplete manifest. Keep retrieval-quality feature flags disabled by default.

- [ ] **Step 4: Run focused evaluation tests and the expected blocked CLI smoke**

Run:

```bash
bunx vitest run apps/web/tests/compare-rag.test.ts apps/web/tests/provider-evaluation.test.ts apps/web/tests/rag-evaluation.test.ts
bun run compare-rag
```

Expected: tests pass; the CLI exits nonzero before external calls because the checked-in authoritative artifacts are intentionally incomplete.

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/compare-rag.test.ts apps/web/tests/provider-evaluation.test.ts apps/web/tests/rag-evaluation.test.ts apps/web/lib/rag/provider-evaluation.ts
git commit -m "🧪 test(rag/evaluation): enforce authoritative readiness gates"
```

---

### Task 4: Run complete deterministic verification and record blockers

**Files:**
- Modify: no production files unless a verification failure exposes a defect from Tasks 1–3.
- Update: issue #42 comment with exact deterministic results and external blockers.

- [ ] **Step 1: Run complete deterministic suites**

Run from the worktree:

```bash
bun run test:run --cwd apps/web
apps/api/.venv/bin/pytest -q
apps/ingest/.venv/bin/pytest -q
bunx next build --cwd apps/web
```

Expected: all deterministic tests and the production build pass.

- [ ] **Step 2: Run the actual comparison command**

Run `bun run compare-rag` with the repository's current environment. Expected: nonzero exit before provider/network execution because authoritative reviewed cases, source mappings, CorpusRevision, and ProductionBaseline are unavailable. Record that result; do not modify the manifest to force success.

- [ ] **Step 3: Record issue state accurately**

Comment on #42 with the commit(s), deterministic verification output, and the remaining external prerequisites. Leave #42 open unless authoritative corpus and baseline evidence are actually supplied and observed.

- [ ] **Step 4: Commit any verification-only documentation change**

```bash
git status --short
```

If the issue comment is the only change, do not create a repository commit. If a tracked implementation/documentation change was required by a verified failure, commit it with the repository's required message format.

---

## Self-review checklist

- Task 1 covers score integrity parity in both retrievers and tests the mixed valid/malformed case.
- Task 2 covers hierarchy expansion without changing citation or scope semantics.
- Task 3 preserves the existing attested comparison seam and explicitly refuses fabricated artifacts.
- Task 4 proves the deterministic suites while keeping external GPU/corpus evidence separate.
- No task changes the browser stream, replaces the runner, or enables rollout by default.
