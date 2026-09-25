export interface RetrievalRequest {
  query: string;
  attempt: number;
}

export interface Citation {
  id: string;
  source: string;
  title: string;
  section?: string;
}

export interface GroundingPassage extends Citation {
  text: string;
  score: number;
  parentId?: string;
  parentText?: string;
}

export interface RetrievalMetrics {
  candidateCount: number;
  acceptedCount: number;
  hierarchyExpansion: boolean;
  rerankerUsed: boolean;
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
