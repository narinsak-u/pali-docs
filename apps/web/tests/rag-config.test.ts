import { describe, expect, it } from "vitest";
import { getRagConfig } from "@/lib/config/rag";

describe("RAG configuration safety", () => {
  it("falls back to dense retrieval defaults for invalid quality settings", () => {
    const config = getRagConfig({
      PINECONE_API_KEY: "key",
      PINECONE_INDEX_NAME: "index",
      PINECONE_CORPUS_REVISION: "corpus-1",
      RAG_HIERARCHY_EXPANSION: "invalid",
      RAG_RERANKER_ENABLED: "invalid",
      RAG_RERANKER_MAX_CANDIDATES: "invalid",
      RAG_RERANKER_TIMEOUT_MS: "invalid",
      RAG_CANDIDATE_TOP_K: "invalid",
    });

    expect(config.RAG_HIERARCHY_EXPANSION).toBe(false);
    expect(config.RAG_RERANKER_ENABLED).toBe(false);
    expect(config.RAG_CANDIDATE_TOP_K).toBe(20);
    expect(config.RAG_RERANKER_MAX_CANDIDATES).toBe(20);
    expect(config.RAG_RERANKER_TIMEOUT_MS).toBe(100);
  });
});
