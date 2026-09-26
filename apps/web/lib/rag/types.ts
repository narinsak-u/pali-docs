export interface RetrievalRequest {
  query: string;
  attempt: number;
}

export interface Citation {
  id: string;
  source: string;
  sourceVersion?: string;
  title: string;
  section?: string;
  parentId?: string;
}

export interface GroundingPassage extends Citation {
  text: string;
  score: number;
  parentText?: string;
}
export type RerankerFallbackReason =
  | "disabled"
  | "timeout"
  | "unavailable"
  | "invalid-output"
  | "cancelled";

export interface RetrievalMetrics {
  candidateCount: number;
  acceptedCount: number;
  hierarchyExpansion: boolean;
  rerankerUsed: boolean;
  rerankerFallbackReason?: RerankerFallbackReason | null;
  rerankerLatencyMs?: number;
  rerankerModelVersion?: string;
  retrievalConfigVersion?: string;
}

export type GroundingBundle =
  | {
      status: "grounded";
      query: string;
      corpusRevision: string;
      passages: GroundingPassage[];
      citations: Citation[];
      context: string;
      retrievalMetrics?: RetrievalMetrics;
    }
  | {
      status: "insufficient-evidence";
      query: string;
      corpusRevision: string;
      passages: [];
      citations: [];
      retrievalMetrics?: RetrievalMetrics;
    }
  | {
      status: "unavailable";
      query: string;
      corpusRevision: string;
      errorCode: "embedding_unavailable" | "vector_store_unavailable";
    };

export type GroundedBundle = Extract<
  GroundingBundle,
  { status: "grounded" }
>;
