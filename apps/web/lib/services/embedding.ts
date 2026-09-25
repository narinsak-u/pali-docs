import { LRUCache } from "lru-cache";
import { getPineconeClient } from "@/lib/pinecone";

const MODEL = "llama-text-embed-v2";
const INPUT_TYPE = "query" as const;
const CACHE_LIMIT = 100;
const CACHE_TTL_MS = 1000 * 60 * 60;

const embeddingCache = new LRUCache<string, number[]>({
  max: CACHE_LIMIT,
  ttl: CACHE_TTL_MS,
});

export async function generateQueryEmbedding(text: string): Promise<number[]> {
  const cacheKey = `${MODEL}:${INPUT_TYPE}:${text}`;
  const cached = embeddingCache.get(cacheKey);
  if (cached) return cached;

  const result = await getPineconeClient().inference.embed(MODEL, [text], {
    inputType: INPUT_TYPE,
    truncate: "END",
  });
  const embedding = result.data[0];
  if (!embedding || !("values" in embedding) || !Array.isArray(embedding.values)) {
    throw new Error("Pinecone query embedding response is missing vector values");
  }
  const values = embedding.values;
  embeddingCache.set(cacheKey, values);
  return values;
}
