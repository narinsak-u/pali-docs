#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -f deploy/compose.yml)
trap '"${compose[@]}" down' EXIT

"${compose[@]}" up -d --build --wait
curl --fail --silent --show-error http://127.0.0.1:3000/ >/dev/null
"${compose[@]}" exec -T api python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3)"
"${compose[@]}" exec -T api python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=3)"
