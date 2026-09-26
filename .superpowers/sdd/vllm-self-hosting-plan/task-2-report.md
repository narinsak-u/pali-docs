# Task 2 report: pinned private Qwen3 vLLM pilot

## Implementation

- Added `deploy/vllm/docker-compose.yml`, a one-GPU Linux NVIDIA profile using the immutable `vllm/vllm-openai` v0.8.5 image digest.
- Pinned both model and tokenizer to `Qwen/Qwen3-8B` revision `b968826d9c46dd6066d109eabc6255188de91218` and served the exact model ID `Qwen/Qwen3-8B`.
- Configured the Qwen3 reasoning parser, the pinned tokenizer chat template, and default non-thinking requests (`enable_thinking: false`). Tool parsing and structured-output flags remain out of scope for Task 2.
- Bound vLLM to `127.0.0.1:8000` and required a server-only `VLLM_API_KEY`; the browser receives neither the endpoint nor credential.
- Added `apps/api/app/vllm_profile.py` with immutable profile metadata, strict readiness URL/timeout/key validation, health checking, and fail-closed exact `/v1/models` identity validation.
- Added `apps/api/scripts/check_vllm.py` for deterministic readiness and identity checks without exposing credentials in output.
- Extended the existing local `ChatOpenAI` seam so every local provider request sends `chat_template_kwargs.enable_thinking=false` while preserving the hosted providers unchanged.
- Added `deploy/vllm/README.md` with Linux NVIDIA prerequisites, startup/configuration steps, readiness command, and a basic private non-thinking completion smoke request. Added `deploy/vllm/.env.example` for server-only values.

## Files changed

- `apps/api/app/agent/runner.py`
- `apps/api/tests/test_provider_contract.py`
- `apps/api/app/vllm_profile.py`
- `apps/api/tests/test_vllm_profile.py`
- `apps/api/scripts/check_vllm.py`
- `deploy/vllm/docker-compose.yml`
- `deploy/vllm/.env.example`
- `deploy/vllm/README.md`
- `.superpowers/sdd/vllm-self-hosting-plan/task-2-report.md`

## TDD evidence

### RED

The focused provider behavior test failed before the non-thinking request option was implemented:

```text
$ apps/api/.venv/bin/pytest -q apps/api/tests/test_provider_contract.py::test_local_provider_uses_the_existing_chat_model_seam
FAILED ... assert None == {'chat_template_kwargs': {'enable_thinking': False}}
```

The new profile tests initially failed because the production module did not exist:

```text
$ apps/api/.venv/bin/pytest -q apps/api/tests/test_vllm_profile.py apps/api/tests/test_provider_contract.py
ERROR ... ModuleNotFoundError: No module named 'app.vllm_profile'
```

The readiness test then captured the expected health endpoint incompatibility before the health/status split was implemented:

```text
$ apps/api/.venv/bin/pytest -q apps/api/tests/test_vllm_profile.py::test_readiness_checks_health_then_exact_model_identity
FAILED ... VllmReadinessError: vLLM readiness returned invalid JSON
```

The compose profile test failed before the deployment asset existed:

```text
$ apps/api/.venv/bin/pytest -q apps/api/tests/test_vllm_profile.py::test_compose_profile_keeps_vllm_private_and_matches_pinned_profile
FAILED ... FileNotFoundError: .../deploy/vllm/docker-compose.yml
```

### GREEN

Focused Task 2 and provider tests after implementation:

```text
$ apps/api/.venv/bin/pytest -q apps/api/tests/test_vllm_profile.py apps/api/tests/test_provider_contract.py
........................                                                 [100%]
pytest: 24 passed, 29 warnings in 0.74s
```

The warnings are existing dependency deprecation warnings from LangGraph and pytest-asyncio.

Deployment/configuration smoke checks:

