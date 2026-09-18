import { describe, expect, it } from "vitest";
import { createAiSdkEventSink } from "@/lib/agent/ai-sdk-event-sink";
import type { AgentEvent } from "@/lib/agent/types";

interface WrittenPart {
  type: string;
  data: unknown;
}

function createWriter() {
  const writes: WrittenPart[] = [];
  return {
    writes,
    writer: {
      write(part: WrittenPart) {
        writes.push(part);
      },
    },
  };
}

describe("createAiSdkEventSink", () => {
  it("maps a successful run to validated UI data parts in order", () => {
    const { writer, writes } = createWriter();
    const sink = createAiSdkEventSink(writer);
    const events: AgentEvent[] = [
      { type: "run.started", runId: "run-1" },
      {
        type: "retrieval.started",
        runId: "run-1",
        attempt: 1,
        query: "dhamma",
      },
      {
        type: "retrieval.completed",
        runId: "run-1",
        attempt: 1,
        matchCount: 2,
      },
      { type: "generation.started", runId: "run-1" },
      { type: "answer.completed", runId: "run-1", text: "answer" },
      {
        type: "citations.completed",
        runId: "run-1",
        citations: [
          {
            id: "doc-1",
            source: "canon",
            title: "Dhamma",
            section: "1.1",
          },
        ],
      },
      {
        type: "suggestions.completed",
        runId: "run-1",
        suggestions: ["What next?"],
      },
      { type: "run.completed", runId: "run-1", outcome: "answered" },
    ];

    events.forEach((event) => sink.emit(event));

    expect(writes).toEqual([
      { type: "data-status", data: { phase: "thinking" } },
      { type: "data-status", data: { phase: "searching" } },
      {
        type: "data-task",
        data: {
          id: "run-1:retrieval:1",
          label: "ค้นหาเอกสาร",
          status: "running",
          query: "dhamma",
        },
      },
      {
        type: "data-task",
        data: {
          id: "run-1:retrieval:1",
          label: "ค้นหาเอกสาร",
          status: "done",
          matchCount: 2,
        },
      },
      {
        type: "data-reasoning",
        data: { summary: "พบเอกสารที่เกี่ยวข้อง 2 รายการ" },
      },
      { type: "data-status", data: { phase: "answering" } },
      {
        type: "data-citations",
        data: {
          citations: [
            {
              id: "doc-1",
              source: "canon",
              title: "Dhamma",
              section: "1.1",
            },
          ],
        },
      },
      {
        type: "data-suggestions",
        data: { suggestions: ["What next?"] },
      },
      { type: "data-outcome", data: { outcome: "answered" } },
    ]);
  });

  it("uses the retrieval attempt ID for rewritten-query retries and failures", () => {
    const { writer, writes } = createWriter();
    const sink = createAiSdkEventSink(writer);

    sink.emit({
      type: "query.rewritten",
      runId: "run-retry",
      attempt: 2,
      query: "ariya sacca",
    });
    sink.emit({
      type: "retrieval.started",
      runId: "run-retry",
      attempt: 2,
      query: "ariya sacca",
    });
    sink.emit({
      type: "retrieval.failed",
      runId: "run-retry",
      code: "vector_store_unavailable",
    });

    expect(writes).toEqual([
      {
        type: "data-reasoning",
        data: { summary: "ปรับคำค้นหาเพื่อค้นหาอีกครั้ง" },
      },
      { type: "data-status", data: { phase: "searching" } },
      {
        type: "data-task",
        data: {
          id: "run-retry:retrieval:2",
          label: "ค้นหาเอกสาร",
          status: "running",
          query: "ariya sacca",
        },
      },
      {
        type: "data-task",
        data: {
          id: "run-retry:retrieval:2",
          label: "ค้นหาเอกสาร",
          status: "error",
          message: "vector_store_unavailable",
        },
      },
    ]);
  });

  it("maps a failed run to one terminal outcome part", () => {
    const { writer, writes } = createWriter();
    const sink = createAiSdkEventSink(writer);

    sink.emit({ type: "run.started", runId: "run-failed" });
    sink.emit({ type: "run.failed", runId: "run-failed", code: "model_error" });

    expect(writes.at(-1)).toEqual({
      type: "data-outcome",
      data: { outcome: "failed", code: "model_error" },
    });
    expect(writes.filter((part) => part.type === "data-outcome")).toHaveLength(1);
  });

  it("rejects duplicate terminal events and events after termination", () => {
    const { writer, writes } = createWriter();
    const sink = createAiSdkEventSink(writer);

    sink.emit({
      type: "run.completed",
      runId: "run-terminal",
      outcome: "insufficient-evidence",
    });

    expect(() =>
      sink.emit({
        type: "run.completed",
        runId: "run-terminal",
        outcome: "answered",
      }),
    ).toThrow(/terminated/i);
    expect(() =>
      sink.emit({ type: "generation.started", runId: "run-terminal" }),
    ).toThrow(/terminated/i);
    expect(writes).toEqual([
      {
        type: "data-outcome",
        data: { outcome: "insufficient-evidence" },
      },
    ]);
  });

  it("rejects invalid outgoing payloads before writing", () => {
    const { writer, writes } = createWriter();
    const sink = createAiSdkEventSink(writer);

    expect(() =>
      sink.emit({
        type: "suggestions.completed",
        runId: "run-invalid",
        suggestions: [""],
      }),
    ).toThrow();
    expect(writes).toEqual([]);
  });
});
