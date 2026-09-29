from __future__ import annotations

from app.observability import OperationalMetrics


def test_metrics_render_observed_usage_without_raw_payloads() -> None:
    metrics = OperationalMetrics()
    metrics.observe_usage(
        provider="local",
        prompt_tokens=12,
        completion_tokens=7,
        total_tokens=19,
        generation_ms=125.5,
        queue_ms=4.5,
        ttft_ms=12.25,
        inter_token_latency_ms=3.75,
        kv_cache_usage=0.42,
        preemptions=3,
        oom_signals=1,
        restart_signals=2,
    )

    rendered = metrics.render()

    assert 'vllm_prompt_tokens_total{provider="local"} 12' in rendered
    assert 'vllm_completion_tokens_total{provider="local"} 7' in rendered
    assert 'vllm_total_tokens_total{provider="local"} 19' in rendered
    assert 'vllm_queue_duration_ms_total{provider="local"} 4.5' in rendered
    assert 'vllm_time_to_first_token_ms_total{provider="local"} 12.25' in rendered
    assert 'vllm_inter_token_latency_ms_total{provider="local"} 3.75' in rendered
    assert 'vllm_generation_duration_ms_total{provider="local"} 125.5' in rendered
    assert 'vllm_kv_cache_usage_ratio{provider="local"} 0.42' in rendered
    assert 'vllm_preemptions_total{provider="local"} 3' in rendered
    assert 'vllm_oom_signals_total{provider="local"} 1' in rendered
    assert 'vllm_restart_signals_total{provider="local"} 2' in rendered
    assert "secret prompt" not in rendered
