import { getRagConfig } from "@/lib/config/rag";
import { generateQueryEmbedding } from "@/lib/services/embedding";
import { queryPinecone } from "@/lib/services/vector-store";
import { rerankCandidates, type Reranker } from "@/lib/rag/reranker";
import type {
  Citation,
  GroundingBundle,
  GroundingPassage,
  RetrievalRequest,
  RerankerFallbackReason,
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
  const sourceVersion = passage.sourceVersion
    ? ` source-version="${escapeXml(passage.sourceVersion)}"`
    : "";
  const section = passage.section
    ? ` section="${escapeXml(passage.section)}"`
    : "";
  const parentId = passage.parentId
    ? ` parent-id="${escapeXml(passage.parentId)}"`
    : "";
  return `<passage id="${escapeXml(passage.id)}" source="${escapeXml(passage.source)}"${sourceVersion} title="${escapeXml(passage.title)}"${section}${parentId}>\n${escapeXml(passage.text)}\n</passage>`;
}

async function rerankWithTimeout(
  query: string,
  candidates: GroundingPassage[],
  maxCandidates: number,
  timeoutMs: number,
  reranker: Reranker,
  signal?: AbortSignal,
): Promise<unknown> {
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
      reranker(query, candidates.slice(0, maxCandidates), maxCandidates, signal),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function addParentContext(passage: GroundingPassage): GroundingPassage {
  if (passage.parentText === undefined) return passage;
  return {
    ...passage,
    text: `${passage.parentText}\n\n${passage.text}`,
  };
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
    expanded.push(
      ...(groups.get(passage.parentId) ?? [passage]).map((candidate, index) =>
        index === 0 ? addParentContext(candidate) : candidate,
      ),
    );
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
    ...(passage.sourceVersion === undefined
      ? {}
      : { sourceVersion: passage.sourceVersion }),
    title: passage.title,
    ...(passage.section === undefined ? {} : { section: passage.section }),
    ...(passage.parentId === undefined ? {} : { parentId: passage.parentId }),
  };
}

function isRerankedPassage(value: unknown): value is GroundingPassage {
  if (
    value === null ||
    typeof value !== "object" ||
    !("id" in value) ||
    !("score" in value) ||
    !("text" in value) ||
    !("source" in value) ||
    !("title" in value)
  ) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.score === "number" &&
    Number.isFinite(value.score) &&
    typeof value.text === "string" &&
    typeof value.source === "string" &&
    typeof value.title === "string" &&
    (!("sourceVersion" in value) ||
      value.sourceVersion === undefined ||
      typeof value.sourceVersion === "string") &&
    (!("section" in value) ||
      value.section === undefined ||
      typeof value.section === "string") &&
    (!("parentId" in value) ||
      value.parentId === undefined ||
      typeof value.parentId === "string") &&
    (!("parentText" in value) ||
      value.parentText === undefined ||
      typeof value.parentText === "string")
  );
}

function isValidReranked(
  candidates: GroundingPassage[],
  reranked: unknown,
  maxCandidates: number,
): reranked is GroundingPassage[] {
  if (!Array.isArray(reranked) || !reranked.every(isRerankedPassage)) {
    return false;
  }
  const expectedCount = Math.min(candidates.length, maxCandidates);
  if (reranked.length !== expectedCount) return false;
  const candidateIds = new Set(candidates.map(({ id }) => id));
  const rerankedIds = reranked.map(({ id }) => id);
  if (
    new Set(rerankedIds).size !== expectedCount ||
    !rerankedIds.every((id) => candidateIds.has(id))
  ) {
    return false;
  }
  return reranked.every((rerankedPassage) => {
    const candidate = candidates.find(({ id }) => id === rerankedPassage.id);
    return (
      candidate !== undefined &&
      candidate.score === rerankedPassage.score &&
      candidate.text === rerankedPassage.text &&
      candidate.source === rerankedPassage.source &&
      candidate.sourceVersion === rerankedPassage.sourceVersion &&
      candidate.title === rerankedPassage.title &&
      candidate.section === rerankedPassage.section &&
      candidate.parentId === rerankedPassage.parentId &&
      candidate.parentText === rerankedPassage.parentText
    );
  });
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
  let rerankerFallbackReason: RerankerFallbackReason | null =
    config.RAG_RERANKER_ENABLED ? null : "disabled";
  let rerankerLatencyMs = 0;
  const rerankerModelVersion = config.RAG_RERANKER_ENABLED
    ? "lexical-v1"
    : undefined;
  const retrievalConfigVersion = "rag-v1";
  if (config.RAG_RERANKER_ENABLED) {
    const denseCandidates = candidates;
    const boundedCandidates = denseCandidates.slice(
      0,
      config.RAG_RERANKER_MAX_CANDIDATES,
    );
    const rerankerStartedAt = performance.now();
    try {
      const reranked = await rerankWithTimeout(
        query,
        boundedCandidates,
        config.RAG_RERANKER_MAX_CANDIDATES,
        config.RAG_RERANKER_TIMEOUT_MS,
        dependencies.rerankCandidates ?? rerankCandidates,
        signal,
      );
      signal?.throwIfAborted();
      rerankerLatencyMs = performance.now() - rerankerStartedAt;
      if (
        isValidReranked(
          boundedCandidates,
          reranked,
          config.RAG_RERANKER_MAX_CANDIDATES,
        )
      ) {
        const candidateById = new Map(
          boundedCandidates.map((candidate) => [candidate.id, candidate]),
        );
        candidates = [
          ...reranked.map((candidate) => candidateById.get(candidate.id)!),
          ...denseCandidates.slice(boundedCandidates.length),
        ];
        rerankerUsed = true;
      } else {
        rerankerFallbackReason = "invalid-output";
        candidates = denseCandidates;
      }
    } catch (error: unknown) {
      signal?.throwIfAborted();
      rerankerLatencyMs = performance.now() - rerankerStartedAt;
      const errorName =
        error !== null &&
        typeof error === "object" &&
        "name" in error &&
        typeof error.name === "string"
          ? error.name
          : undefined;
      rerankerFallbackReason =
        errorName === "AbortError"
          ? "cancelled"
          : error instanceof Error && error.message === "reranker timed out"
            ? "timeout"
            : "unavailable";
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
        rerankerFallbackReason,
        rerankerLatencyMs,
        ...(rerankerModelVersion === undefined ? {} : { rerankerModelVersion }),
        retrievalConfigVersion,
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
      rerankerFallbackReason,
      rerankerLatencyMs,
      ...(rerankerModelVersion === undefined ? {} : { rerankerModelVersion }),
      retrievalConfigVersion,
    },
  };
}
