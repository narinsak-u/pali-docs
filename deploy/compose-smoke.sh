#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose --env-file deploy/vllm/.env -f deploy/compose.yml)
response=$(mktemp)
trap 'rm -f "$response"; if [[ "${KEEP_DEPLOYMENT:-0}" != 1 ]]; then "${compose[@]}" down; fi' EXIT

"${compose[@]}" up -d --build --wait
"${compose[@]}" port web 3000 | grep -Fxq '127.0.0.1:3000'
api_port=$("${compose[@]}" port api 8000 2>/dev/null || true)
if [[ -n "$api_port" ]]; then
  echo "API must not publish a host port" >&2
  exit 1
fi
vllm_port=$("${compose[@]}" port vllm 8000 2>/dev/null || true)
if [[ -n "$vllm_port" ]]; then
  echo "vLLM must not publish a host port" >&2
  exit 1
fi
api_model_url=$("${compose[@]}" exec -T api printenv LOCAL_LLM_BASE_URL)
if [[ "$api_model_url" != "http://vllm:8000/v1" ]]; then
  echo "API must use the private vLLM service address" >&2
  exit 1
fi
backend=$("${compose[@]}" exec -T web printenv RAG_BACKEND)
if [[ "$backend" != "langgraph" ]]; then
  echo "web must select the LangGraph backend" >&2
  exit 1
fi
curl --fail --silent --show-error http://127.0.0.1:3000/ >/dev/null
"${compose[@]}" exec -T api python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3)"
"${compose[@]}" exec -T api python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=3)"
"${compose[@]}" exec -T api python scripts/check_vllm.py

if ! "${compose[@]}" exec -T api python -c '
import os
import urllib.error
import urllib.request
request = urllib.request.Request(
    "http://127.0.0.1:8000/v1/question",
    data=b"{\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}",
    headers={"Authorization": "Bearer " + os.environ["INTERNAL_API_TOKEN"], "X-Principal": "invalid-principal-token", "Content-Type": "application/json"},
    method="POST",
)
try:
    urllib.request.urlopen(request, timeout=5)
except urllib.error.HTTPError as error:
    if error.code == 401:
        raise SystemExit(0)
raise SystemExit("API accepted an invalid pilot Principal")
'; then
  echo "API did not reject an invalid pilot Principal before answering" >&2
  exit 1
fi

curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  --data '{"messages":[{"id":"staging-smoke","role":"user","parts":[{"type":"text","text":"Hi. Reply with one brief greeting; make no factual claims."}]}]}' \
  http://127.0.0.1:3000/api/question >"$response"
python - "$response" <<'PY'
import json
import sys

parts = []
with open(sys.argv[1], encoding="utf-8") as stream:
    for line in stream:
        if not line.startswith("data: "):
            continue
        data = line.removeprefix("data: ").strip()
        if data != "[DONE]":
            parts.append(json.loads(data))
assert any(part.get("type") == "text-delta" and part.get("delta", "").strip() for part in parts), parts
assert any(part.get("type") == "data-outcome" and part.get("data", {}).get("outcome") == "answered" for part in parts), parts
assert not any(part.get("type") == "data-task" for part in parts), parts
PY
echo "Private deployment smoke passed: exact vLLM readiness, invalid Principal denial, and BFF non-RAG answer."
