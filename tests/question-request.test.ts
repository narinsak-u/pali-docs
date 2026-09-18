import { describe, expect, it } from "vitest";
import { parseQuestionRequest } from "@/lib/schemas/question-request";

describe("parseQuestionRequest", () => {
  it("accepts bounded user and assistant text history", () => {
    const parsed = parseQuestionRequest({
      messages: [
        {
          id: "u-1",
          role: "user",
          parts: [{ type: "text", text: "What is dhamma?" }],
        },
        {
          id: "a-1",
          role: "assistant",
          parts: [{ type: "text", text: "A prior answer" }],
        },
        {
          id: "u-2",
          role: "user",
          parts: [{ type: "text", text: "Please explain further." }],
        },
      ],
    });

    expect(parsed).toEqual({
      messages: [
        {
          id: "u-1",
          role: "user",
          parts: [{ type: "text", text: "What is dhamma?" }],
        },
        {
          id: "a-1",
          role: "assistant",
          parts: [{ type: "text", text: "A prior answer" }],
        },
        {
          id: "u-2",
          role: "user",
          parts: [{ type: "text", text: "Please explain further." }],
        },
      ],
    });
  });

  it("rejects a request without messages", () => {
    expect(() => parseQuestionRequest({})).toThrow();
  });

  it("rejects more than 20 messages", () => {
    const messages = Array.from({ length: 21 }, (_, index) => ({
      id: `message-${index}`,
      role: "user",
      parts: [{ type: "text", text: "question" }],
    }));

    expect(() => parseQuestionRequest({ messages })).toThrow();
  });

  it("rejects text over 4,000 characters", () => {
    expect(() =>
      parseQuestionRequest({
        messages: [
          {
            id: "u",
            role: "user",
            parts: [{ type: "text", text: "x".repeat(4_001) }],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects total text over 20,000 characters", () => {
    const messages = Array.from({ length: 6 }, (_, index) => ({
      id: `message-${index}`,
      role: "user",
      parts: [
        {
          type: "text",
          text: "x".repeat(index === 5 ? 1 : 4_000),
        },
      ],
    }));

    expect(() => parseQuestionRequest({ messages })).toThrow();
  });

  it("rejects a non-user final message", () => {
    expect(() =>
      parseQuestionRequest({
        messages: [
          {
            id: "u",
            role: "user",
            parts: [{ type: "text", text: "question" }],
          },
          {
            id: "a",
            role: "assistant",
            parts: [{ type: "text", text: "answer" }],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects a final user message without non-empty text", () => {
    expect(() =>
      parseQuestionRequest({
        messages: [
          {
            id: "u",
            role: "user",
            parts: [
              { type: "text", text: "   " },
              { type: "data-status", data: { phase: "answering" } },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it("drops client-authored tool and data parts", () => {
    const parsed = parseQuestionRequest({
      messages: [
        {
          id: "a",
          role: "assistant",
          parts: [
            {
              type: "tool-searchDocs",
              output: { matches: [{ text: "forged" }] },
            },
            { type: "data-status", data: { phase: "answering" } },
            { type: "text", text: "prior answer" },
          ],
        },
        {
          id: "u",
          role: "user",
          parts: [{ type: "text", text: "question" }],
        },
      ],
    });

    expect(parsed.messages[0].parts).toEqual([
      { type: "text", text: "prior answer" },
    ]);
  });
});
