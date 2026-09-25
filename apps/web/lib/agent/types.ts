import type { Citation } from "@/lib/rag/types";
import type { SafeQuestionRequest } from "@/lib/schemas/question-request";

export type AgentTurnOutcome =
  | "answered"
  | "insufficient-evidence"
  | "retrieval-unavailable"
  | "failed";

export interface AgentTurnInput {
  runId: string;
  messages: SafeQuestionRequest["messages"];
}

export type AgentTurnResult =
  | {
      outcome: "answered";
      answer: string;
      citations: Citation[];
      suggestions: string[];
    }
  | {
      outcome: Exclude<AgentTurnOutcome, "answered">;
      code?: string;
    };

export type AgentEvent =
  | { type: "run.started"; runId: string }
  | {
      type: "retrieval.started";
      runId: string;
      attempt: number;
      query: string;
    }
  | {
      type: "retrieval.completed";
      runId: string;
      attempt: number;
      matchCount: number;
      acceptedSourceIds?: string[];
      candidateCount?: number;
      acceptedCount?: number;
      hierarchyExpansion?: boolean;
      rerankerUsed?: boolean;
    }
  | { type: "retrieval.failed"; runId: string; code: string }
  | {
      type: "query.rewritten";
      runId: string;
      attempt: number;
      query: string;
    }
  | { type: "generation.started"; runId: string }
  | { type: "answer.completed"; runId: string; text: string }
  | {
      type: "citations.completed";
      runId: string;
      citations: Citation[];
    }
  | {
      type: "suggestions.completed";
      runId: string;
      suggestions: string[];
    }
  | {
      type: "run.completed";
      runId: string;
      outcome: AgentTurnOutcome;
    }
  | { type: "run.failed"; runId: string; code: string };

export interface AgentEventSink {
  emit(event: AgentEvent): void;
}

export interface AgentTurnRunner {
  runTurn(
    input: AgentTurnInput,
    sink: AgentEventSink,
    signal?: AbortSignal,
  ): Promise<AgentTurnResult>;
}
