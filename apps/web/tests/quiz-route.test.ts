import { describe, it, expect, vi, beforeEach } from "vitest";
import { createUIMessageStreamResponse } from "ai";

vi.mock("@/lib/pinecone", () => ({
  pc: { inference: { embed: vi.fn() } },
  index: { namespace: vi.fn(() => ({ query: vi.fn() })) },
}));

vi.mock("ai", () => ({
  createUIMessageStreamResponse: vi.fn((args: { stream: unknown }) => ({
    status: 200,
    body: "mock-stream",
    stream: args.stream,
  })),
}));

vi.mock("@/lib/services/quiz-pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/quiz-pipeline")>();
  return {
    ...actual,
    generateQuizStream: vi.fn(),
  };
});

import { POST } from "@/app/api/quiz/route";
import { generateQuizStream } from "@/lib/services/quiz-pipeline";

const mockedStream = vi.mocked(generateQuizStream);
const mockedCreateResponse = vi.mocked(createUIMessageStreamResponse);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeChatReq(payload: object): Request {
  return new Request("http://localhost/api/quiz", {
    method: "POST",
    body: JSON.stringify({
      id: "test-id",
      messages: [
        {
          parts: [{ type: "text", text: JSON.stringify(payload) }],
          id: "msg-1",
          role: "user",
        },
      ],
      trigger: "submit-message",
    }),
  });
}

function makeRawReq(body: unknown): Request {
  return new Request("http://localhost/api/quiz", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/quiz", () => {
  it("returns 200 with the UIMessageStream on success", async () => {
    const fakeStream = { id: "ui-stream" } as never;
    mockedStream.mockReturnValue(fakeStream);

    const response = await POST(makeChatReq({ topics: ["anatta"], amount: 3 }));

    expect(response.status).toBe(200);
    expect(mockedStream).toHaveBeenCalledWith({ topics: ["anatta"], amount: 3 });
    expect(mockedCreateResponse).toHaveBeenCalledWith({ stream: fakeStream });
  });

  it("returns 500 for invalid input", async () => {
    const response = await POST(makeRawReq({ topics: "not-an-array" }));
    expect(response.status).toBe(500);
  });
});