```text
$ VLLM_API_KEY=smoke docker compose -f deploy/vllm/docker-compose.yml config --quiet
# exit 0, no output

$ PYTHONPATH=apps/api apps/api/.venv/bin/python apps/api/scripts/check_vllm.py --help
# printed the readiness CLI usage and exited 0

$ PYTHONPATH=apps/api apps/api/.venv/bin/python apps/api/scripts/check_vllm.py
vLLM not ready: vLLM base URL is required
# exited 1, proving missing readiness configuration fails closed
```

## External GPU limitation

The execution host reports `Darwin 25.6.0 arm64` and has no `nvidia-smi`; there is no Linux NVIDIA GPU or vLLM server available here. I did not claim GPU compatibility or run the Docker model/completion smoke request. The deterministic profile tests, compose rendering, readiness/identity checks, and local provider wiring are the available evidence. The documented `curl` completion and readiness commands must be run on the target Linux NVIDIA host before pilot promotion.

## Concerns and boundaries

- vLLM v0.9.0 and its immutable digest are selected because the official Qwen deployment guidance identifies this release as the first compatible Qwen3 reasoning-parser release for `enable_thinking=False`. The model and tokenizer revisions are pinned to the same Hugging Face commit to prevent chat-template drift.
- The profile intentionally does not enable auto tool choice, tool parsers, structured generation, grounded full-turn routing, observability, or rollback policy; those remain later task boundaries.
- The private compose binding is loopback-only for a same-host API. A split-host deployment needs an equivalent private network/firewall rule and must continue to keep the endpoint out of browser-facing configuration.
- Existing dependency deprecation warnings remain; no formatter, linter, project-wide suite, or GPU smoke was run.

## Review fixes and compatibility evidence

The review identified a path-joining defect and an unsafe CLI model override. Both were corrected test-first:

```text
$ apps/api/.venv/bin/pytest -q apps/api/tests/test_vllm_profile.py::test_readiness_checks_health_then_exact_model_identity
FAILED ... assert 'http://vllm.internal:8000health' == 'http://vllm.internal:8000/health'
```

After changing the `/v1` base URL join to insert `/health`, the focused test passed:

```text
$ apps/api/.venv/bin/pytest -q apps/api/tests/test_vllm_profile.py::test_readiness_checks_health_then_exact_model_identity
.                                                                        [100%]
1 passed, 1 warning
```

The CLI override test initially observed an arbitrary model reaching the network check and returning exit 1. The CLI now rejects any `--model` value other than the immutable `Qwen/Qwen3-8B` profile ID before making a request:

```text
$ apps/api/.venv/bin/pytest -q apps/api/tests/test_vllm_profile.py::test_readiness_cli_rejects_non_pinned_model_override
FAILED ... assert 1 == 2
...
.                                                                        [100%]
1 passed, 1 warning
```

Compatibility was verified against primary documentation rather than guessed:

- The [official Qwen vLLM deployment guide](https://qwen.readthedocs.io/en/latest/deployment/vllm.html) documents `--reasoning-parser qwen3` since vLLM 0.9.0 and explicitly says `enable_thinking=False` is incompatible with the parser in vLLM 0.8.5 but resolved in vLLM 0.9.0.
- The [vLLM 0.9.0 Qwen3 reasoning parser reference](https://docs.vllm.ai/en/v0.9.0/api/vllm/reasoning/qwen3_reasoning_parser.html) is the parser reference for the selected image.
- The image was changed from v0.8.5 to the immutable v0.9.0 manifest digest `sha256:df2c55e5107afea09ea1a50f9dd96c99ebf97a795334c4d08f691f3d79b2ab12`; the profile and compose tests pin the same digest.
- The prerequisites now explicitly require x86_64/amd64 Linux because the pinned CUDA image is not an Apple Silicon image.

Final focused verification after all review fixes:

```text
$ apps/api/.venv/bin/pytest -q apps/api/tests/test_vllm_profile.py apps/api/tests/test_provider_contract.py
.........................                                                [100%]
pytest: 25 passed, 29 warnings in 0.75s

$ VLLM_API_KEY=smoke docker compose -f deploy/vllm/docker-compose.yml config --quiet
# exit 0, no output
```
