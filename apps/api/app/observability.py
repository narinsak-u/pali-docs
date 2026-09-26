from __future__ import annotations

from collections import defaultdict
from threading import Lock


class OperationalMetrics:
    """Small dependency-free metrics surface with bounded, non-sensitive labels."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._requests: defaultdict[tuple[str, str], int] = defaultdict(int)
        self._failures: defaultdict[tuple[str, str], int] = defaultdict(int)
        self._readiness: dict[str, int] = {"local": 0, "hosted": 1}

    def observe_request(self, *, provider: str, outcome: str, code: str | None = None) -> None:
        provider_label = "local" if provider == "local" else "hosted"
        outcome_label = outcome if outcome in {"completed", "failed", "cancelled", "timeout"} else "failed"
        with self._lock:
            self._requests[(provider_label, outcome_label)] += 1
            if outcome_label != "completed":
                failure_code = code if code in {"aborted", "timeout", "runner_error", "service_unavailable"} else "unknown"
                self._failures[(provider_label, failure_code)] += 1

    def set_readiness(self, *, provider: str, ready: bool) -> None:
        provider_label = "local" if provider == "local" else "hosted"
        with self._lock:
            self._readiness[provider_label] = int(ready)

    def render(self) -> str:
        with self._lock:
            requests = dict(self._requests)
            failures = dict(self._failures)
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
                "# HELP vllm_ready Whether the selected provider passed its readiness check.",
                "# TYPE vllm_ready gauge",
            ]
        )
        for provider, value in sorted(readiness.items()):
            lines.append(f'vllm_ready{{provider="{provider}"}} {value}')
        return "\n".join(lines) + "\n"


metrics = OperationalMetrics()
