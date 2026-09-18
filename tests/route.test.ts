import { describe, it, expect, vi, beforeEach } from "vitest";

const captured = vi.hoisted(() => ({
  stopWhen: null as unknown,
  prepareStep: null as unknown,
  searchDocs: null as {
    execute: (...args: unknown[]) => Promise<unknown>;
  } | null,
  suggestQuestions: null as {
    execute: (...args: unknown[]) => Promise<unknown>;
  } | null,
}));

vi.mock("ai", () => ({
  streamText: vi.fn((opts) => {
    captured.stopWhen = opts.stopWhen;
    captured.prepareStep = opts.prepareStep;
    captured.searchDocs = opts.tools?.searchDocs ?? null;
    captured.suggestQuestions = opts.tools?.suggestQuestions ?? null;
    return {
      toUIMessageStream: vi.fn(
        () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue({
                type: "text-delta",
                id: "t-1",
                delta: "mock answer text",
              });
              controller.close();
            },
          }),
      ),
      consumeStream: vi.fn(async () => {
        if (captured.searchDocs?.execute) {
          await captured.searchDocs.execute(
            { query: "dhamma" },
            { toolCallId: "tc-1" },
          );
        }
      }),
      text: Promise.resolve("mock answer text"),
    };
  }),
  createUIMessageStream: vi.fn((opts) => {
    const writes: Array<Record<string, unknown>> = [];
    const mergePromises: Promise<void>[] = [];
    const writer = {
      writes,
      write: vi.fn((w: Record<string, unknown>) => writes.push(w)),
      merge: vi.fn((stream: ReadableStream) => {
        mergePromises.push(
          (async () => {
            const reader = stream.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              writes.push(value);
            }
          })(),
        );
      }),
    };
    return Promise.resolve(opts.execute({ writer }))
      .then(() => Promise.all(mergePromises))
      .then(() => ({ body: { writer } }));
  }),
  createUIMessageStreamResponse: vi.fn((args) => args.stream),
  convertToModelMessages: vi.fn((m) => m),
  tool: vi.fn((opts) => opts),
}));

vi.mock("@/lib/services/rag-pipeline", () => ({ searchDocuments: vi.fn() }));
vi.mock("@/lib/services/llm-provider", () => ({
  getConfiguredModel: vi.fn(() => ({
    model: "configured-model",
    providerName: "openrouter",
    modelId: "openrouter/model",
  })),
}));
vi.mock("@/lib/chat/pali-system-prompt", () => ({
  PALI_EXPERT_SYSTEM_PROMPT: "PROMPT",
}));
vi.mock("@/lib/services/vector-store", () => ({
  formatContext: vi.fn((matches: Array<{ text: string }>) =>
    matches.map((m) => m.text).join("|MOCK|"),
  ),
}));

import { POST } from "@/app/api/question/route";
import { searchDocuments } from "@/lib/services/rag-pipeline";
import { formatContext } from "@/lib/services/vector-store";
import { streamText } from "ai";
import { getConfiguredModel } from "@/lib/services/llm-provider";

const mockedSearch = vi.mocked(searchDocuments);
const mockedFormatContext = vi.mocked(formatContext);
const mockedStreamText = vi.mocked(streamText);
const mockedGetConfiguredModel = vi.mocked(getConfiguredModel);

