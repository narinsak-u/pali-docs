#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.vllm_profile import QWEN3_VLLM_PROFILE, VllmReadinessError, check_vllm_readiness


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check private vLLM health, pinned model identity, and non-thinking completion."
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("LOCAL_LLM_BASE_URL"),
        help="OpenAI-compatible base URL, for example http://127.0.0.1:8000/v1",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("LOCAL_LLM_API_KEY"),
        help="Server-only vLLM API key (also read from LOCAL_LLM_API_KEY).",
    )
    parser.add_argument(
        "--model",
        default=QWEN3_VLLM_PROFILE.model_id,
        help="Expected served model ID.",
    )
    args = parser.parse_args()
    if args.model != QWEN3_VLLM_PROFILE.model_id:
        print(
            f"vLLM model override must remain {QWEN3_VLLM_PROFILE.model_id}",
            file=sys.stderr,
        )
        return 2
    try:
        model = check_vllm_readiness(
            args.base_url,
            api_key=args.api_key,
            expected_model=QWEN3_VLLM_PROFILE.model_id,
        )
    except VllmReadinessError as error:
        print(f"vLLM not ready: {error}", file=sys.stderr)
        return 1
    print(f"vLLM ready: {model}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
