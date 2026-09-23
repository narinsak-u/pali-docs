# Production RAG Improvements

## Executive verdict

The current implementation is a strong, well-bounded foundation, but it is **not production-ready for unrestricted traffic**. The repository already has important correctness controls: bounded request parsing, configuration preflight, cancellation propagation, corpus-revision checks, untrusted-evidence delimiters, citation allow-list/repair, explicit `insufficient-evidence` versus `retrieval-unavailable` outcomes, and a fail-closed evaluation command. The remaining blockers are chiefly operational and security controls around identity, tenancy, abuse, index integrity, observability, and measured quality.

This roadmap deliberately hardens the existing AI SDK runner and `Retriever` before considering another orchestration framework. Priority labels describe production risk, not implementation size.

## Current strengths to preserve

Do not redo or weaken these controls:

- `app/api/question/route.ts` validates the body before creating the stream, preflights model/RAG configuration, passes `req.signal`, and returns generic setup errors.
- `lib/schemas/question-request.ts` bounds body/history/text and drops client-authored non-text parts.
- `lib/rag/retriever.ts` uses query embeddings, filters by immutable `corpusRevision`, deduplicates IDs, applies score/context budgets, and constructs an escaped evidence envelope.
- The runner limits retrieval attempts and citation repair; retrieval failure is not silently treated as lack of evidence.
- Citations are deterministic: emitted IDs must be in the accepted evidence allow-list, with only one bounded repair attempt.
- `lib/agent/structured-trace-sink.ts` records lifecycle metadata rather than prompts, passage bodies, answers, or suggestions.
- UI citation rendering validates data parts and only creates safe `/docs/...` links.
- The current AI SDK path is the production baseline; LangGraph is only a future comparison, not a prerequisite.

## Prioritized roadmap

