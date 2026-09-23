import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCompositeEventSink,
  createStructuredTraceSink,
  type AgentTraceRecord,
} from "@/lib/agent/structured-trace-sink";
import type { AgentEvent, AgentEventSink } from "@/lib/agent/types";

afterEach(() => {
  vi.useRealTimers();
});

describe("createStructuredTraceSink", () => {
  it("records lifecycle metadata and stage timing without text payloads", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const records: AgentTraceRecord[] = [];
    const sink = createStructuredTraceSink((record) => records.push(record));
    const citationWithPassage = {
      id: "doc-1",
      source: "SECRET SOURCE",
      title: "SECRET TITLE",
      text: "SECRET PASSAGE",
    };

    sink.emit({ type: "run.started", runId: "run-1" });
    vi.setSystemTime(1_010);
    sink.emit({
      type: "retrieval.started",
      runId: "run-1",
      attempt: 1,
      query: "SECRET QUERY",
    });
    vi.setSystemTime(1_025);
    sink.emit({
      type: "retrieval.completed",
      runId: "run-1",
      attempt: 1,
      matchCount: 3,
    });
    vi.setSystemTime(1_030);
    sink.emit({ type: "generation.started", runId: "run-1" });
    vi.setSystemTime(1_050);
    sink.emit({
      type: "answer.completed",
      runId: "run-1",
      text: "SECRET ANSWER",
    });
    sink.emit({
      type: "citations.completed",
      runId: "run-1",
      citations: [citationWithPassage],
    });
    sink.emit({
      type: "suggestions.completed",
      runId: "run-1",
      suggestions: ["SECRET SUGGESTION"],
    });
    vi.setSystemTime(1_060);
    sink.emit({ type: "run.completed", runId: "run-1", outcome: "answered" });

    expect(records).toEqual([
      { eventType: "run.started", runId: "run-1", timestamp: 1_000 },
      {
        eventType: "retrieval.started",
        runId: "run-1",
        timestamp: 1_010,
        attempt: 1,
      },
      {
        eventType: "retrieval.completed",
        runId: "run-1",
        timestamp: 1_025,
        attempt: 1,
        matchCount: 3,
        durationMs: 15,
      },
      {
        eventType: "generation.started",
        runId: "run-1",
        timestamp: 1_030,
      },
      {
        eventType: "answer.completed",
        runId: "run-1",
        timestamp: 1_050,
        durationMs: 20,
      },
      {
        eventType: "citations.completed",
        runId: "run-1",
        timestamp: 1_050,
      },
      {
        eventType: "suggestions.completed",
        runId: "run-1",
        timestamp: 1_050,
      },
      {
        eventType: "run.completed",
        runId: "run-1",
        timestamp: 1_060,
        outcome: "answered",
        durationMs: 60,
      },
    ]);

    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("SECRET QUERY");
    expect(serialized).not.toContain("SECRET ANSWER");
    expect(serialized).not.toContain("SECRET PASSAGE");
    expect(serialized).not.toContain("SECRET SUGGESTION");
    expect(serialized).not.toContain("SECRET SOURCE");
    expect(serialized).not.toContain("SECRET TITLE");
  });

  it("records failure codes and rejects records after a terminal event", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    const records: AgentTraceRecord[] = [];
    const sink = createStructuredTraceSink((record) => records.push(record));

    sink.emit({
      type: "retrieval.started",
      runId: "run-2",
      attempt: 2,
      query: "private",
    });
    vi.setSystemTime(2_012);
    sink.emit({
      type: "retrieval.failed",
      runId: "run-2",
      code: "vector_store_unavailable",
    });
    sink.emit({ type: "run.failed", runId: "run-2", code: "retrieval_failed" });

    expect(records).toEqual([
      {
        eventType: "retrieval.started",
        runId: "run-2",
        timestamp: 2_000,
        attempt: 2,
      },
      {
        eventType: "retrieval.failed",
        runId: "run-2",
        timestamp: 2_012,
        attempt: 2,
        code: "vector_store_unavailable",
        durationMs: 12,
      },
      {
        eventType: "run.failed",
        runId: "run-2",
        timestamp: 2_012,
        code: "retrieval_failed",
      },
    ]);
    expect(() =>
      sink.emit({ type: "generation.started", runId: "run-2" }),
    ).toThrow(/terminated/i);
  });
});

describe("createCompositeEventSink", () => {
  it("emits each event once to every sink and enforces one terminal event", () => {
    const first: AgentEvent[] = [];
    const second: AgentEvent[] = [];
    const sinks: AgentEventSink[] = [
      { emit: (event) => first.push(event) },
      { emit: (event) => second.push(event) },
    ];
    const sink = createCompositeEventSink(sinks);
    const terminal: AgentEvent = {
      type: "run.completed",
      runId: "run-composite",
      outcome: "retrieval-unavailable",
    };

    sink.emit({ type: "run.started", runId: "run-composite" });
    sink.emit(terminal);

    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(() => sink.emit(terminal)).toThrow(/terminated/i);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
  });
});
