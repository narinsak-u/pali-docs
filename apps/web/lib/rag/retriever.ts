import { getRagConfig } from "@/lib/config/rag";
import { generateQueryEmbedding } from "@/lib/services/embedding";
import { queryPinecone } from "@/lib/services/vector-store";
import { rerankCandidates, type Reranker } from "@/lib/rag/reranker";
import type {
  Citation,
  GroundingBundle,
  GroundingPassage,
  RetrievalRequest,
} from "@/lib/rag/types";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatPassage(passage: GroundingPassage): string {
  const section = passage.section
    ? ` section="${escapeXml(passage.section)}"`
    : "";
  return `<passage id="${escapeXml(passage.id)}" source="${escapeXml(passage.source)}" title="${escapeXml(passage.title)}"${section}>\n${escapeXml(passage.text)}\n</passage>`;
}

async function rerankWithTimeout(
  query: string,
  candidates: GroundingPassage[],
  maxCandidates: number,
  timeoutMs: number,
  reranker: Reranker,
  signal?: AbortSignal,
): Promise<GroundingPassage[]> {
  let timeoutReject: (reason?: unknown) => void = () => {};
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutReject = reject;
  });
  const timeout = setTimeout(
    () => timeoutReject(new Error("reranker timed out")),
    timeoutMs,
  );
  try {
    return await Promise.race([
      reranker(query, candidates, maxCandidates, signal),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function expandByParent(passages: GroundingPassage[]): GroundingPassage[] {
  const groups = new Map<string, GroundingPassage[]>();
  for (const passage of passages) {
    if (passage.parentId === undefined) continue;
    const group = groups.get(passage.parentId) ?? [];
    group.push(passage);
    groups.set(passage.parentId, group);
  }

  const expanded: GroundingPassage[] = [];
  const seenParents = new Set<string>();
  for (const passage of passages) {
    if (passage.parentId === undefined) {
      expanded.push(passage);
      continue;
    }
    if (seenParents.has(passage.parentId)) continue;
    seenParents.add(passage.parentId);
    expanded.push(...(groups.get(passage.parentId) ?? [passage]));
  }
  return expanded;
}

function selectPassages(
  candidates: GroundingPassage[],
  minScore: number,
  acceptedTopK: number,
  maxContextChars: number,
  corpusRevision: string,
  hierarchyExpansion: boolean,
  preserveOrder: boolean,
): { passages: GroundingPassage[]; context: string } | null {
  const ranked = candidates
    .map((passage, index) => ({ passage, index }))
    .filter(({ passage }) => passage.score >= minScore);
  if (!preserveOrder) {
    ranked.sort(
      (left, right) =>
        right.passage.score - left.passage.score || left.index - right.index,
    );
  }

  const unique: GroundingPassage[] = [];
  const seenIds = new Set<string>();
  for (const { passage } of ranked) {
    if (seenIds.has(passage.id)) continue;
    seenIds.add(passage.id);
    unique.push(passage);
  }

  const ordered = hierarchyExpansion ? expandByParent(unique) : unique;
  const header = `<retrieved-passages corpus-revision="${escapeXml(corpusRevision)}">`;
  const footer = "</retrieved-passages>";
  let contextLength = header.length + 1 + footer.length;
  const passages: GroundingPassage[] = [];
  const formattedPassages: string[] = [];

  for (const passage of ordered) {
    if (passages.length >= acceptedTopK) break;
    const formatted = formatPassage(passage);
    const separatorLength = 1;
    if (contextLength + separatorLength + formatted.length > maxContextChars) {
      break;
    }
    contextLength += separatorLength + formatted.length;
    passages.push(passage);
    formattedPassages.push(formatted);
  }

  if (passages.length === 0) return null;

  return {
    passages,
    context: `${header}\n${formattedPassages.join("\n")}\n${footer}`,
  };
}

function toCitation(passage: GroundingPassage): Citation {
  return {
    id: passage.id,
    source: passage.source,
    title: passage.title,
    ...(passage.section === undefined ? {} : { section: passage.section }),
  };
}

function isValidReranked(
  candidates: GroundingPassage[],
  reranked: GroundingPassage[],
  maxCandidates: number,
): boolean {
  const expectedCount = Math.min(candidates.length, maxCandidates);
  if (reranked.length !== expectedCount) return false;
  const candidateIds = new Set(candidates.map(({ id }) => id));
  const rerankedIds = reranked.map(({ id }) => id);
  return (
    new Set(rerankedIds).size === expectedCount &&
    rerankedIds.every((id) => candidateIds.has(id))
  );
}

export interface RetrievalDependencies {
  rerankCandidates?: Reranker;
}

export async function retrieve(
  request: RetrievalRequest,
  signal?: AbortSignal,
  dependencies: RetrievalDependencies = {},
): Promise<GroundingBundle> {
  const config = getRagConfig();
  const query = request.query.trim();

  if (query.length === 0) {
    return {
      status: "insufficient-evidence",
      query,
      corpusRevision: config.PINECONE_CORPUS_REVISION,
      passages: [],
      citations: [],
    };
  }

  let embedding: number[];
  try {
    signal?.throwIfAborted();
    embedding = await generateQueryEmbedding(query);
  } catch {
    signal?.throwIfAborted();
    return {
      status: "unavailable",
      query,
      corpusRevision: config.PINECONE_CORPUS_REVISION,
      errorCode: "embedding_unavailable",
    };
  }
  let candidates: GroundingPassage[];
  try {
    signal?.throwIfAborted();
    candidates = await queryPinecone(
      embedding,
      config.RAG_CANDIDATE_TOP_K,
      signal,
    );
  } catch {
    signal?.throwIfAborted();
    return {
      status: "unavailable",
      query,
      corpusRevision: config.PINECONE_CORPUS_REVISION,
      errorCode: "vector_store_unavailable",
    };
  }

  const candidateCount = candidates.length;
  let rerankerUsed = false;

  if (config.RAG_RERANKER_ENABLED) {
    const denseCandidates = candidates;
    try {
      const reranked = await rerankWithTimeout(
        query,
        denseCandidates,
        config.RAG_RERANKER_MAX_CANDIDATES,
        config.RAG_RERANKER_TIMEOUT_MS,
        dependencies.rerankCandidates ?? rerankCandidates,
        signal,
      );
      if (
        isValidReranked(
          denseCandidates,
          reranked,
          config.RAG_RERANKER_MAX_CANDIDATES,
        )
      ) {
        candidates = reranked;
        rerankerUsed = true;
      } else {
        candidates = denseCandidates;
      }
    } catch {
      signal?.throwIfAborted();
      candidates = denseCandidates;
    }
  }

  const selected = selectPassages(
    candidates,
    config.RAG_MIN_SCORE,
    config.RAG_ACCEPTED_TOP_K,
    config.RAG_MAX_CONTEXT_CHARS,
    config.PINECONE_CORPUS_REVISION,
    config.RAG_HIERARCHY_EXPANSION,
    rerankerUsed,
  );

  if (!selected) {
    return {
      status: "insufficient-evidence",
      query,
      corpusRevision: config.PINECONE_CORPUS_REVISION,
      passages: [],
      citations: [],
      retrievalMetrics: {
        candidateCount,
        acceptedCount: 0,
        hierarchyExpansion: config.RAG_HIERARCHY_EXPANSION,
        rerankerUsed,
      },
    };
  }

  return {
    status: "grounded",
    query,
    corpusRevision: config.PINECONE_CORPUS_REVISION,
    passages: selected.passages,
    citations: selected.passages.map(toCitation),
    context: selected.context,
    retrievalMetrics: {
      candidateCount,
      acceptedCount: selected.passages.length,
      hierarchyExpansion: config.RAG_HIERARCHY_EXPANSION,
      rerankerUsed,
    },
  };
}
