import type { GroundingPassage } from "@/lib/rag/types";

export type Reranker = (
  query: string,
  candidates: GroundingPassage[],
  maxCandidates: number,
  signal?: AbortSignal,
) => Promise<GroundingPassage[]>;

function terms(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

export async function rerankCandidates(
  query: string,
  candidates: GroundingPassage[],
  maxCandidates: number,
  signal?: AbortSignal,
): Promise<GroundingPassage[]> {
  signal?.throwIfAborted();
  const bounded = candidates.slice(0, maxCandidates);
  const queryTerms = terms(query);

  return bounded
    .map((passage, index) => {
      const passageTerms = terms(passage.text);
      const overlap = [...queryTerms].filter((term) => passageTerms.has(term)).length;
      return { passage, index, overlap };
    })
    .sort(
      (left, right) =>
        right.overlap - left.overlap ||
        right.passage.score - left.passage.score ||
        left.index - right.index,
    )
    .map(({ passage }) => passage);
}