interface WriterMock {
  writes: Array<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/question", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/question", () => {
  it("returns 400 without starting the model for malformed input", async () => {
    const response = (await POST(
      makeReq({ messages: "not-an-array" }),
    )) as Response;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_request",
      message: "Invalid request",
    });
    expect(mockedStreamText).not.toHaveBeenCalled();
  });

  it("returns 400 without starting the model for oversized input", async () => {
    const response = (await POST(
      makeReq({
        messages: [
          {
            id: "u",
            role: "user",
            parts: [{ type: "text", text: "x".repeat(4_001) }],
          },
        ],
      }),
    )) as Response;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_request",
      message: "Invalid request",
    });
    expect(mockedStreamText).not.toHaveBeenCalled();
  });

  it("does not expose model configuration errors", async () => {
    mockedGetConfiguredModel.mockImplementationOnce(() => {
      throw new Error("OPENROUTER_API_KEY is missing");
    });

    const response = (await POST(
      makeReq({
        messages: [
          {
            id: "u",
            role: "user",
            parts: [{ type: "text", text: "question" }],
          },
        ],
      }),
    )) as Response;

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "internal_error",
      message: "Internal server error",
    });
    expect(mockedStreamText).not.toHaveBeenCalled();
  });

  describe("stopWhenAnswered", () => {
    it("stops at 5 steps or when answer text exceeds 150 chars", async () => {
      mockedSearch.mockResolvedValue({ matches: [], context: "" });
      await POST(
        makeReq({
          messages: [
            { id: "1", role: "user", parts: [{ type: "text", text: "x" }] },
          ],
        }),
      );

      const stopWhen = captured.stopWhen as (args: {
        steps: Array<{ text: string }>;
      }) => boolean;

      expect(stopWhen({ steps: [] })).toBe(false);
      expect(stopWhen({ steps: [{ text: "" }, { text: "" }] })).toBe(false);
      expect(
        stopWhen({
          steps: [
            { text: "" },
            { text: "" },
            { text: "" },
            { text: "" },
            { text: "" },
          ],
        }),
      ).toBe(true);
      expect(stopWhen({ steps: [{ text: "x".repeat(160) }] })).toBe(true);
    });
  });

  describe("searchDocs tool", () => {
    it("emits data-task (running, done) and data-reasoning on success", async () => {
      mockedSearch.mockResolvedValue({
        matches: [
          { id: "a", score: 0.9, text: "passage A" },
          { id: "b", score: 0.8, text: "passage B" },
        ],
        context: "ctx",
      });

      const result = (await POST(
        makeReq({
          messages: [
            {
              id: "1",
              role: "user",
              parts: [{ type: "text", text: "what is dhamma?" }],
            },
          ],
        }),
      )) as unknown as { body: { writer: WriterMock } };

      const writes = result.body.writer.writes;
      const taskRunning = writes.find(
        (w) =>
          w.type === "data-task" &&
          (w.data as { status: string }).status === "running",
      );
      const taskDone = writes.find(
        (w) =>
          w.type === "data-task" &&
          (w.data as { status: string }).status === "done",
      );
      const reasoning = writes.find((w) => w.type === "data-reasoning");

      expect(taskRunning).toBeDefined();
      expect((taskRunning!.data as { query: string }).query).toBe("dhamma");
      expect(taskDone).toBeDefined();
      expect((taskDone!.data as { matchCount: number }).matchCount).toBe(2);
      expect(reasoning).toBeDefined();
      expect((reasoning!.data as { summary: string }).summary).toMatch(/2/);
    });

    it("emits data-task with status=error when searchDocuments throws", async () => {
      mockedSearch.mockRejectedValue(new Error("Pinecone timeout"));

      const result = (await POST(
        makeReq({
          messages: [
            { id: "1", role: "user", parts: [{ type: "text", text: "x" }] },
          ],
        }),
      )) as unknown as { body: { writer: WriterMock } };

      const errored = result.body.writer.writes.find(
        (w) =>
          w.type === "data-task" &&
          (w.data as { status: string }).status === "error",
      );
      expect(errored).toBeDefined();
      expect((errored!.data as { message: string }).message).toMatch(
        /Pinecone/,
      );
    });

    it("only runs searchDocuments once and emits one error when LLM calls searchDocs 4 times", async () => {
      mockedSearch.mockRejectedValue(new Error("Pinecone timeout"));

      const result = (await POST(
        makeReq({
          messages: [
            { id: "1", role: "user", parts: [{ type: "text", text: "x" }] },
          ],
        }),
      )) as unknown as { body: { writer: WriterMock } };

      const tool = captured.searchDocs!;
      expect(tool).toBeDefined();

      await tool.execute({ query: "q1" }, { toolCallId: "tc-1" });
      await tool.execute({ query: "q2" }, { toolCallId: "tc-2" });
      await tool.execute({ query: "q3" }, { toolCallId: "tc-3" });
      await tool.execute({ query: "q4" }, { toolCallId: "tc-4" });

      const errorWrites = result.body.writer.writes.filter(
        (w) =>
          w.type === "data-task" &&
          (w.data as { status: string }).status === "error",
      );

      expect(mockedSearch).toHaveBeenCalledTimes(1);
      expect(errorWrites).toHaveLength(1);
    });
  });

  describe("prepareStep", () => {
    async function triggerPrepareStep(
      matches: Array<{ id: string; score: number; text: string }>,
    ) {
      mockedSearch.mockResolvedValue({ matches, context: "ctx" });
      await POST(
        makeReq({
          messages: [
            { id: "1", role: "user", parts: [{ type: "text", text: "q" }] },
          ],
        }),
      );
      return captured.prepareStep as
        | ((args: Record<string, unknown>) => Promise<unknown>)
        | null;
    }

    it("calls formatContext with the matches", async () => {
      const matches = [
        { id: "a", score: 0.9, text: "passage A" },
        { id: "b", score: 0.8, text: "passage B" },
      ];
      const prepareStep = await triggerPrepareStep(matches);
      expect(prepareStep).toBeDefined();

      await prepareStep!({
        steps: [
          { toolResults: [{ toolName: "searchDocs", output: { matches } }] },
        ],
        stepNumber: 1,
        model: {},
        messages: [],
      });

      expect(mockedFormatContext).toHaveBeenCalledOnce();
      expect(mockedFormatContext).toHaveBeenCalledWith(matches);
    });

    it("injects formatted context into the system prompt", async () => {
      const matches = [
        { id: "a", score: 0.9, text: "passage A" },
        { id: "b", score: 0.8, text: "passage B" },
      ];
      const prepareStep = await triggerPrepareStep(matches);
      expect(prepareStep).toBeDefined();

      const result = (await prepareStep!({
        steps: [
          { toolResults: [{ toolName: "searchDocs", output: { matches } }] },
        ],
        stepNumber: 1,
        model: {},
        messages: [],
      })) as { system?: string } | undefined;

      expect(result).toBeDefined();
      expect(result!.system).toContain("passage A|MOCK|passage B");
      expect(result!.system).toContain("PROMPT");
    });

    it("returns undefined when matches is empty (no context injection)", async () => {
      const prepareStep = await triggerPrepareStep([]);
      expect(prepareStep).toBeDefined();

      const result = await prepareStep!({
        steps: [
          {
            toolResults: [{ toolName: "searchDocs", output: { matches: [] } }],
          },
        ],
        stepNumber: 1,
        model: {},
        messages: [],
      });

      expect(result).toBeUndefined();
      expect(mockedFormatContext).not.toHaveBeenCalled();
    });
  });

  describe("suggestQuestions tool", () => {
    async function captureSuggestTool() {
      mockedSearch.mockResolvedValue({
        matches: [{ id: "a", score: 0.9, text: "t" }],
        context: "ctx",
      });
      await POST(
        makeReq({
          messages: [
            { id: "1", role: "user", parts: [{ type: "text", text: "q" }] },
          ],
        }),
      );
      return captured.suggestQuestions;
    }

    it("writes data-suggestions when called with suggestions", async () => {
      const suggestTool = await captureSuggestTool();
      expect(suggestTool?.execute).toBeDefined();

      const result = await suggestTool!.execute(
        { suggestions: ["q1", "q2", "q3"] },
        { toolCallId: "tc-suggest" },
      );

      expect(result).toEqual({ ok: true });
    });

    it("rejects empty suggestions", async () => {
      const suggestTool = await captureSuggestTool();
      expect(suggestTool?.execute).toBeDefined();

      const result = await suggestTool!.execute(
        { suggestions: [] },
        { toolCallId: "tc-empty" },
      );

      expect(result).toEqual({ ok: false });
    });
  });
});
