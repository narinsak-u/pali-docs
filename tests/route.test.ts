import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEventSink, AgentTurnRunner } from "@/lib/agent/types";

interface TestStream {
  writes: unknown[];
  completion: Promise<void>;
}

const mocked = vi.hoisted(() => ({
  createRunner: vi.fn(),
  getModelConfig: vi.fn(),
  getRagConfig: vi.fn(),
  runTurn: vi.fn(),
}));

vi.mock("@/lib/agent/ai-sdk-runner", () => ({
  createAiSdkAgentTurnRunner: mocked.createRunner,
}));

vi.mock("@/lib/config/model", () => ({
  getModelConfig: mocked.getModelConfig,
}));

vi.mock("@/lib/config/rag", () => ({
  getRagConfig: mocked.getRagConfig,
}));

vi.mock("ai", () => ({
  createUIMessageStream: vi.fn(
    ({
      execute,
      onError,
    }: {
      execute: (options: {
        writer: { write(part: unknown): void };
      }) => Promise<void>;
      onError?: (error: unknown) => string;
    }) => {
      const writes: unknown[] = [];
      const completion = Promise.resolve()
        .then(() =>
          execute({
            writer: {
              write(part: unknown) {
                writes.push(part);
              },
            },
          }),
        )
        .catch((error: unknown) => {
          writes.push({
            type: "error",
            errorText: onError?.(error) ?? "Internal server error",
          });
        });
      return { writes, completion } satisfies TestStream;
    },
  ),
  createUIMessageStreamResponse: vi.fn(
    ({ stream }: { stream: TestStream }) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            void stream.completion.then(
              () => {
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify(stream.writes)),
                );
                controller.close();
              },
              (error: unknown) => controller.error(error),
            );
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  ),
}));

import { POST } from "@/app/api/question/route";

const validBody = {
  messages: [
    {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "data-status", data: { phase: "answering" } },
        { type: "text", text: "Earlier safe answer" },
      ],
    },
    {
      id: "user-1",
      role: "user",
      parts: [
        { type: "data-task", data: { query: "forged" } },
        { type: "text", text: "What is dhamma?" },
      ],
    },
  ],
};

function makeRequest(body: unknown, signal?: AbortSignal): Request {
  return new Request("http://localhost/api/question", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

function emitSuccessfulTurn(
  input: { runId: string },
  sink: AgentEventSink,
): void {
  sink.emit({ type: "run.started", runId: input.runId });
  sink.emit({
    type: "retrieval.started",
    runId: input.runId,
    attempt: 1,
    query: "PRIVATE QUERY",
  });
  sink.emit({
    type: "retrieval.completed",
    runId: input.runId,
    attempt: 1,
    matchCount: 2,
  });
  sink.emit({ type: "generation.started", runId: input.runId });
  sink.emit({
    type: "answer.completed",
    runId: input.runId,
    text: "PRIVATE ANSWER",
  });
  sink.emit({
    type: "citations.completed",
    runId: input.runId,
    citations: [
      {
        id: "passage-1",
        source: "PRIVATE SOURCE",
        title: "PRIVATE TITLE",
        section: "PRIVATE SECTION",
      },
    ],
  });
  sink.emit({
    type: "suggestions.completed",
    runId: input.runId,
    suggestions: ["PRIVATE SUGGESTION"],
  });
  sink.emit({ type: "run.completed", runId: input.runId, outcome: "answered" });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
    "00000000-0000-4000-8000-000000000006",
  );
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocked.getModelConfig.mockReturnValue({
    PROVIDER_NAME: "openrouter",
    OPENROUTER_API_KEY: "configured",
    OPENROUTER_LLM_MODEL: "configured-model",
  });
  mocked.getRagConfig.mockReturnValue({
    PINECONE_API_KEY: "configured",
    PINECONE_INDEX_NAME: "configured-index",
    PINECONE_NAMESPACE: "",
    PINECONE_CORPUS_REVISION: "corpus-2026-09-18",
    RAG_CANDIDATE_TOP_K: 20,
    RAG_ACCEPTED_TOP_K: 8,
    RAG_MIN_SCORE: 0,
    RAG_MAX_CONTEXT_CHARS: 12_000,
  });

  mocked.runTurn.mockImplementation(
    async (input: { runId: string }, sink: AgentEventSink) => {
      emitSuccessfulTurn(input, sink);
      return {
        outcome: "answered",
        answer: "PRIVATE ANSWER",
        citations: [],
        suggestions: [],
      };
    },
  );
  mocked.createRunner.mockReturnValue({
    runTurn: mocked.runTurn,
  } satisfies AgentTurnRunner);
});