| Priority | Current gap | Minimum change | Acceptance evidence | Dependencies | Rollback / kill switch |
|---|---|---|---|---|---|
| **P0** | `/api/question` has no authentication, authorization, or distributed abuse control. | Require authenticated principal before retrieval/generation; add distributed per-principal/IP rate limits and a request budget covering model calls, retrieval attempts, body size, and wall time. Return generic 401/429 responses. | Unauthenticated requests are rejected; two concurrent instances enforce one shared limit; load test shows bounded provider spend and no cross-user access. | Identity provider, shared limiter store, production budget values. | Feature flag endpoint access; emergency global deny or low budget; retain current stream contract. |
| **P0** | One configured Pinecone namespace and no query-level tenant/ACL identity. | Derive namespace from trusted identity, or apply a server-built metadata filter (`tenantId`, document ACL, visibility); never accept scope from the request. Enforce scope on every retrieval and cache key. | Cross-tenant/ACL test corpus proves forbidden passages are never returned, cited, or cached; missing scope fails closed. | Authoritative identity-to-scope mapping and index schema. | Disable multi-tenant traffic; route only to a known isolated namespace. |
| **P0** | `lib/services/vector-store.ts` coerces missing/nonfinite scores to `0`; default `RAG_MIN_SCORE=0` can accept malformed matches. | Treat nonfinite/missing scores as invalid and discard them (or return `unavailable` if index integrity is suspect); set an explicit calibrated minimum score after evaluation. | Fixture with `NaN`, missing, and valid scores proves malformed matches cannot become accepted evidence; baseline records threshold and recall tradeoff. | Representative index and score calibration. | Config kill switch to reject all retrieval or revert threshold only with an incident decision; never restore coercion. |
| **P0** | Ingestion is outside this repository; provenance and index build integrity are not proven. | Require an immutable build manifest: source-ID mapping, chunker/version, embedding model/input mode, ACL metadata, `corpusRevision`, source hash, timestamps, and deletion status. Verify index metadata and sample records before promotion. | Promotion checklist shows manifest-to-index match, authoritative source IDs, `passage` ingestion mode, revision consistency, and reproducible sample inspection. | Ingestion owner, registry/storage, Pinecone inspection access. | Keep previous revision active; reject new revision on mismatch. |
| **P0** | `data/rag-eval-cases.json` is `status: incomplete`; evaluator cannot establish a production baseline. | Complete the reviewed 30+ case manifest with authoritative source IDs and corpus revision; record a frozen baseline and make evaluation a release gate. Include Thai/English, multi-source, paraphrase, insufficient-evidence, and retrieved-prompt-injection cohorts. | `bun run eval:rag` runs against the target revision; quality is at or above baseline; zero unsupported answers, forbidden citations, excess attempts, or citations outside accepted evidence. | Ingestion manifest, reviewers, model/provider budget. | Block rollout and keep old revision/runner when any gate fails. |
| **P1** | Dense-only retrieval and no reranker/hybrid path may miss terminology and lexical matches. | After P0 baseline, retrieve a broader candidate set, then A/B a Pinecone reranker and/or hybrid dense+sparse retrieval. Keep the existing accepted-passage and citation policy. | Held-out set improves source recall/rank or grounded answer quality without violating latency, cost, ACL, or citation gates; otherwise retain dense baseline. | P0 evaluation, Pinecone model/config, latency budget. | Per-request or global feature flag; revert to dense-only. |
| **P1** | Query handling is mostly trim/embed; exact terms, spelling, transliteration, and script variants are not explicitly normalized. | Add bounded normalization (Unicode/script-aware, whitespace, harmless punctuation) and exact-term preservation. Log only privacy-safe query fingerprints/metrics, not raw text. | Thai/Pali terminology and identifier cases show improved recall with no scope/citation regressions; normalization is deterministic and bounded. | Evaluation cohorts and language-owner review. | Disable normalization or per-rule toggle. |
| **P1** | Trace records are content-free but only sent to `console.info`; no durable correlation or privacy-safe backend exists. | Export redacted OpenTelemetry/AI SDK telemetry with `runId`, tenant-safe principal hash, stage durations, provider/model, token/cost estimates, retrieval outcome/count, and error class. Define sampling, retention, access, and redaction. | Dashboard and alert demonstrate end-to-end traces, cancellation/error rates, latency/cost, and no prompt/passage/answer leakage in sampled payloads. | OTel collector/backend, privacy review, retention policy. | Sampling/routing kill switch; fall back to local metrics without content logging. |
| **P1** | Provider and Pinecone calls have cancellation checks but no explicit timeout, retry classification, concurrency limit, or circuit breaker. | Add bounded stage deadlines; retry only classified transient failures with one capped retry; use per-provider/Pinecone concurrency bulkheads and an open circuit on sustained failures. Preserve `unavailable` semantics. | Fault injection proves timeouts terminate within budget, permanent errors are not retried, transient retries are bounded, and overload protects the service. | Runtime timeout primitives, metrics, operational thresholds. | Disable retries/rerank path; open circuit and return `retrieval-unavailable`. |
| **P1** | Existing injection cases are only three insufficient-evidence examples; no adversarial security regression suite. | Add reviewed cases for retrieved instructions, tool/data forgery, citation spoofing, cross-tenant leakage, prompt exfiltration, oversized inputs, and malicious source metadata. Run them in every release evaluation. | All adversarial cases preserve data/instruction separation, refuse secrets, cite only accepted IDs, and never cross ACL boundaries. | P0 tenant model and evaluation owner. | Block release; disable affected workflow or corpus revision. |
| **P1** | Source and answer validation is strong for citation IDs but lacks production incident playbooks and source freshness signals. | Record source/revision provenance in internal events; alert on invalid citations, unsupported answers, malformed metadata, sudden score shifts, and unavailable rates. Define triage, quarantine, rollback, and user-safe messaging. | Simulated bad-index and provider-outage drills produce an alert, owner, rollback to last good revision, and no fabricated answer. | Durable telemetry and ingestion manifest. | Roll back revision, disable traffic, or force insufficient/unavailable response. |
| **P2** | No versioned retrieval/result cache beyond process-local query embedding cache. | Only after ACL/versioning and metrics, add exact retrieval-result caching keyed by normalized query, tenant/ACL scope, corpus revision, embedding/model version, retrieval policy, and expiry. | Duplicate-query rate or latency justifies it; cache hit tests prove no cross-scope or stale-revision result; false-hit rate is zero on held-out checks. | P0 scope/version keys, P1 telemetry. | One configuration flag disables cache and bypasses reads/writes. |
| **P2** | Model, embedding, retrieval policy, and prompt versions are not all first-class release dimensions. | Persist versions in evaluation output and traces; require compatible cache keys and compare changes as controlled releases. | Any quality/cost regression is attributable to a version tuple and can be rolled back independently. | Durable telemetry/evaluation store. | Pin previous tuple. |
| **P2** | A LangGraph comparison could add maintenance without a demonstrated need. | Build a shadow runner only if explicit requirements arise for durable checkpoints, human approval, resume, or measured workflow simplification. Use identical `Retriever`, contracts, and evaluation cases. | Promotion requires material quality/reliability or required durable-workflow benefit while preserving streaming, cancellation, cost, and latency budgets. | P0/P1 baseline and a written product requirement. | Keep AI SDK runner as sole production path. |
| **P2** | No user feedback or online quality signal; no deletion/retention workflow for traces or indexed content. | Add privacy-safe feedback labels and sampled human review; define retention/deletion propagation from source registry through Pinecone, caches, traces, and evaluation artifacts. | Feedback is attributable to revision/model/policy; deletion drill removes content from all configured stores within the stated SLA. | Governance owner, durable stores, legal/privacy policy. | Disable feedback collection or hold deletion-sensitive rollout. |

