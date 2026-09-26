# Task 5 report: hardened private vLLM serving

## Implementation

- Added explicit API liveness (`GET /healthz`) and provider readiness (`GET /readyz`). Liveness is dependency-free. Local readiness performs the existing pinned-model `/health` and `/v1/models` check through `check_vllm_readiness`; failures return a deterministic `503` body without endpoint, model credentials, or upstream error details. Hosted provider selection remains ready without contacting vLLM.
- Added a protected operational metrics endpoint (`GET /metrics`) using the existing Bearer-token authorization helper and server-only `INTERNAL_API_TOKEN`. The dependency-free exposition contains only bounded provider/outcome/code labels and readiness state (`vllm_requests_total`, `vllm_request_failures_total`, and `vllm_ready`). It never records prompts, passages, run IDs, request IDs, credentials, or exception text.
- Preserved the existing FastAPI body limit (`256 KiB`) and Pydantic message limits (`20` messages, `20,000` characters per message/total). Local streaming now applies the already bounded local provider timeout and emits one deterministic terminal `run.failed` event with `code=timeout` when it expires; disconnect cancellation still wins and closes the runner.
- Added request correlation at the API boundary. A validated `X-Request-ID` is echoed in the SSE response header and each event payload; invalid or oversized supplied IDs are replaced with a generated UUID. Run IDs remain in the existing event envelope. User message content is not copied into correlation or metrics data.
- Added provider/outcome operational counters for local vLLM and hosted requests without adding a second provider seam. Existing hosted provider and TypeScript/browser rollback boundaries remain unchanged.

## Files changed

- `apps/api/app/main.py`
- `apps/api/app/question.py`
- `apps/api/app/observability.py`
- `apps/api/tests/test_task5_operations.py`
- `.superpowers/sdd/vllm-self-hosting-plan/task-5-report.md`

## TDD evidence

### RED

The new focused tests were written before the Task 5 implementation. The first run failed for the expected missing behavior:

```text
$ PYTHONPATH=apps/api apps/api/.venv/bin/pytest -q apps/api/tests/test_task5_operations.py
5 failed, 38 warnings
- main app had no readiness/settings seam
- /metrics returned 404 instead of requiring authentication
- question responses had no X-Request-ID correlation
- timeout stream emitted no terminal timeout event
- the initial limit assertion exposed the missing intended boundary
```

The failing assertions were corrected only where the test harness used a malformed direct Starlette request; the production behavior remained test-first.

### GREEN

```text
$ PYTHONPATH=apps/api apps/api/.venv/bin/pytest -q apps/api/tests/test_task5_operations.py
pytest: 5 passed, 38 warnings in 1.52s
```

Regression coverage for the existing question, provider rollback, and graph paths:

```text
$ PYTHONPATH=apps/api apps/api/.venv/bin/pytest -q apps/api/tests/test_question.py apps/api/tests/test_provider_contract.py apps/api/tests/test_graph.py
pytest: 32 passed, 255 warnings in 0.79s
```

No formatter, linter, project-wide suite, or GPU test was run.

## Security boundaries

- `/v1/question` continues to require the server-owned Bearer token. The private vLLM endpoint and `LOCAL_LLM_API_KEY` remain server-side settings; no browser-facing route or configuration was added.
- `/metrics` is separately protected by the same constant-time token comparison helper. Readiness responses intentionally collapse upstream failure details to `not_ready`.
- Metrics labels are allowlisted and bounded. Prompt text, grounded passages, credentials, arbitrary exception strings, and correlation IDs are excluded.
- Existing fail-closed request schema, body, message-count, content, corpus-revision, model, output-token, and local endpoint validation remains in force.

## External limitation

The execution host is Apple Silicon Darwin without a Linux NVIDIA GPU, `nvidia-smi`, or a reachable private vLLM server. The focused evidence is deterministic route, readiness-failure, authorization, bounded-request, timeout, correlation, metrics, local-provider, hosted-rollback, graph, and SSE behavior. A real pinned Qwen3/vLLM readiness and completion smoke test, GPU latency/capacity measurement, and upstream vLLM metrics integration must be exercised on the documented Linux NVIDIA deployment host.

## Unresolved external checks

- Run `apps/api/scripts/check_vllm.py` against the deployed immutable Qwen3 profile on the Linux NVIDIA host.
- Exercise the documented non-thinking completion request and observe the real vLLM health/model identity behavior.
- Confirm production ingress/firewall policy keeps vLLM private and exposes only the authenticated FastAPI/BFF boundary.
- Confirm production scraping uses the authenticated `/metrics` route and does not bypass the API authorization layer.
