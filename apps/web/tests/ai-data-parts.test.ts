import { describe, it, expect } from "vitest";
import {
  agentTurnOutcomeSchema,
  citationsPartSchema,
  outcomePartSchema,
  questionPartSchema,
  reasoningPartSchema,
  suggestionsPartSchema,
  taskPartSchema,
  taskStatusSchema,
} from "@/lib/schemas/ai-data-parts";

describe("ai-data-parts", () => {
  it("accepts a valid reasoning part", () => {
    expect(reasoningPartSchema.parse({ summary: "พบเอกสาร 3 รายการ" })).toEqual({
      summary: "พบเอกสาร 3 รายการ",
    });
  });

  it("rejects an empty reasoning summary", () => {
    expect(() => reasoningPartSchema.parse({ summary: "" })).toThrow();
  });

  it("accepts a running task part", () => {
    expect(
      taskPartSchema.parse({
        label: "ค้นหาเอกสาร",
        status: "running",
        query: "dhamma",
      }),
    ).toEqual({ label: "ค้นหาเอกสาร", status: "running", query: "dhamma" });
  });

  it("accepts a done task part with matchCount", () => {
    expect(
      taskPartSchema.parse({
        label: "ค้นหาเอกสาร",
        status: "done",
        matchCount: 3,
      }),
    ).toEqual({ label: "ค้นหาเอกสาร", status: "done", matchCount: 3 });
  });

  it("accepts a task part with id", () => {
    expect(
      taskPartSchema.parse({
        id: "tc-1",
        label: "ค้นหาเอกสาร",
        status: "done",
        matchCount: 3,
      }),
    ).toEqual({
      id: "tc-1",
      label: "ค้นหาเอกสาร",
      status: "done",
      matchCount: 3,
    });
  });

  it("accepts an error task part with message", () => {
    expect(
      taskPartSchema.parse({
        label: "ค้นหาเอกสาร",
        status: "error",
        message: "Pinecone timeout",
      }),
    ).toEqual({ label: "ค้นหาเอกสาร", status: "error", message: "Pinecone timeout" });
  });

  it("rejects an unknown task status", () => {
    expect(() => taskStatusSchema.parse("paused")).toThrow();
  });

  it("accepts 1-to-3 suggestions", () => {
    expect(
      suggestionsPartSchema.parse({ suggestions: ["q1"] }),
    ).toEqual({ suggestions: ["q1"] });
    expect(
      suggestionsPartSchema.parse({ suggestions: ["q1", "q2", "q3"] }),
    ).toEqual({ suggestions: ["q1", "q2", "q3"] });
  });

  it("rejects empty or too many suggestions", () => {
    expect(() => suggestionsPartSchema.parse({ suggestions: [] })).toThrow();
    expect(() =>
      suggestionsPartSchema.parse({ suggestions: ["q1", "q2", "q3", "q4"] }),
    ).toThrow();
  });

  it("accepts canonical citations and all runner outcomes", () => {
    expect(
      citationsPartSchema.parse({
        citations: [
          {
            id: "doc-1",
            source: "canon",
            title: "Dhamma",
            section: "1.1",
          },
        ],
      }),
    ).toEqual({
      citations: [
        {
          id: "doc-1",
          source: "canon",
          title: "Dhamma",
          section: "1.1",
        },
      ],
    });

    for (const outcome of [
      "answered",
      "insufficient-evidence",
      "retrieval-unavailable",
      "failed",
    ]) {
      expect(agentTurnOutcomeSchema.parse(outcome)).toBe(outcome);
    }
    expect(
      outcomePartSchema.parse({ outcome: "failed", code: "model_error" }),
    ).toEqual({ outcome: "failed", code: "model_error" });
  });

  it("rejects malformed citations and unknown outcomes", () => {
    expect(() =>
      citationsPartSchema.parse({
        citations: [{ id: "", source: "canon", title: "Dhamma" }],
      }),
    ).toThrow();
    expect(() =>
      outcomePartSchema.parse({ outcome: "partial" }),
    ).toThrow();
  });
});

describe("reduceTaskParts", () => {
  it("dedupes parts with the same id, keeping the latest status", async () => {
    const { reduceTaskParts } = await import("@/lib/chat/reduce-task-parts");
    const parts = [
      { type: "data-task" as const, data: { id: "tc-1", label: "ค้นหาเอกสาร", status: "running" as const, query: "q" } },
      { type: "data-task" as const, data: { id: "tc-1", label: "ค้นหาเอกสาร", status: "done" as const, matchCount: 3 } },
    ];
    const result = reduceTaskParts(parts);
    expect(result).toHaveLength(1);
    expect(result[0].data.status).toBe("done");
    expect(result[0].data.matchCount).toBe(3);
  });

  it("dedupes parts with the same label but no id, keeping the latest", async () => {
    const { reduceTaskParts } = await import("@/lib/chat/reduce-task-parts");
    const parts = [
      { type: "data-task" as const, data: { label: "ค้นหาเอกสาร", status: "running" as const, query: "q1" } },
      { type: "data-task" as const, data: { label: "ค้นหาเอกสาร", status: "error" as const, message: "boom" } },
    ];
    const result = reduceTaskParts(parts);
    expect(result).toHaveLength(1);
    expect(result[0].data.status).toBe("error");
    expect(result[0].data.message).toBe("boom");
  });

  it("keeps separate entries for different ids", async () => {
    const { reduceTaskParts } = await import("@/lib/chat/reduce-task-parts");
    const parts = [
      { type: "data-task" as const, data: { id: "a", label: "A", status: "done" as const } },
      { type: "data-task" as const, data: { id: "b", label: "B", status: "done" as const } },
    ];
    const result = reduceTaskParts(parts);
    expect(result).toHaveLength(2);
  });

  it("keeps separate entries for different labels", async () => {
    const { reduceTaskParts } = await import("@/lib/chat/reduce-task-parts");
    const parts = [
      { type: "data-task" as const, data: { label: "A", status: "done" as const } },
      { type: "data-task" as const, data: { label: "B", status: "done" as const } },
    ];
    const result = reduceTaskParts(parts);
    expect(result).toHaveLength(2);
  });

  it("returns an empty array for empty input", async () => {
    const { reduceTaskParts } = await import("@/lib/chat/reduce-task-parts");
    expect(reduceTaskParts([])).toEqual([]);
  });
});

describe("questionPartSchema", () => {
  it("accepts a valid question part", () => {
    expect(
      questionPartSchema.parse({
        id: "q-1",
        question: "What is dhamma?",
        answer: "Teaching of the Buddha",
        option1: "Wrong 1",
        option2: "Wrong 2",
        option3: "Wrong 3",
      }),
    ).toEqual({
      id: "q-1",
      question: "What is dhamma?",
      answer: "Teaching of the Buddha",
      option1: "Wrong 1",
      option2: "Wrong 2",
      option3: "Wrong 3",
    });
  });

  it("rejects missing required fields", () => {
    expect(() =>
      questionPartSchema.parse({ id: "q-1", question: "x" }),
    ).toThrow();
  });
});