## Detailed recommendations

### P0 — make the boundary safe before scaling

1. **Authentication, authorization, and abuse budget.** Authenticate at the route boundary and attach a trusted principal to the runner request. Authorize any thread or document scope server-side; client messages must never establish identity. Rate limiting must be distributed, because process-local counters do not protect multiple instances. Budget both requests and expensive work: at most the existing two retrieval attempts, one citation repair, bounded generation time, and a per-principal daily/monthly spend ceiling. A quota failure must remain a typed, generic failure rather than a plausible answer.
2. **Tenant and ACL isolation.** Prefer separate Pinecone namespaces when the tenant boundary is coarse and stable; otherwise use server-generated metadata filters for tenant/document ACL/visibility. Pinecone filters must be applied at candidate retrieval, not after the model sees passages. Every future cache key, trace attribute, and source lookup must include the authorized scope. Missing or ambiguous scope is a deny, not a default namespace.
3. **Fail-closed relevance and index integrity.** A malformed score is not evidence. Discard nonfinite scores and monitor their count; if the rate exceeds a configured integrity threshold, mark retrieval unavailable and page the index owner. Calibrate `RAG_MIN_SCORE` on reviewed cases rather than choosing a threshold by intuition. Preserve the distinction between “valid index, no evidence” and “index/provider unavailable.”
4. **Ingestion provenance/versioning.** The query path cannot prove how external vectors were created. Require a signed or access-controlled manifest mapping source IDs to source versions/hashes, chunk metadata, embedding model and input mode, ACLs, and immutable corpus revision. Promote an index only after automated metadata sampling and source-ID reconciliation. Keep the last known-good revision available for rollback.
5. **Evaluation release gate.** Complete `data/rag-eval-cases.json` only from authoritative source mappings; do not fabricate IDs. Freeze baseline metrics by corpus revision, model, embedding, and policy versions. The gate should include retrieval recall/rank, grounded-answer correctness, citation precision/completeness, insufficient-evidence classification, prompt-injection resistance, attempts, latency, tokens, and cost. A release is not ready if the manifest is incomplete or any safety gate fails.

