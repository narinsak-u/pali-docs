import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ai", () => ({
  streamText: vi.fn(() => ({
    text: Promise.resolve(
      JSON.stringify({
        questions: [
          { question: "Q1", answer: "A1", option1: "x", option2: "y", option3: "z" },
        ],
      }),
    ),
  })),
  createUIMessageStream: vi.fn((opts) => {
    const writes: Array<Record<string, unknown>> = [];
    const writer = {
      writes,
      write: vi.fn((w: Record<string, unknown>) => writes.push(w)),
      merge: vi.fn(async () => {}),
    };
    return Promise.resolve(opts.execute({ writer })).then(() => ({
      body: { writer },
    }));
  }),
}));

vi.mock("@/data/quiz-content.json", () => ({
  default: {
    "1": {
      title: "Test",
      content: "Mock content for topic 1",
    },
  },
}));

vi.mock("@/lib/services/llm-provider", () => ({
  getConfiguredModel: vi.fn(() => ({
    model: "configured-model",
    providerName: "openrouter",
    modelId: "openrouter/model",
  })),
}));

import { generateQuizStream } from "@/lib/services/quiz-pipeline";
import { streamText } from "ai";
import { getConfiguredModel } from "@/lib/services/llm-provider";

interface WriterMock {
  writes: Array<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateQuizStream (UIMessageStream)", () => {
  it("emits searching → task → answering → question with topicId", async () => {
    const result = (await generateQuizStream({
      topics: ["x"],
      amount: 1,
      topicId: "1",
    })) as unknown as { body: { writer: WriterMock } };

    expect(getConfiguredModel).toHaveBeenCalledOnce();
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ model: "configured-model" }),
    );

    const writes = result.body.writer.writes;
    const types = writes.map((w) => w.type);

    expect(types).toEqual([
      "data-status",
      "data-task",
      "data-task",
      "data-status",
      "data-question",
    ]);

    const status1 = writes[0] as { data: { phase: string } };
    expect(status1.data.phase).toBe("searching");

    const taskRunning = writes[1] as { data: { status: string; label: string } };
    expect(taskRunning.data.label).toBe("ค้นหาเอกสาร");
    expect(taskRunning.data.status).toBe("running");

    const taskDone = writes[2] as { data: { status: string; matchCount: number } };
    expect(taskDone.data.status).toBe("done");
    expect(taskDone.data.matchCount).toBe(1);

    const status2 = writes[3] as { data: { phase: string } };
    expect(status2.data.phase).toBe("answering");

    const question = writes[4] as { data: { question: string } };
    expect(question.data.question).toBe("Q1");
  });

  it("works without topicId (empty context)", async () => {
    const result = (await generateQuizStream({
      topics: ["x"],
      amount: 1,
    })) as unknown as { body: { writer: WriterMock } };

    const writes = result.body.writer.writes;
    const types = writes.map((w) => w.type);

    expect(types).toEqual([
      "data-status",
      "data-task",
      "data-task",
      "data-status",
      "data-question",
    ]);

    const taskDone = writes[2] as { data: { matchCount: number } };
    expect(taskDone.data.matchCount).toBe(0);
  });
});
