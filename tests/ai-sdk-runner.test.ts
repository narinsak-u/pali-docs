import { describe, expect, it, vi } from "vitest";
import {
  createAiSdkAgentTurnRunner,
  type AiSdkAgentTurnRunnerDependencies,
  type AnswerDraft,
  type DirectAnswerDraft,
  type RetrievalDecision,
} from "@/lib/agent/ai-sdk-runner";
import type {
  AgentEvent,
  AgentEventSink,
  AgentTurnInput,
} from "@/lib/agent/types";
import type {
  GroundedBundle,
  GroundingBundle,
  RetrievalRequest,
} from "@/lib/rag/types";

const input: AgentTurnInput = {
  runId: "run-1",
  messages: [
    {
      id: "question-1",
      role: "user",
      parts: [{ type: "text", text: "ธรรมะหมายถึงอะไร" }],
    },
  ],
};

const groundedBundle: GroundedBundle = {
  status: "grounded",
  query: "dhamma",
  corpusRevision: "corpus-2026-09-18",
  passages: [
    {
      id: "p1",
      source: "part-1/chapter-1",
      title: "บทที่ 1",
      section: "1.1",
      text: "Dhamma is the teaching.",
      score: 0.92,
    },
  ],
  citations: [
    {
      id: "p1",
      source: "part-1/chapter-1",
      title: "บทที่ 1",
      section: "1.1",
    },
  ],
  context:
    '<retrieved-passages corpus-revision="corpus-2026-09-18">\n<passage id="p1" source="part-1/chapter-1" title="บทที่ 1" section="1.1">\nDhamma is the teaching.\n</passage>\n</retrieved-passages>',
};

function insufficientBundle(query: string): GroundingBundle {
  return {
    status: "insufficient-evidence",
    query,
    corpusRevision: "corpus-2026-09-18",
    passages: [],
    citations: [],
  };
}

function captureEvents(): { events: AgentEvent[]; sink: AgentEventSink } {
  const events: AgentEvent[] = [];
  return {
    events,
    sink: {
      emit(event) {
        events.push(event);
      },
    },
  };
}

function createDependencies(
  overrides: Partial<AiSdkAgentTurnRunnerDependencies> = {},
): Required<AiSdkAgentTurnRunnerDependencies> {
  const decide = vi.fn(
    async (): Promise<RetrievalDecision> => ({
      needsRetrieval: true,
      query: "dhamma",
    }),
  );
  const retrieve = vi.fn(
    async (_request: RetrievalRequest): Promise<GroundingBundle> =>
      groundedBundle,
  );
  const rewrite = vi.fn(async () => "ariya dhamma");
  const draftGroundedAnswer = vi.fn(
    async (): Promise<AnswerDraft> => ({
      answer: "ธรรมะคือคำสอน [p1]",
      citationIds: ["p1"],
      suggestions: ["ศึกษาเรื่องใดต่อ"],
    }),
  );
  const repairCitations = vi.fn(
    async (): Promise<AnswerDraft> => ({
      answer: "ธรรมะคือคำสอน [p1]",
      citationIds: ["p1"],
      suggestions: ["ศึกษาเรื่องใดต่อ"],
    }),
  );
  const draftDirectAnswer = vi.fn(
    async (): Promise<DirectAnswerDraft> => ({
      answer: "สวัสดี มีอะไรให้ช่วยเกี่ยวกับการใช้งานไหม",
      suggestions: ["ฉันถามอะไรได้บ้าง"],
    }),
  );
  const generateSuggestions = vi.fn(
    async (
      _turnInput: AgentTurnInput,
      _answer: string,
      suggestions: string[],
    ) => suggestions,
  );

  return {
    retriever: { retrieve },
    decide,
    rewrite,
    draftGroundedAnswer,
    repairCitations,
    draftDirectAnswer,
    generateSuggestions,
    ...overrides,
  };
}

function terminalEvents(events: AgentEvent[]): AgentEvent[] {
  return events.filter(
    (event) => event.type === "run.completed" || event.type === "run.failed",
  );
}

