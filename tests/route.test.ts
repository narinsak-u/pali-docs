import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEventSink, AgentTurnRunner } from "@/lib/agent/types";

interface TestStream {
  writes: unknown[];
  completion: Promise<void>;
}

const mocked = vi.hoisted(() => ({
  createRunner: vi.fn(),
  runTurn: vi.fn(),
}));

vi.mock("@/lib/agent/ai-sdk-runner", () => ({
  createAiSdkAgentTurnRunner: mocked.createRunner,
}));

vi.mock("ai", () => ({
  createUIMessageStream: vi.fn(
    ({ execute }: { execute: (options: { writer: { write(part: unknown): void } }) => Promise<void> }) => {
      const writes: unknown[] = [];
      const completion = execute({
        writer: {
          write(part: unknown) {
            writes.push(part);
          },
        },
      });
      return { writes, completion } satisfies TestStream;
    },
  ),
  createUIMessageStreamResponse: vi.fn(
    async ({ stream }: { stream: TestStream }) => {
      await stream.completion;
      return new Response(JSON.stringify(stream.writes), {
        headers: { "Content-Type": "application/json" },
      });
    },
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

  it("returns 429 with a stable response for quota failures", async () => {
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
