from __future__ import annotations

from collections import defaultdict
from threading import Lock


class OperationalMetrics:
    """Small dependency-free metrics surface with bounded, non-sensitive labels."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._requests: defaultdict[tuple[str, str], int] = defaultdict(int)
        self._failures: defaultdict[tuple[str, str], int] = defaultdict(int)
        self._usage: defaultdict[tuple[str, str], int | float] = defaultdict(int)
        self._readiness: dict[str, int] = {"local": 0, "hosted": 1}

    def observe_usage(
        self,
        *,
        provider: str,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
        total_tokens: int | None = None,
        generation_ms: int | float | None = None,
        queue_ms: int | float | None = None,
        ttft_ms: int | float | None = None,
        inter_token_latency_ms: int | float | None = None,
        kv_cache_usage: int | float | None = None,
        preemptions: int | None = None,
        oom_signals: int | None = None,
        restart_signals: int | None = None,
    ) -> None:
        provider_label = "local" if provider == "local" else "hosted"
        values = {
            "prompt_tokens_total": prompt_tokens,
            "completion_tokens_total": completion_tokens,
            "total_tokens_total": total_tokens,
            "generation_duration_ms_total": generation_ms,
            "queue_duration_ms_total": queue_ms,
            "time_to_first_token_ms_total": ttft_ms,
            "inter_token_latency_ms_total": inter_token_latency_ms,
            "kv_cache_usage_ratio": kv_cache_usage,
            "preemptions_total": preemptions,
            "oom_signals_total": oom_signals,
            "restart_signals_total": restart_signals,
        }
        with self._lock:
            for metric, value in values.items():
                if (
                    isinstance(value, (int, float))
                    and not isinstance(value, bool)
                    and value >= 0
                    and (
                        metric != "kv_cache_usage_ratio"
                        or value <= 1
                    )
                ):
                    if metric == "kv_cache_usage_ratio":
                        self._usage[(provider_label, metric)] = value
                    else:
                        self._usage[(provider_label, metric)] += value
    def observe_request(self, *, provider: str, outcome: str, code: str | None = None) -> None:
        provider_label = "local" if provider == "local" else "hosted"
        outcome_label = outcome if outcome in {"completed", "failed", "cancelled", "timeout"} else "failed"
        with self._lock:
            self._requests[(provider_label, outcome_label)] += 1
            if outcome_label != "completed":
                failure_code = (
                    code
                    if code in {
                        "aborted",
                        "timeout",
                        "runner_error",
                        "service_unavailable",
                        "capacity_exceeded",
                        "rate_limited",
                    }
                    else "unknown"
                )
                self._failures[(provider_label, failure_code)] += 1

    def set_readiness(self, *, provider: str, ready: bool) -> None:
        provider_label = "local" if provider == "local" else "hosted"
        with self._lock:
            self._readiness[provider_label] = int(ready)

    def render(self) -> str:
        with self._lock:
            requests = dict(self._requests)
            failures = dict(self._failures)
            usage = dict(self._usage)
            readiness = dict(self._readiness)
        lines = [
            "# HELP vllm_requests_total Question requests by provider and terminal outcome.",
            "# TYPE vllm_requests_total counter",
        ]
        for (provider, outcome), value in sorted(requests.items()):
            lines.append(f'vllm_requests_total{{provider="{provider}",outcome="{outcome}"}} {value}')
        lines.extend(
            [
                "# HELP vllm_request_failures_total Question failures by provider and safe code.",
                "# TYPE vllm_request_failures_total counter",
            ]
        )
        for (provider, code), value in sorted(failures.items()):
            lines.append(f'vllm_request_failures_total{{provider="{provider}",code="{code}"}} {value}')
        lines.extend(
            [
                "# HELP vllm_model_usage_total Observed model usage by provider.",
                "# TYPE vllm_model_usage_total counter",
            ]
        )
        for (provider, metric), value in sorted(usage.items()):
            lines.append(f'vllm_{metric}{{provider="{provider}"}} {value:g}')
        lines.extend(
            [
                "# HELP vllm_ready Whether the selected provider passed its readiness check.",
                "# TYPE vllm_ready gauge",
            ]
        )
        for provider, value in sorted(readiness.items()):
            lines.append(f'vllm_ready{{provider="{provider}"}} {value}')
        return "\n".join(lines) + "\n"


metrics = OperationalMetrics()