describe("createAiSdkAgentTurnRunner", () => {
  it("answers a direct greeting without retrieving", async () => {
    const dependencies = createDependencies({
      decide: vi.fn(async () => ({ needsRetrieval: false, query: "greeting" })),
    });
    const { events, sink } = captureEvents();

    const result = await createAiSdkAgentTurnRunner(dependencies).runTurn(
      input,
      sink,
    );

    expect(result).toEqual({
      outcome: "answered",
      answer: "สวัสดี มีอะไรให้ช่วยเกี่ยวกับการใช้งานไหม",
      citations: [],
      suggestions: ["ฉันถามอะไรได้บ้าง"],
    });
    expect(dependencies.retriever.retrieve).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "generation.started",
      "answer.completed",
      "citations.completed",
      "suggestions.completed",
      "run.completed",
    ]);
    expect(terminalEvents(events)).toHaveLength(1);
  });

  it("retrieves once for a substantive question and returns only cited sources", async () => {
    const dependencies = createDependencies();
    const { events, sink } = captureEvents();

    const result = await createAiSdkAgentTurnRunner(dependencies).runTurn(
      input,
      sink,
    );

    expect(dependencies.retriever.retrieve).toHaveBeenCalledTimes(1);
    expect(dependencies.retriever.retrieve).toHaveBeenCalledWith(
      { query: "dhamma", attempt: 1 },
      undefined,
    );
    expect(result).toEqual({
      outcome: "answered",
      answer: "ธรรมะคือคำสอน [p1]",
      citations: groundedBundle.citations,
      suggestions: ["ศึกษาเรื่องใดต่อ"],
    });
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "retrieval.started",
      "retrieval.completed",
      "generation.started",
      "answer.completed",
      "citations.completed",
      "suggestions.completed",
      "run.completed",
    ]);
    expect(terminalEvents(events)).toHaveLength(1);
  });

  it("rewrites weak evidence once and performs one final retrieval", async () => {
    const retrieve = vi
      .fn<(request: RetrievalRequest) => Promise<GroundingBundle>>()
      .mockResolvedValueOnce(insufficientBundle("dhamma"))
      .mockResolvedValueOnce({
        ...groundedBundle,
        query: "ariya dhamma",
      });
    const dependencies = createDependencies({ retriever: { retrieve } });
    const { events, sink } = captureEvents();

    const result = await createAiSdkAgentTurnRunner(dependencies).runTurn(
      input,
      sink,
    );

    expect(result.outcome).toBe("answered");
    expect(dependencies.retriever.retrieve).toHaveBeenCalledTimes(2);
    expect(dependencies.retriever.retrieve).toHaveBeenNthCalledWith(
      2,
      { query: "ariya dhamma", attempt: 2 },
      undefined,
    );
    expect(dependencies.rewrite).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "retrieval.started",
      "retrieval.completed",
      "query.rewritten",
      "retrieval.started",
      "retrieval.completed",
      "generation.started",
      "answer.completed",
      "citations.completed",
      "suggestions.completed",
      "run.completed",
    ]);
    expect(terminalEvents(events)).toHaveLength(1);
  });

  it("ends with insufficient evidence after the second weak result", async () => {
    const retrieve = vi
      .fn<(request: RetrievalRequest) => Promise<GroundingBundle>>()
      .mockImplementation(async ({ query }) => insufficientBundle(query));
    const dependencies = createDependencies({ retriever: { retrieve } });
    const { events, sink } = captureEvents();

    const result = await createAiSdkAgentTurnRunner(dependencies).runTurn(
      input,
      sink,
    );

    expect(result).toEqual({ outcome: "insufficient-evidence" });
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(dependencies.rewrite).toHaveBeenCalledTimes(1);
    expect(dependencies.draftGroundedAnswer).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "retrieval.started",
      "retrieval.completed",
      "query.rewritten",
      "retrieval.started",
      "retrieval.completed",
      "run.completed",
    ]);
    expect(terminalEvents(events)).toHaveLength(1);
  });

  it("keeps retrieval unavailable distinct and skips answer generation", async () => {
    const retrieve = vi.fn(async (): Promise<GroundingBundle> => ({
      status: "unavailable",
      query: "dhamma",
      corpusRevision: "corpus-2026-09-18",
      errorCode: "vector_store_unavailable",
    }));
    const dependencies = createDependencies({ retriever: { retrieve } });
    const { events, sink } = captureEvents();

    const result = await createAiSdkAgentTurnRunner(dependencies).runTurn(
      input,
      sink,
    );

    expect(result).toEqual({
      outcome: "retrieval-unavailable",
      code: "vector_store_unavailable",
    });
    expect(dependencies.rewrite).not.toHaveBeenCalled();
    expect(dependencies.draftGroundedAnswer).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: "run.started", runId: "run-1" },
      {
        type: "retrieval.started",
        runId: "run-1",
        attempt: 1,
        query: "dhamma",
      },
      {
        type: "retrieval.failed",
        runId: "run-1",
        code: "vector_store_unavailable",
      },
      {
        type: "run.completed",
        runId: "run-1",
        outcome: "retrieval-unavailable",
      },
    ]);
    expect(terminalEvents(events)).toHaveLength(1);
  });

  it("repairs one unknown citation before emitting answer text", async () => {
    const { events, sink } = captureEvents();
    const repairCitations = vi.fn(async (): Promise<AnswerDraft> => {
      expect(events.some((event) => event.type === "answer.completed")).toBe(
        false,
      );
      return {
        answer: "ธรรมะคือคำสอน [p1]",
        citationIds: ["p1"],
        suggestions: ["ศึกษาเรื่องใดต่อ"],
      };
    });
    const dependencies = createDependencies({
      draftGroundedAnswer: vi.fn(async () => ({
        answer: "คำตอบที่ยังอ้างผิด",
        citationIds: ["unknown"],
        suggestions: ["ศึกษาเรื่องใดต่อ"],
      })),
      repairCitations,
    });

    const result = await createAiSdkAgentTurnRunner(dependencies).runTurn(
      input,
      sink,
    );

    expect(result.outcome).toBe("answered");
    expect(repairCitations).toHaveBeenCalledTimes(1);
    expect(events.find((event) => event.type === "answer.completed")).toEqual({
      type: "answer.completed",
      runId: "run-1",
      text: "ธรรมะคือคำสอน [p1]",
    });
    expect(terminalEvents(events)).toHaveLength(1);
  });

  it("fails after the one citation repair also returns an unknown ID", async () => {
    const dependencies = createDependencies({
      draftGroundedAnswer: vi.fn(async () => ({
        answer: "คำตอบที่ยังอ้างผิด",
        citationIds: ["unknown-1"],
        suggestions: ["ศึกษาเรื่องใดต่อ"],
      })),
      repairCitations: vi.fn(async () => ({
        answer: "คำตอบที่ซ่อมแล้วยังอ้างผิด",
        citationIds: ["unknown-2"],
        suggestions: ["ศึกษาเรื่องใดต่อ"],
      })),
    });
    const { events, sink } = captureEvents();

    const result = await createAiSdkAgentTurnRunner(dependencies).runTurn(
      input,
      sink,
    );

    expect(result).toEqual({ outcome: "failed", code: "invalid_citations" });
    expect(dependencies.repairCitations).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === "answer.completed")).toBe(
      false,
    );
    expect(events.at(-1)).toEqual({
      type: "run.failed",
      runId: "run-1",
      code: "invalid_citations",
    });
    expect(terminalEvents(events)).toHaveLength(1);
  });

  it("preserves a validated answer when suggestion generation fails", async () => {
    const dependencies = createDependencies({
      generateSuggestions: vi.fn(async () => {
        throw new Error("suggestion provider failed");
      }),
    });
    const { events, sink } = captureEvents();

    const result = await createAiSdkAgentTurnRunner(dependencies).runTurn(
      input,
      sink,
    );

    expect(result).toEqual({
      outcome: "answered",
      answer: "ธรรมะคือคำสอน [p1]",
      citations: groundedBundle.citations,
      suggestions: [],
    });
    expect(
      events.some((event) => event.type === "suggestions.completed"),
    ).toBe(false);
    expect(events.at(-1)).toEqual({
      type: "run.completed",
      runId: "run-1",
      outcome: "answered",
    });
    expect(terminalEvents(events)).toHaveLength(1);
  });

  it("stops before the next paid stage when the request is aborted", async () => {
    const controller = new AbortController();
    const rewrite = vi.fn(async () => "should not run");
    const retrieve = vi.fn(async (): Promise<GroundingBundle> => {
      controller.abort();
      return insufficientBundle("dhamma");
    });
    const dependencies = createDependencies({
      retriever: { retrieve },
      rewrite,
    });
    const { events, sink } = captureEvents();

    const result = await createAiSdkAgentTurnRunner(dependencies).runTurn(
      input,
      sink,
      controller.signal,
    );

    expect(result).toEqual({ outcome: "failed", code: "aborted" });
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(rewrite).not.toHaveBeenCalled();
    expect(dependencies.draftGroundedAnswer).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({
      type: "run.failed",
      runId: "run-1",
      code: "aborted",
    });
    expect(terminalEvents(events)).toHaveLength(1);
  });
});