### P1 — improve quality and operability after the baseline

- **Reranking/hybrid retrieval:** Pinecone recommends reranking and hybrid search for relevance improvements, but adding either before a baseline makes regressions hard to attribute. Compare broad candidate retrieval plus reranking and dense+sparse fusion against the frozen baseline. Keep source IDs, ACL filters, corpus revision, context budget, and citation allow-list unchanged.
- **Normalization and exact terms:** Normalize Unicode and whitespace conservatively, preserve quoted terms, Pali diacritics, source identifiers, and proper nouns, and bound rewrite work. Treat normalization as retrieval policy with its own version. Do not log raw questions merely to debug it.
- **Privacy-safe traces:** The current structured sink is a good content-minimizing seam. Replace console-only delivery with durable telemetry carrying correlation and timing metadata, sampled and access-controlled. AI SDK telemetry can provide generation metadata, but prompt/content capture must remain disabled or explicitly redacted. Separate operational traces from any reviewed quality dataset.
- **Reliability controls:** Set deadlines shorter than the route’s 120-second ceiling for embedding, vector search, each model stage, and the complete turn. Classify errors into cancellation, permanent client/configuration, transient dependency, quota, and overload. Retry only transient failures, once at most unless evidence later justifies another bound. Bulkheads and circuit breakers prevent one failing provider from exhausting all request capacity.
- **Adversarial security and incident response:** Test both client-carried history and retrieved content as untrusted data. Include prompt injection, malicious citations, tool-call-shaped text, exfiltration requests, hidden Unicode, ACL confusion, and poisoned metadata. A detection must produce a safe outcome and an actionable alert; do not “fix” failures by weakening citation validation or showing raw internal errors.

### P2 — optimize only when measurements justify it

- **Versioned exact retrieval cache:** Add this only when duplicate-query rate or retrieval latency is material. Cache accepted retrieval results, not final answers, and include tenant/ACL scope, corpus revision, model/embedding version, and retrieval-policy version. Never allow a cache hit to bypass authorization or citation validation.
- **Version tuple:** Track model, embedding, corpus, prompt, reranker/hybrid, and policy versions together. This makes rollback and quality attribution possible and prevents incompatible vectors/results from being reused.
- **Shadow LangGraph comparison:** LangGraph/LangChain migration is not required for production readiness. A shadow implementation is justified only by a measured quality/reliability gain or a required durable feature such as checkpoints, resume, or human approval. It must consume the same framework-neutral contracts and never leak framework types through the route.
- **Feedback, monitoring, deletion:** Add explicit user feedback and sampled expert review only with a privacy/retention policy. Propagate source deletion and retention expiry to Pinecone, caches, traces, logs, and evaluation artifacts; deletion is incomplete if a prior revision remains queryable through a cache.

## Explicit non-goals

- Do **not** migrate to LangChain or LangGraph merely to claim production readiness.
- Do **not** add semantic answer caching before authentication, ACL/versioned keys, corpus revision, and citation validation are in place.
- Do **not** weaken citation allow-list validation, bounded repair, or the unavailable-versus-insufficient distinction.
- Do **not** claim ingestion/index properties that are not verified in this repository; ingestion is an external dependency.
- Do **not** add unbounded retries, unlimited agent loops, durable conversation memory, or raw prompt/passage logging as a substitute for measurement.

## Suggested execution order and go/no-go gates

