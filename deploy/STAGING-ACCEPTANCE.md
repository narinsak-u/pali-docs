# Private staging acceptance

This is a private pilot, not a production promotion. Keep `deploy/web.env`, `deploy/api.env`, and `deploy/vllm/.env` server-side and out of source control. Configure the same valid, operator-owned pilot tenant/principal and identity secret on both services; preserve hosted provider credentials on the server for the existing pre-stream rollback. Leave Pinecone credentials/index/revision unset until the authoritative corpus and evaluation artifacts are verified. Never put internal tokens, model credentials, API URLs, or identity secrets in public `NEXT_PUBLIC_*` variables.

## Target-host acceptance

Run only on the target x86_64 Linux NVIDIA VM with Docker Compose, NVIDIA Container Toolkit, and a supported GPU (24 GB VRAM is the documented practical floor). First verify the host GPU runtime independently:

```bash
nvidia-smi
docker run --rm --gpus all vllm/vllm-openai:v0.9.0 nvidia-smi
```

Before running the smoke, create the private runtime files from the checked-in examples and replace every placeholder. The vLLM Compose interpolation values are loaded explicitly from `deploy/vllm/.env` by both the smoke script and the manual Compose command:

```bash
cp deploy/web.env.example deploy/web.env
cp deploy/api.env.example deploy/api.env
cp deploy/vllm/.env.example deploy/vllm/.env
```

Keep the same `VLLM_API_KEY` in `deploy/vllm/.env` and `LOCAL_LLM_API_KEY` in `deploy/api.env`; set `HF_TOKEN` in `deploy/vllm/.env` only if required for model download.

Use the repository-pinned Compose model image and model revision; do not substitute tags or model revisions. After creating the three runtime env files and supplying actual secrets, run from the repository root:

```bash
KEEP_DEPLOYMENT=1 ./deploy/compose-smoke.sh
```

The script builds/starts Compose, confirms loopback-only web publication and no API/vLLM host ports, checks health/provider readiness, runs `apps/api/scripts/check_vllm.py` against the real private vLLM endpoint (health, exact served-model ID, non-thinking completion, and serialized strict tool-call checks), rejects an invalid Principal at FastAPI, then sends a no-factual-claim greeting through `POST /api/question`. It requires nonempty answer text and an `answered` terminal outcome with no retrieval task, exercising the BFF → signed pilot identity → FastAPI/LangGraph → local model path without changing the browser stream. It leaves the stack running when `KEEP_DEPLOYMENT=1`; otherwise it removes the Compose stack on exit.

An invalid Principal check must receive HTTP 401 before a runner can be constructed. The API question tests cover missing, malformed, and mismatched signed identity and fixed configured scope. The BFF route tests cover hosted fallback before stream consumption and ensure stream errors after backend SSE begins do not trigger a second model call.

## Deterministic regression checks

Run these separately and record their results; they exercise identity rejection/scope, corpus revision rejection, the existing stream contract, and pre-/post-stream fallback behavior without pretending to be GPU or network deployment evidence:

```bash
cd apps/web && bun run test:run -- tests/route.test.ts
cd ../.. && uv run --project apps/api pytest apps/api/tests/test_question.py apps/api/tests/test_vllm_profile.py
```

The web route suite verifies fallback only before stream consumption and terminal error behavior after stream start. The API suite verifies missing/malformed/mismatched identities are rejected before runner construction, and mismatched corpus revisions are rejected before the runner. The evaluator check above must remain fail-closed while authoritative artifacts are absent.

## Tailnet-only ingress check

With the Compose stack still running, configure the host firewall to permit HTTPS on the Tailscale interface only, and set Serve (never Funnel) to the loopback web origin:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve status

tailscale funnel status
sudo ss -ltnp
```

Serve status must show only the host's private `*.ts.net` endpoint proxying to `127.0.0.1:3000`; Funnel must not expose a service. Confirm the web listener is loopback-only and Compose publishes no API/model port. From an authorized, tailnet-connected device, open the Serve HTTPS name and complete the question smoke above in the browser. From a device outside the tailnet, verify the Serve name cannot be reached. Record the date, host/GPU and driver, Compose image IDs, vLLM model/revision, authorized-device result, external-device result, and command outputs; do not record secrets. Stop ingress with `tailscale serve --https=443 off` and stop the deployment with `docker compose --env-file deploy/vllm/.env -f deploy/compose.yml down`.

## RAG and evaluation gate

The current corpus/evaluation artifacts are incomplete. Keep grounded RAG unavailable; do not create a fake revision, populate guessed source IDs, use a synthetic corpus as production evidence, or report an unsupported answer as grounded. Run the deterministic fail-closed evaluator check:

```bash
bun run eval:rag
```

It must exit nonzero while the checked-in manifest remains incomplete and must stop before model or external retrieval calls. A grounded RAG acceptance run is **not passed** until an authoritative immutable `CorpusRevision`, verified source metadata/mapping, reviewed evaluation cases, and signed ProductionBaseline exist and match. Those artifacts are external prerequisites; do not test grounded quality against fabricated data.

## Evidence record (keep categories separate)

- **Deterministic:** report exact Vitest/Pytest/evaluator command and result; mocked/unit results do not prove deployment behavior.
- **Container:** report Compose build/start/readiness and service/port checks separately from GPU acceptance.
- **Real deployment:** report the Linux NVIDIA readiness/model/tool smoke and actual authorized/outside-tailnet access observations. Do not mark these passed until run on the target host and devices.

No real GPU VM, Tailnet device, authoritative corpus revision, or evaluation baseline is provisioned in this workspace. Therefore real GPU/Tailscale deployment acceptance and grounded RAG acceptance remain external/unproven. Do not claim production promotion, RAG quality parity, or unrestricted traffic readiness.
