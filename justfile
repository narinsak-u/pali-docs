set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default: list

list:
    just --list


install:
    bun install

dev-web:
    if [ -d apps/web ]; then cd apps/web; else cd .; fi; bun run dev

test:
    if [ -d apps/web ]; then cd apps/web; else cd .; fi; bun run test:run
    just test-api
    just test-ingest

test-ingest:
    cd apps/ingest && uv run --group dev pytest -q

test-api:
    cd apps/api && uv run --group dev pytest -q

build:
    if [ -d apps/web ]; then cd apps/web; else cd .; fi; bun run build

eval:
    if [ -d apps/web ]; then cd apps/web; else cd .; fi; bun run eval:rag

dev-api:
    cd apps/api && uv run uvicorn app.main:app --reload

run-ingest:
    cd apps/ingest && uv run python -m app

check-contracts:
    cd apps/api && uv run python -m app.contracts_check

ci:
    just test
    just build