1. **Gate A — identity and isolation:** Define the principal-to-scope contract, implement distributed limits, and prove unauthorized requests are rejected. No unrestricted traffic until cross-tenant and missing-scope tests pass.
2. **Gate B — index provenance:** Produce the external build manifest, reconcile source IDs, verify `passage` ingestion mode and immutable revision, and retain a last-known-good revision. Reject promotion on any mismatch.
3. **Gate C — quality baseline:** Complete and review at least 30 cases in the required cohorts. Run the existing evaluator against the production revision and record baseline recall, citation precision/completeness, groundedness, outcomes, latency, cost, and attempts.
4. **Gate D — reliability/security:** Exercise timeout, transient/permanent error, cancellation, overload, prompt-injection, poisoned metadata, and ACL-leak scenarios. Require bounded spend, no unsupported answers, no forbidden citations, and safe terminal outcomes.
5. **Gate E — limited rollout:** Enable a small authenticated cohort with dashboards and alerts. Compare against the baseline; rollback on any safety violation or material regression in quality, latency, cost, or unavailable rate.
6. **Gate F — measured optimization:** Only after stable production metrics, trial reranking/hybrid retrieval, normalization, and then exact retrieval caching as independently kill-switchable changes. Promote each only when its held-out improvement exceeds its measured latency/cost and operational risk.
7. **Gate G — framework decision:** Consider a shadow LangGraph runner only if a written requirement remains unsatisfied. Promote it only on identical-contract evaluation evidence and a demonstrated durable-workflow or quality benefit.

## Sources

### Repository evidence

- [`app/api/question/route.ts`](app/api/question/route.ts) — request validation, configuration preflight, stream setup, cancellation, and console-only trace delivery.
- [`lib/rag/retriever.ts`](lib/rag/retriever.ts) — dense retrieval, score filtering, deduplication, context budget, and evidence envelope.
- [`lib/services/vector-store.ts`](lib/services/vector-store.ts) — Pinecone metadata/revision checks and current invalid-score coercion.
- [`lib/agent/structured-trace-sink.ts`](lib/agent/structured-trace-sink.ts) — content-free lifecycle trace records.
- [`data/rag-eval-cases.json`](data/rag-eval-cases.json) — currently incomplete three-case manifest and missing baseline/revision.
- [`docs/RAG-WORKFLOW.md`](docs/RAG-WORKFLOW.md) — implemented runtime contracts, failure semantics, ingestion prerequisite, and evaluator gate.
- [`docs/superpowers/specs/2026-09-18-agentic-rag-design.md`](docs/superpowers/specs/2026-09-18-agentic-rag-design.md) — staged architecture, security boundaries, caching policy, and LangGraph comparison criteria.
- [`docs/superpowers/plans/2026-09-18-agentic-rag-foundation.md`](docs/superpowers/plans/2026-09-18-agentic-rag-foundation.md) — implementation constraints and intended module responsibilities.

### External primary guidance

- [Pinecone — Implement multitenancy](https://docs.pinecone.io/guides/index-data/implement-multitenancy)
- [Pinecone — Filter by metadata](https://docs.pinecone.io/guides/search/filter-by-metadata)
- [Pinecone — Rerank results](https://docs.pinecone.io/guides/search/rerank-results)
- [Pinecone — Hybrid search](https://docs.pinecone.io/guides/search/hybrid-search)
- [Pinecone — Increase relevance](https://docs.pinecone.io/guides/optimize/increase-relevance)
- [OWASP — RAG Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html)
- [OWASP GenAI — LLM01 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [AI SDK — Telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)
- [AI SDK v5 — `streamText` reference](https://ai-sdk.dev/v5/docs/reference/ai-sdk-core/stream-text)

## Unresolved assumptions and external dependencies

- The authentication provider, principal-to-tenant/ACL mapping, distributed limiter, telemetry backend, and retention controls are not specified in this repository.
- Pinecone namespace/filter schema, ingestion ownership, source-ID authority, index build manifest, source deletion SLA, and actual `passage` embedding configuration must be verified outside the query path.
- Score calibration, reranker/hybrid model choice, latency/cost budgets, and release thresholds require the completed production evaluation set.
- The recommendations assume the current AI SDK runner remains the production path; a framework migration is conditional, not required.
- No claim is made here that the external index, browser smoke path, or production observability currently exists; those are rollout verification tasks.
