# Issue 63 RAG and vLLM Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the existing FastAPI local-provider boundary so authenticated Principal claims, tool results, provider telemetry, and vLLM readiness/identity are validated and observable without changing the browser stream contract.

**Architecture:** Keep the Next.js BFF as the only browser-facing gateway. The BFF sends the FastAPI service credential plus a separately signed, short-lived Principal token; FastAPI derives a typed AccessScope and ignores caller-supplied scope headers. The graph stores validated application-tool results in typed state, while the model/provider seam records non-sensitive usage telemetry. The pinned vLLM profile owns serving limits, persistent caches, and completion-based readiness.

**Tech Stack:** Next.js/TypeScript, FastAPI/Pydantic, LangGraph/LangChain, Python standard-library HMAC tokens, Vitest, pytest, Docker Compose.

**Spec:** GitHub issue #63 — `https://github.com/narinsak-u/pali-docs/issues/63`

## Global Constraints

- Preserve the Next.js BFF → FastAPI → LangGraph architecture and browser-facing AI SDK stream.
- Keep service authentication separate from tenant authorization claims.
- Ignore unsigned or caller-controlled `X-Access-Scope` authorization input.
- Reject missing, malformed, expired, or mismatched Principal claims before retrieval/model execution.
- Preserve bounded retrieval, cancellation, corpus-revision checks, citation allow-lists, and hosted-provider rollback.
- Do not log raw prompts, passages, answers, secrets, or private reasoning.
- Do not claim production promotion from deterministic tests; real Linux NVIDIA/vLLM smoke evidence remains external.

---

### Task 1: Signed Principal and typed AccessScope boundary

**Files:**
- Create: `apps/api/app/identity.py`
- Modify: `apps/api/app/question.py`
- Modify: `apps/api/app/config.py`
- Modify: `apps/web/lib/config/canary-context.ts`
- Modify: `apps/web/app/api/question/route.ts`
- Modify: `apps/web/scripts/compare-rag.ts`
- Test: `apps/api/tests/test_identity.py`
- Test: `apps/api/tests/test_question.py`
- Test: `apps/web/tests/route.test.ts`
- Test: `apps/web/tests/compare-rag.test.ts`

**Interfaces:**
- `apps/api/app/identity.py` exports `Principal`, `AccessScope`, and `decode_principal_token(token, secret, now=None)`.
- `apps/web/lib/config/canary-context.ts` exports `createPrincipalToken(scope, secret, now?)`.
- FastAPI question handling accepts `X-Principal` only when its HMAC signature, issuer, audience, timestamps, and typed claims validate.

- [ ] Write failing API tests for valid signed claims, expired claims, invalid signatures, missing Principal, and ignored `X-Access-Scope`.
- [ ] Write failing web tests proving the BFF sends `X-Principal` and does not send `X-Access-Scope`.
- [ ] Implement a compact base64url JSON/HMAC-SHA256 token using only Python/TypeScript standard crypto APIs.
- [ ] Derive `AgentTurnInput.access_scope` only from the validated Principal.
- [ ] Require `INTERNAL_PRINCIPAL_SECRET` for configured FastAPI traffic and `FASTAPI_IDENTITY_SECRET` in the comparison runner.
- [ ] Run focused Python and Vitest tests; confirm old scope-header authorization tests fail until updated to signed claims.

### Task 2: Preserve validated tool results in graph state

**Files:**
- Modify: `apps/api/app/agent/types.py`
- Modify: `apps/api/app/agent/graph.py`
- Modify: `apps/api/app/agent/runner.py`
- Test: `apps/api/tests/test_review_blockers.py`
- Test: `apps/api/tests/test_graph.py`

**Interfaces:**
- Add frozen `ToolExecutionResult(call_id, name, result)` to the framework-neutral API types.
- `AgentTurnInput.tool_results` remains internal state with an empty default.
- `tool_node` returns the validated result in `tool_results` and updates the graph input passed to later model stages.

