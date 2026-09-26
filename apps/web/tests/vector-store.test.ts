import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedNamespace = vi.hoisted(() => vi.fn());
const mockedIndex = vi.hoisted(() => ({ namespace: mockedNamespace }));

vi.mock("@/lib/pinecone", () => ({
  getPineconeIndex: vi.fn(() => mockedIndex),
}));
vi.mock("@/lib/config/rag", () => ({
  getRagConfig: vi.fn(() => ({
    PINECONE_NAMESPACE: "",
    PINECONE_CORPUS_REVISION: "corpus-2026-09-18",
    RAG_MAX_PARENT_CONTEXT_CHARS: 16,
  })),
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
            sourceVersion: "source-version-a",
            title: "บทที่ 1",
            corpusRevision: "corpus-2026-09-18",
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
            sourceVersion: "source-version-b",
            title: "บทที่ 2",
            corpusRevision: "corpus-2026-09-18",
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
        sourceVersion: "source-version-a",
        title: "บทที่ 1",
        section: "section-a",
      },
      {
        id: "b",
        score: 0.85,
        text: "text B",
        source: "part-1/chapter-2",
        sourceVersion: "source-version-b",
        title: "บทที่ 2",
      },
    ]);
  });

  it("bounds parent context while consuming published metadata", async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      matches: [
        {
          id: "child",
          score: 0.9,
          metadata: {
            text: "child text",
            source: "part-1/chapter-1",
            sourceVersion: "source-version-a",
            title: "บทที่ 1",
            corpusRevision: "corpus-2026-09-18",
            section: "section-a",
            parentId: "parent-a",
            parentText: "parent context that is much too long",
          },
        },
      ],
    });
    mockedNamespace.mockReturnValue({ query: mockQuery });

    await expect(queryPinecone([0.1], 3)).resolves.toEqual([
      expect.objectContaining({
        parentText: "parent context t",
      }),
    ]);
  });

  it("rejects a match with missing source version metadata", async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      matches: [
        {
          id: "missing-version",
          score: 0.9,
          metadata: {
            text: "text",
            source: "part-1/chapter-1",
            title: "บทที่ 1",
            corpusRevision: "corpus-2026-09-18",
          },
        },
      ],
    });
    mockedNamespace.mockReturnValue({ query: mockQuery });

    await expect(queryPinecone([0.1], 5)).resolves.toEqual([]);
  });
  it("rejects stale and forged metadata from the shared parity fixture", async () => {
    const fixture = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "../../tests/fixtures/retrieval-parity.json"),
        "utf8",
      ),
    ) as {
      invalidMatches: Array<{
        id: string;
        score: number;
        metadata: Record<string, unknown>;
      }>;
    };
    const mockQuery = vi.fn().mockResolvedValue({ matches: fixture.invalidMatches });
    mockedNamespace.mockReturnValue({ query: mockQuery });

    await expect(queryPinecone([0.1], 5)).resolves.toEqual([]);
  });
  it("rejects a response containing only malformed scores as unavailable", async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      matches: [
        {
          id: "malformed",
          score: Number.NaN,
          metadata: {
            text: "invalid score",
            source: "part-1/chapter-1",
            sourceVersion: "source-version-a",
            title: "บทที่ 1",
            corpusRevision: "corpus-2026-09-18",
          },
        },
      ],
    });
    mockedNamespace.mockReturnValue({ query: mockQuery });

    await expect(queryPinecone([0.1], 3)).rejects.toThrow(
      "Pinecone returned malformed scores",
    );
  });


  it("drops missing, stale, and mixed corpus revisions while retaining matching records", async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      matches: [
        {
          id: "matching",
          score: 0.95,
          metadata: {
            text: "matching text",
            source: "part-1/chapter-1",
            sourceVersion: "source-version-a",
            title: "บทที่ 1",
            corpusRevision: "corpus-2026-09-18",
          },
        },
        {
          id: "missing",
          score: 0.94,
          metadata: {
            text: "missing revision",
            source: "part-1/chapter-2",
            title: "บทที่ 2",
          },
        },
        {
          id: "stale",
          score: 0.93,
          metadata: {
            text: "stale revision",
            source: "part-1/chapter-3",
            title: "บทที่ 3",
            corpusRevision: "corpus-2026-09-17",
          },
        },
      ],
    });
    mockedNamespace.mockReturnValue({ query: mockQuery });

    await expect(queryPinecone([0.1], 3)).resolves.toEqual([
      {
        id: "matching",
        score: 0.95,
        text: "matching text",
        source: "part-1/chapter-1",
        sourceVersion: "source-version-a",
        title: "บทที่ 1",
      },
    ]);
  });

  it.each([
    ["missing metadata", null],
    [
      "blank text",
      {
        text: " ",
        source: "part-1/chapter-1",
        title: "บทที่ 1",
        corpusRevision: "corpus-2026-09-18",
      },
    ],
    [
      "blank source",
      {
        text: "text",
        source: "",
        title: "บทที่ 1",
        corpusRevision: "corpus-2026-09-18",
      },
    ],
    [
      "non-string title",
      {
        text: "text",
        source: "part-1/chapter-1",
        title: 1,
        corpusRevision: "corpus-2026-09-18",
      },
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
