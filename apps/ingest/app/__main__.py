from __future__ import annotations

import asyncio
import json
import sys

from .pipeline import run_pipeline


def main() -> int:
    try:
        result = asyncio.run(run_pipeline())
    except Exception as exc:
        message = str(exc).strip().splitlines()[0] if str(exc).strip() else exc.__class__.__name__
        print(f"ingestion failed: {message}", file=sys.stderr)
        return 1
    print(json.dumps(result.to_dict(), ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
