import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedEmbed = vi.hoisted(() => vi.fn());

vi.mock("@/lib/pinecone", () => ({
  getPineconeClient: vi.fn(() => ({ inference: { embed: mockedEmbed } })),
}));

import { generateQueryEmbedding } from "@/lib/services/embedding";
const mockedPineconeEmbed = mockedEmbed;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateQueryEmbedding", () => {
  it("embeds search text with query input type", async () => {
    mockedPineconeEmbed.mockResolvedValue({
      data: [{ values: [0.1, 0.2] }],
    } as never);

    await generateQueryEmbedding("dhamma");

    expect(mockedPineconeEmbed).toHaveBeenCalledWith(
      "llama-text-embed-v2",
      ["dhamma"],
      { inputType: "query", truncate: "END" },
    );
  });

  it("returns cached result on repeat call without calling embed again", async () => {
    mockedPineconeEmbed.mockResolvedValue({
      data: [{ values: [0.5] }],
    } as never);

    const first = await generateQueryEmbedding("repeat-key");
    const second = await generateQueryEmbedding("repeat-key");

    expect(mockedPineconeEmbed).toHaveBeenCalledTimes(1);
    expect(first).toEqual([0.5]);
    expect(second).toEqual(first);
  });

  it("calls embed again for different text", async () => {
    mockedPineconeEmbed.mockResolvedValue({
      data: [{ values: [1.0] }],
    } as never);

    await generateQueryEmbedding("diff-a");
    await generateQueryEmbedding("diff-b");
    await generateQueryEmbedding("diff-c");

    expect(mockedPineconeEmbed).toHaveBeenCalledTimes(3);
  });

  it("handles the cache LRU by re-calling embed after 100 unique texts", async () => {
    const texts = Array.from({ length: 101 }, (_, i) => `text-${i}`);
    mockedPineconeEmbed.mockResolvedValue({
      data: [{ values: [0.5] }],
    } as never);

    for (const t of texts) {
      await generateQueryEmbedding(t);
    }

    // First text should be evicted, call generates a new one
    await generateQueryEmbedding("text-0");

    // 101 calls for the unique texts + 1 for the re-call of evicted text
    expect(mockedPineconeEmbed).toHaveBeenCalledTimes(102);
  });
});
