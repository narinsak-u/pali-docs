#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -f deploy/compose.yml)
trap '"${compose[@]}" down' EXIT

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
