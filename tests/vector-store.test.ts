import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedNamespace = vi.hoisted(() => vi.fn());
const mockedIndex = vi.hoisted(() => ({ namespace: mockedNamespace }));

vi.mock("@/lib/pinecone", () => ({
  getPineconeIndex: vi.fn(() => mockedIndex),
}));
vi.mock("@/lib/config/rag", () => ({
  getRagConfig: vi.fn(() => ({ PINECONE_NAMESPACE: "" })),
}));

import { queryPinecone } from "@/lib/services/vector-store";

beforeEach(() => {
  vi.clearAllMocks();
});


describe("queryPinecone", () => {
  it("queries the configured namespace without forwarding an unsupported signal", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ matches: [] });
    mockedNamespace.mockReturnValue({ query: mockQuery });
    const controller = new AbortController();

    const result = await queryPinecone([0.1, 0.2], 5, controller.signal);

    expect(mockedNamespace).toHaveBeenCalledWith("");
    expect(mockQuery).toHaveBeenCalledWith({
      vector: [0.1, 0.2],
      topK: 5,
      includeMetadata: true,
    });
    expect(result).toEqual([]);
  });

  it("maps only citation-safe metadata into grounding passages", async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      matches: [
        {
          id: "a",
          score: 0.95,
          metadata: {
            text: "text A",
            source: "part-1/chapter-1",
            title: "บทที่ 1",
            section: "section-a",
            ignored: "not application metadata",
          },
        },
        {
          id: "b",
          score: 0.85,
          metadata: {
            text: "text B",
            source: "part-1/chapter-2",
            title: "บทที่ 2",
            section: 42,
          },
        },
      ],
    });
    mockedNamespace.mockReturnValue({ query: mockQuery });

    const result = await queryPinecone([0.1], 3);

    expect(result).toEqual([
      {
        id: "a",
        score: 0.95,
        text: "text A",
        source: "part-1/chapter-1",
        title: "บทที่ 1",
        section: "section-a",
      },
      {
        id: "b",
        score: 0.85,
        text: "text B",
        source: "part-1/chapter-2",
        title: "บทที่ 2",
      },
    ]);
  });

  it.each([
    ["missing metadata", null],
    [
      "blank text",
      { text: " ", source: "part-1/chapter-1", title: "บทที่ 1" },
    ],
    ["blank source", { text: "text", source: "", title: "บทที่ 1" }],
    [
      "non-string title",
      { text: "text", source: "part-1/chapter-1", title: 1 },
    ],
  ])("drops a match with %s", async (_case, metadata) => {
    const mockQuery = vi.fn().mockResolvedValue({
      matches: [{ id: "unsafe", score: 0.9, metadata }],
    });
    mockedNamespace.mockReturnValue({ query: mockQuery });

    await expect(queryPinecone([0.1], 5)).resolves.toEqual([]);
  });

  it("checks an AbortSignal before the Pinecone query", async () => {
    const mockQuery = vi.fn();
    mockedNamespace.mockReturnValue({ query: mockQuery });
    const controller = new AbortController();
    controller.abort();

    await expect(
      queryPinecone([0.1], 5, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
