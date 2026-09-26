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

  let malformedScore = false;
  const passages = results.matches.flatMap((match): GroundingPassage[] => {
    const metadata = match.metadata;
    const source = isNonEmptyString(metadata?.source) ? metadata.source : undefined;
    const sourceVersion = isNonEmptyString(metadata?.sourceVersion)
      ? metadata.sourceVersion
      : undefined;
    const section = isNonEmptyString(metadata?.section)
      ? metadata.section
      : undefined;
    const parentId = isNonEmptyString(metadata?.parentId)
      ? metadata.parentId
      : undefined;
    const parentText = isNonEmptyString(metadata?.parentText)
      ? metadata.parentText.slice(0, config.RAG_MAX_PARENT_CONTEXT_CHARS)
      : undefined;
    if (
      !isNonEmptyString(match.id) ||
      !metadata ||
      !isNonEmptyString(metadata.text) ||
      source === undefined ||
      sourceVersion === undefined ||
      !isNonEmptyString(metadata.title) ||
      !isNonEmptyString(metadata.corpusRevision) ||
      metadata.corpusRevision !== config.PINECONE_CORPUS_REVISION ||
      (metadata.sourceId !== undefined &&
        (!isNonEmptyString(metadata.sourceId) || metadata.sourceId !== source))
    ) {
      return [];
    }

    if (
      typeof match.score !== "number" ||
      !Number.isFinite(match.score)
    ) {
      malformedScore = true;
      return [];
    }

    return [
      {
        id: match.id,
        score: match.score,
        text: metadata.text,
        source,
        sourceVersion,
        title: metadata.title,
        ...(section === undefined ? {} : { section }),
        ...(parentId === undefined ? {} : { parentId }),
        ...(parentText === undefined ? {} : { parentText }),
      },
    ];
  });

  if (malformedScore && passages.length === 0) {
    throw new Error("Pinecone returned malformed scores");
  }
  return passages;
}