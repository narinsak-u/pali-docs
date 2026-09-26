import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedConfig = vi.hoisted(() => ({
  PINECONE_CORPUS_REVISION: "parity-test-revision",
  RAG_CANDIDATE_TOP_K: 4,
  RAG_ACCEPTED_TOP_K: 4,
  RAG_MIN_SCORE: 0.7,
  RAG_HIERARCHY_EXPANSION: false,
  RAG_RERANKER_ENABLED: false,
  RAG_RERANKER_MAX_CANDIDATES: 2,
  RAG_RERANKER_TIMEOUT_MS: 100,
  RAG_MAX_CONTEXT_CHARS: 2_000,
  RAG_MAX_PARENT_CONTEXT_CHARS: 24,
}));

vi.mock("@/lib/config/rag", () => ({
  getRagConfig: vi.fn(() => mockedConfig),
}));
vi.mock("@/lib/services/embedding", () => ({
  generateQueryEmbedding: vi.fn(),
}));
vi.mock("@/lib/services/vector-store", () => ({
  queryPinecone: vi.fn(),
}));

import { generateQueryEmbedding } from "@/lib/services/embedding";
import { retrieve } from "@/lib/rag/retriever";
import type { GroundingPassage } from "@/lib/rag/types";
import { queryPinecone } from "@/lib/services/vector-store";

type ParityMatch = {
  id: string;
  score: number;
  metadata: {
    text: string;
    source: string;
    sourceId: string;
    sourceVersion: string;
    title: string;
    corpusRevision: string;
    section?: string;
    parentId?: string;
    parentText?: string;
  };
};

type ParityFixture = {
  corpusRevision: string;
  maxParentContextChars: number;
  denseMatches: ParityMatch[];
  invalidMatches: ParityMatch[];
  rerankedPrefixIds: string[];
  expected: {
    denseIds: string[];
    rerankedIds: string[];
    expandedIds: string[];
    fallbackReason: string;
    boundedParentText: string;
    citationIds: string[];
    metrics: Record<string, unknown>;
  };
};

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "../../tests/fixtures/retrieval-parity.json"), "utf8"),
) as ParityFixture;
const mockedEmbed = vi.mocked(generateQueryEmbedding);
const mockedQuery = vi.mocked(queryPinecone);

function passagesFromFixture(matches: ParityMatch[]): GroundingPassage[] {
  return matches.map(({ id, score, metadata }) => ({
    id,
    score,
    text: metadata.text,
    source: metadata.source,
    sourceVersion: metadata.sourceVersion,
    title: metadata.title,
    ...(metadata.section === undefined ? {} : { section: metadata.section }),
    ...(metadata.parentId === undefined ? {} : { parentId: metadata.parentId }),
    ...(metadata.parentText === undefined ? {} : { parentText: metadata.parentText }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mockedConfig, {
    PINECONE_CORPUS_REVISION: fixture.corpusRevision,
    RAG_CANDIDATE_TOP_K: fixture.denseMatches.length,
    RAG_ACCEPTED_TOP_K: fixture.denseMatches.length,
    RAG_MIN_SCORE: 0.7,
    RAG_HIERARCHY_EXPANSION: false,
    RAG_RERANKER_ENABLED: false,
    RAG_RERANKER_MAX_CANDIDATES: fixture.rerankedPrefixIds.length,
    RAG_RERANKER_TIMEOUT_MS: 100,
    RAG_MAX_CONTEXT_CHARS: 2_000,
    RAG_MAX_PARENT_CONTEXT_CHARS: fixture.maxParentContextChars,
  });
  mockedEmbed.mockResolvedValue([0.1, 0.2]);
  mockedQuery.mockResolvedValue(passagesFromFixture(fixture.denseMatches));
});

describe("shared retrieval parity fixture", () => {
  it("preserves hierarchy expansion, bounded parent context, and child citation projection", async () => {
    Object.assign(mockedConfig, { RAG_HIERARCHY_EXPANSION: true });

    const result = await retrieve({ query: "parity", attempt: 1 });

    expect(result.status).toBe("grounded");
    if (result.status !== "grounded") return;
    expect(result.passages.map(({ id }) => id)).toEqual(fixture.expected.expandedIds);
    expect(result.passages[0]?.parentText).toBe(fixture.expected.boundedParentText);
    expect(result.citations.map(({ id }) => id)).toEqual(fixture.expected.citationIds);
    expect(result.citations.map(({ id }) => id)).not.toContain("parent-1");
    expect(result.context.length).toBeLessThanOrEqual(mockedConfig.RAG_MAX_CONTEXT_CHARS);
  });

  it("keeps the dense suffix when the reranker returns a reordered prefix", async () => {
    Object.assign(mockedConfig, { RAG_RERANKER_ENABLED: true });
    const dense = passagesFromFixture(fixture.denseMatches);

    const result = await retrieve(
      { query: "parity", attempt: 1 },
      undefined,
      {
        rerankCandidates: vi.fn(async () =>
          fixture.rerankedPrefixIds.map(
            (id) => dense.find((passage) => passage.id === id) as GroundingPassage,
          ),
        ),
      },
    );

    expect(result.status).toBe("grounded");
    if (result.status !== "grounded") return;
    expect(result.passages.map(({ id }) => id)).toEqual(fixture.expected.rerankedIds);
    expect(result.passages.slice(fixture.rerankedPrefixIds.length)).toEqual(
      dense.slice(fixture.rerankedPrefixIds.length),
    );
  });


  it("falls back to dense order and serializes fallback metrics after reranker failure", async () => {
    Object.assign(mockedConfig, { RAG_RERANKER_ENABLED: true, RAG_HIERARCHY_EXPANSION: true });

    const result = await retrieve(
      { query: "parity", attempt: 1 },
      undefined,
      {
        rerankCandidates: vi.fn(async () => {
          throw new Error("provider unavailable");
        }),
      },
    );

    expect(result.status).toBe("grounded");
    if (result.status !== "grounded") return;
    expect(result.passages.map(({ id }) => id)).toEqual(fixture.expected.denseIds);
    expect(result.retrievalMetrics).toMatchObject({
      ...fixture.expected.metrics,
      rerankerFallbackReason: fixture.expected.fallbackReason,
    });
    expect(JSON.parse(JSON.stringify(result.retrievalMetrics))).toMatchObject(
      fixture.expected.metrics,
    );
  });
});