- [ ] Write a failing graph test where a tool handler returns a typed result and classification observes it through `AgentTurnInput.tool_results`.
- [ ] Implement the typed result model and state update without emitting result contents to SSE.
- [ ] Keep unknown tools, malformed arguments, unauthorized calls, and missing dispatchers fail-closed.
- [ ] Run tool and graph tests.

### Task 3: Provider usage telemetry and complete serving identity

**Files:**
- Modify: `apps/api/app/agent/runner.py`
- Modify: `apps/api/app/agent/graph.py`
- Modify: `apps/api/app/agent/types.py`
- Modify: `apps/api/app/main.py`
- Modify: `apps/api/app/observability.py`
- Modify: `apps/web/lib/agent/types.ts`
- Modify: `apps/web/lib/agent/langgraph-event-adapter.ts`
- Modify: `apps/web/scripts/compare-rag.ts`
- Modify: `apps/web/lib/rag/provider-evaluation.ts`
- Test: `apps/api/tests/test_provider_contract.py`
- Test: `apps/api/tests/test_task5_operations.py`
- Test: `apps/web/tests/provider-evaluation.test.ts`
- Test: `apps/web/tests/compare-rag.test.ts`

- [ ] Write failing tests for model usage metadata propagation, complete readiness identity, and missing telemetry represented as absent rather than zero.
- [ ] Capture provider-reported prompt/completion/total tokens and measured generation duration at the model seam; retain queue/TTFT/inter-token fields only when actually observed.
- [ ] Include non-sensitive usage/capacity fields on terminal run events and bounded Prometheus metrics.
- [ ] Return model revision, tokenizer revision, image digest, parser/template, precision, and serving limits from authenticated readiness.
- [ ] Parse and validate the expanded identity in the FastAPI comparison runner.
- [ ] Run focused API/web telemetry and comparison tests.

### Task 4: Pinned vLLM limits, persistent caches, and completion readiness

**Files:**
- Modify: `apps/api/app/vllm_profile.py`
- Modify: `apps/api/scripts/check_vllm.py`
- Modify: `deploy/vllm/docker-compose.yml`
- Modify: `deploy/vllm/README.md`
- Modify: `deploy/vllm/.env.example`
- Test: `apps/api/tests/test_vllm_profile.py`

- [ ] Write failing tests requiring bounded model length, sequence count, batched tokens, GPU memory utilization, output tokens, and persistent model/compile cache mounts.
- [ ] Extend the immutable profile with these limits and exact readiness request settings.
- [ ] Make readiness check health, exact model identity, and a bounded non-thinking `/v1/chat/completions` response.
- [ ] Add dedicated Hugging Face, vLLM, PyTorch, and Triton cache volumes while keeping the endpoint private.
- [ ] Update the deployment runbook with the real Linux NVIDIA smoke command and explicitly mark it external.
- [ ] Run the vLLM tests and compose contract checks.

### Task 5: Contract and documentation updates

**Files:**
- Modify: `packages/contracts/openapi.yaml`
- Modify: `packages/contracts/agent-event.schema.json`
- Modify: `docs/RAG-WORKFLOW.md`
- Modify: `docs/TODO.md`
- Modify: `.env.example`
- Test: `apps/api/tests/test_contracts_check.py` if required by existing conventions

- [ ] Update internal request documentation to describe service-token plus signed-Principal authentication.
- [ ] Document telemetry availability semantics and the external GPU smoke gate.
- [ ] Run the contract checker and documentation-sensitive tests.

### Task 6: Full verification and issue disposition

**Files:**
- No new production files.

- [ ] Run `just test`.
- [ ] Run `just check-contracts`.
- [ ] Run `just build`, recording any pre-existing environment-only indexing failure separately.
- [ ] Run `just compare-rag`, recording fail-closed missing authoritative evaluation artifacts if still unavailable.
- [ ] Review every issue #63 acceptance criterion against observed test/deployment evidence.
- [ ] Close #63 only if the real Linux NVIDIA/vLLM smoke evidence, authenticated deployment evidence, and authoritative evaluation artifacts exist; otherwise comment with completed code work and exact external blockers instead of claiming closure.
