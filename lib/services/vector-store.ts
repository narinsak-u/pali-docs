import { getRagConfig } from "@/lib/config/rag";
import { getPineconeIndex } from "@/lib/pinecone";
import type { GroundingPassage } from "@/lib/rag/types";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function queryPinecone(
  embedding: number[],
  topK: number = 10,
  signal?: AbortSignal,
): Promise<GroundingPassage[]> {
  const config = getRagConfig();

  // Pinecone SDK v6.1 QueryOptions has no AbortSignal support. Check as late
  // as possible before the paid query so cancellation prevents starting it.
  signal?.throwIfAborted();
  const results = await getPineconeIndex()
    .namespace(config.PINECONE_NAMESPACE)
    .query({
      vector: embedding,
      topK,
      includeMetadata: true,
    });

  return results.matches.flatMap((match): GroundingPassage[] => {
    const metadata = match.metadata;
    if (
      !isNonEmptyString(match.id) ||
      !metadata ||
      !isNonEmptyString(metadata.text) ||
      !isNonEmptyString(metadata.source) ||
      !isNonEmptyString(metadata.title) ||
      !isNonEmptyString(metadata.corpusRevision) ||
      metadata.corpusRevision !== config.PINECONE_CORPUS_REVISION
    ) {
      return [];
    }

    const section = isNonEmptyString(metadata.section)
      ? metadata.section
      : undefined;
    return [
      {
        id: match.id,
        score:
          typeof match.score === "number" && Number.isFinite(match.score)
            ? match.score
            : 0,
        text: metadata.text,
        source: metadata.source,
        title: metadata.title,
        ...(section === undefined ? {} : { section }),
      },
    ];
  });
}