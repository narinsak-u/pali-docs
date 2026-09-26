# Private Qwen3-8B vLLM pilot

This profile serves the pinned `Qwen/Qwen3-8B` model through vLLM's OpenAI-compatible API. It is a server-side dependency of the FastAPI provider; the browser must continue to call the existing Next.js BFF and must never receive this endpoint or API key.

## Linux NVIDIA prerequisites

The profile is intentionally limited to one Linux NVIDIA host:

- x86_64/amd64 Linux with Docker Engine and the Docker Compose plugin. The pinned vLLM image is not an Apple Silicon image.
- One NVIDIA GPU with a current driver and enough VRAM for the BF16 8B weights plus the configured KV cache. A 24 GB card is the practical pilot floor; the exact capacity depends on context length and concurrency.
- NVIDIA Container Toolkit installed and configured for Docker (`docker run --gpus all ...` must work).
- Outbound access to Hugging Face for the first model download, or a pre-populated Hugging Face cache. Set `HF_TOKEN` only when the serving host needs authenticated access.

This host must not be an Apple Silicon or CPU-only deployment target. The repository host cannot execute the GPU smoke test; use the readiness and completion commands below on the Linux NVIDIA host.

## Pinned profile

`docker-compose.yml` pins all compatibility-sensitive values:

- vLLM image: `vllm/vllm-openai:v0.9.0` by immutable image digest.
- Model and served ID: `Qwen/Qwen3-8B` at Hugging Face revision `b968826d9c46dd6066d109eabc6255188de91218`.
- Tokenizer: the same repository and revision as the model.
- One tensor-parallel GPU (`--tensor-parallel-size 1`).
- Qwen3 reasoning parser (`qwen3`) and Hermes tool-call parser (`hermes`) with vLLM's auto-tool-choice mode.
- The model's pinned chat template; non-thinking requests (`enable_thinking: false`) are sent by the FastAPI local provider through its existing `ChatOpenAI` seam; the compose server does not use an unsupported server-level default flag.
- Structured stages use LangChain function-calling requests with strict schema validation; tool calls are parsed and authorized by the application before execution.
- Pilot tool calls are serialized (`parallel_tool_calls=false`) and support request-level `auto`, `required`, named, and `none` choices.
- Tool parsing and structured output are enabled only for the private local provider; the hosted provider remains unchanged as rollback.

Do not replace these with `latest`, an unpinned Hugging Face branch, a different tokenizer, or a different parser without a new compatibility check.

The compatibility choice follows the [official Qwen vLLM deployment guide](https://qwen.readthedocs.io/en/latest/deployment/vllm.html): it documents `--reasoning-parser qwen3` and `--enable-auto-tool-choice --tool-call-parser hermes` for Qwen3. The pinned Qwen3 chat template is used with request-level `chat_template_kwargs: {"enable_thinking": false}`.

## Start the private server

From the repository root, choose a server-only key and start the profile:

```bash
export VLLM_API_KEY='replace-with-a-server-only-random-secret'
cd deploy/vllm
docker compose up -d
```

The compose profile binds `127.0.0.1:8000` only. If FastAPI runs in a separate private network, use that network's private address and firewall policy; do not expose vLLM to the public interface.

Configure the FastAPI process (not the browser or Next.js public environment) with the Task 1 local provider contract:

```text
PROVIDER_NAME=local
LOCAL_LLM_BASE_URL=http://127.0.0.1:8000/v1
LOCAL_LLM_API_KEY=<the same server-only key>
LOCAL_LLM_MODEL=Qwen/Qwen3-8B
LOCAL_LLM_TIMEOUT_SECONDS=45
LOCAL_LLM_MAX_OUTPUT_TOKENS=768
```

The hosted provider remains the rollback path: keep the existing `PROVIDER_NAME=openrouter` or `PROVIDER_NAME=opencode` configuration in the hosted environment. Do not add local endpoint or credentials to browser-facing Next.js variables.

## Deterministic readiness and identity check

Run this from the repository root after startup:

```bash
LOCAL_LLM_BASE_URL=http://127.0.0.1:8000/v1 \
LOCAL_LLM_API_KEY="$VLLM_API_KEY" \
apps/api/.venv/bin/python apps/api/scripts/check_vllm.py
```

The checker requires a successful `/health` response and exactly one `/v1/models` entry whose ID is `Qwen/Qwen3-8B`. It exits non-zero for an unavailable endpoint, malformed response, multiple models, or any served model ID mismatch. It never treats a healthy server with the wrong model as ready.

## Basic non-thinking completion smoke

This checks the same private OpenAI-compatible endpoint without changing the browser stream contract:

```bash
curl --fail-with-body http://127.0.0.1:8000/v1/chat/completions \
  -H "Authorization: Bearer $VLLM_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "Qwen/Qwen3-8B",
    "messages": [{"role": "user", "content": "Say hello in one short sentence."}],
    "temperature": 0,
    "max_tokens": 64,
    "chat_template_kwargs": {"enable_thinking": false}
  }'
```

A real Linux NVIDIA run of this command is required before claiming GPU compatibility. On this Apple Silicon development host it is intentionally unavailable; the repository tests only prove the pinned profile, private binding, deterministic readiness/identity behavior, and local provider wiring.
