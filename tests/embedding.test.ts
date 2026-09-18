import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/pinecone", () => ({
  pc: { inference: { embed: vi.fn() } },
}));

import { generateQueryEmbedding } from "@/lib/services/embedding";
import { pc } from "@/lib/pinecone";

const mockedEmbed = vi.mocked(pc.inference.embed);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateQueryEmbedding", () => {
  it("embeds search text with query input type", async () => {
    mockedEmbed.mockResolvedValue({ data: [{ values: [0.1, 0.2] }] } as never);

    await generateQueryEmbedding("dhamma");

    expect(mockedEmbed).toHaveBeenCalledWith(
      "llama-text-embed-v2",
      ["dhamma"],
      { inputType: "query", truncate: "END" },
    );
  });

  it("returns cached result on repeat call without calling embed again", async () => {
    mockedEmbed.mockResolvedValue({
      data: [{ values: [0.5] }],
    } as never);

    const first = await generateQueryEmbedding("repeat-key");
    const second = await generateQueryEmbedding("repeat-key");

    expect(mockedEmbed).toHaveBeenCalledTimes(1);
    expect(first).toEqual([0.5]);
    expect(second).toEqual(first);
  });

  it("calls embed again for different text", async () => {
    mockedEmbed.mockResolvedValue({
      data: [{ values: [1.0] }],
    } as never);

    await generateQueryEmbedding("diff-a");
    await generateQueryEmbedding("diff-b");
    await generateQueryEmbedding("diff-c");

    expect(mockedEmbed).toHaveBeenCalledTimes(3);
  });

  it("handles the cache LRU by re-calling embed after 100 unique texts", async () => {
    const texts = Array.from({ length: 101 }, (_, i) => `text-${i}`);
    mockedEmbed.mockResolvedValue({
      data: [{ values: [0.5] }],
    } as never);

    for (const t of texts) {
      await generateQueryEmbedding(t);
    }

    // First text should be evicted, call generates a new one
    await generateQueryEmbedding("text-0");

    // 101 calls for the unique texts + 1 for the re-call of evicted text
    expect(mockedEmbed).toHaveBeenCalledTimes(102);
  });
});