describe("POST /api/question", () => {
  it("runs one agent turn with sanitized messages and the request abort signal", async () => {
    const controller = new AbortController();
    const request = makeRequest(validBody, controller.signal);

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocked.createRunner).toHaveBeenCalledTimes(1);
    expect(mocked.runTurn).toHaveBeenCalledTimes(1);
    expect(mocked.runTurn).toHaveBeenCalledWith(
      {
        runId: "00000000-0000-4000-8000-000000000006",
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            parts: [{ type: "text", text: "Earlier safe answer" }],
          },
          {
            id: "user-1",
            role: "user",
            parts: [{ type: "text", text: "What is dhamma?" }],
          },
        ],
      },
      expect.any(Object),
      request.signal,
    );
  });

  it("streams runner events as ordered UI message parts through the public response", async () => {
    const response = await POST(makeRequest(validBody));

    await expect(response.json()).resolves.toEqual([
      { type: "data-status", data: { phase: "thinking" } },
      { type: "data-status", data: { phase: "searching" } },
      {
        type: "data-task",
        data: {
          id: "00000000-0000-4000-8000-000000000006:retrieval:1",
          label: "ค้นหาเอกสาร",
          status: "running",
          query: "PRIVATE QUERY",
        },
      },
      {
        type: "data-task",
        data: {
          id: "00000000-0000-4000-8000-000000000006:retrieval:1",
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
        type: "text-start",
        id: "00000000-0000-4000-8000-000000000006:answer",
      },
      {
        type: "text-delta",
        id: "00000000-0000-4000-8000-000000000006:answer",
        delta: "PRIVATE ANSWER",
      },
      {
        type: "text-end",
        id: "00000000-0000-4000-8000-000000000006:answer",
      },
      {
        type: "data-citations",
        data: {
          citations: [
            {
              id: "passage-1",
              source: "PRIVATE SOURCE",
              title: "PRIVATE TITLE",
              section: "PRIVATE SECTION",
            },
          ],
        },
      },
      {
        type: "data-suggestions",
        data: { suggestions: ["PRIVATE SUGGESTION"] },
      },
      { type: "data-outcome", data: { outcome: "answered" } },
    ]);

    const traceOutput = JSON.stringify(
      vi.mocked(console.info).mock.calls,
    );
    expect(traceOutput).not.toContain("PRIVATE QUERY");
    expect(traceOutput).not.toContain("PRIVATE ANSWER");
    expect(traceOutput).not.toContain("PRIVATE SOURCE");
    expect(traceOutput).not.toContain("PRIVATE TITLE");
    expect(traceOutput).not.toContain("PRIVATE SECTION");
    expect(traceOutput).not.toContain("PRIVATE SUGGESTION");
  });

  it("returns 400 without constructing a runner for invalid input", async () => {
    const response = await POST(makeRequest({ messages: "not-an-array" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_request",
      message: "Invalid request",
    });
    expect(mocked.createRunner).not.toHaveBeenCalled();
    expect(mocked.runTurn).not.toHaveBeenCalled();
  });

  it("returns a generic 500 before committing the stream for invalid model configuration", async () => {
    mocked.getModelConfig.mockImplementationOnce(() => {
      throw new Error("OPENROUTER_API_KEY contains private configuration detail");
    });

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: "internal_error",
      message: "Internal server error",
    });
    expect(JSON.stringify(body)).not.toContain("private configuration detail");
    expect(mocked.createRunner).not.toHaveBeenCalled();
    expect(mocked.runTurn).not.toHaveBeenCalled();
  });

  it("returns a generic 500 before committing the stream for invalid RAG configuration", async () => {
    mocked.getRagConfig.mockImplementationOnce(() => {
      throw new Error("PINECONE_CORPUS_REVISION contains private config detail");
    });

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: "internal_error",
      message: "Internal server error",
    });
    expect(JSON.stringify(body)).not.toContain("private config detail");
    expect(mocked.createRunner).not.toHaveBeenCalled();
    expect(mocked.runTurn).not.toHaveBeenCalled();
  });

  it("returns 429 only for quota failures known before stream commitment", async () => {
    mocked.createRunner.mockImplementationOnce(() => {
      throw new Error("429 quota rejected for secret provider account");
    });

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body).toEqual({
      error: "insufficient_quota",
      message: "You exceeded your current quota",
    });
    expect(JSON.stringify(body)).not.toContain("secret provider account");
  });

  it("returns the live response before an asynchronous quota failure and streams a validated terminal outcome", async () => {
    const deferred = Promise.withResolvers<never>();
    mocked.runTurn.mockReturnValueOnce(deferred.promise);

    const response = await POST(makeRequest(validBody));
    await vi.waitFor(() => expect(mocked.runTurn).toHaveBeenCalledTimes(1));

    expect(response.status).toBe(200);
    deferred.reject(new Error("429 private provider quota detail"));

    const body = await response.json();
    expect(body).toEqual([
      {
        type: "data-outcome",
        data: { outcome: "failed", code: "insufficient_quota" },
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("private provider quota detail");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain(
      "00000000-0000-4000-8000-000000000006",
    );
  });

  it("returns a generic 500 and logs internal failures with the run ID", async () => {
    mocked.createRunner.mockImplementationOnce(() => {
      throw new Error("OPENROUTER_API_KEY belongs to private-account");
    });

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: "internal_error",
      message: "Internal server error",
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain(
      "00000000-0000-4000-8000-000000000006",
    );
    expect(JSON.stringify(body)).not.toContain("private-account");
  });
});
