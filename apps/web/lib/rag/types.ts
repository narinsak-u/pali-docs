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
}

export type GroundingBundle =
  | {
      status: "grounded";
      query: string;
      corpusRevision: string;
      passages: GroundingPassage[];
      citations: Citation[];
      context: string;
    }
  | {
      status: "insufficient-evidence";
      query: string;
      corpusRevision: string;
      passages: [];
      citations: [];
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
