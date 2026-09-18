import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/services/embedding", () => ({
  generateQueryEmbedding: vi.fn(),
}));
vi.mock("@/lib/services/vector-store", () => ({
  queryPinecone: vi.fn(),
  formatContext: vi.fn((m: unknown[]) => `ctx(${m.length})`),
}));

import { searchDocuments, runRAG, extractTextFromMessages } from "@/lib/services/rag-pipeline";
import { generateQueryEmbedding } from "@/lib/services/embedding";
import { queryPinecone } from "@/lib/services/vector-store";
import type { UIMessage } from "ai";

const mockedEmbed = vi.mocked(generateQueryEmbedding);
const mockedQuery = vi.mocked(queryPinecone);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractTextFromMessages", () => {
  it("returns text from the last message's text part", () => {
    const messages = [
      { id: "1", role: "user", parts: [{ type: "text", text: "What is dhamma?" }] },
    ] as UIMessage[];
    expect(extractTextFromMessages(messages)).toBe("What is dhamma?");
  });

  it("returns empty string for empty messages array", () => {
    expect(extractTextFromMessages([])).toBe("");
  });

  it("returns empty string when last message has no text part", () => {
    const messages = [
      {
        id: "1",
        role: "assistant",
        parts: [{ type: "data-reasoning", data: { summary: "thinking" } }],
      },
    ] as UIMessage[];
    expect(extractTextFromMessages(messages)).toBe("");
  });

  it("returns empty string when parts array is missing and no content field", () => {
    const messages = [{ id: "1", role: "user" }] as UIMessage[];
    expect(extractTextFromMessages(messages)).toBe("");
  });

  it("falls back to legacy content field when parts is not an array", () => {
    const messages = [
      { id: "1", role: "user", content: "legacy text" },
    ] as unknown as UIMessage[];
    expect(extractTextFromMessages(messages)).toBe("legacy text");
  });
});

describe("searchDocuments", () => {
  it("returns empty result for an empty query", async () => {
    const result = await searchDocuments("");
    expect(result).toEqual({ context: "", matches: [] });
    expect(mockedEmbed).not.toHaveBeenCalled();
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("embeds the query and queries pinecone with topK=5 by default", async () => {
    mockedEmbed.mockResolvedValue([0.1, 0.2]);
    mockedQuery.mockResolvedValue([]);

    await searchDocuments("dhamma");

    expect(mockedEmbed).toHaveBeenCalledWith("dhamma");
    expect(mockedQuery).toHaveBeenCalledWith([0.1, 0.2], 5);
  });

  it("respects a custom topK", async () => {
    mockedEmbed.mockResolvedValue([0.1]);
    mockedQuery.mockResolvedValue([]);

    await searchDocuments("dhamma", { topK: 8 });

    expect(mockedQuery).toHaveBeenCalledWith([0.1], 8);
  });

  it("returns context and matches on success", async () => {
    mockedEmbed.mockResolvedValue([0.1]);
    mockedQuery.mockResolvedValue([{ id: "a" } as never, { id: "b" } as never]);

    const result = await searchDocuments("dhamma");

    expect(result.context).toBe("ctx(2)");
    expect(result.matches).toHaveLength(2);
  });

  it("propagates embedding errors", async () => {
    mockedEmbed.mockRejectedValue(new Error("embed failed"));

    await expect(searchDocuments("dhamma")).rejects.toThrow("embed failed");
  });
});

describe("runRAG (back-compat wrapper)", () => {
  it("delegates to searchDocuments using the last user message text", async () => {
    mockedEmbed.mockResolvedValue([0.1]);
    mockedQuery.mockResolvedValue([]);

    const messages = [
      { id: "1", role: "user", parts: [{ type: "text", text: "What is dhamma?" }] },
    ] as UIMessage[];

    await runRAG(messages);

    expect(mockedEmbed).toHaveBeenCalledWith("What is dhamma?");
  });

  it("returns empty result for an empty messages array", async () => {
    const result = await runRAG([]);
    expect(result).toEqual({ context: "", matches: [] });
  });
});
