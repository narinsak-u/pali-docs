import type { UIMessageChunk } from "ai";
import type { AgentEvent, AgentEventSink } from "@/lib/agent/types";
import {
  citationsPartSchema,
  outcomePartSchema,
  reasoningPartSchema,
  statusPartSchema,
  suggestionsPartSchema,
  taskPartSchema,
  type CitationsPart,
  type OutcomePart,
  type ReasoningPart,
  type StatusPart,
  type SuggestionsPart,
  type TaskPart,
} from "@/lib/schemas/ai-data-parts";

type AgentUiDataPart =
  | { type: "data-status"; data: StatusPart }
  | { type: "data-task"; data: TaskPart }
  | { type: "data-reasoning"; data: ReasoningPart }
  | { type: "data-citations"; data: CitationsPart }
  | { type: "data-suggestions"; data: SuggestionsPart }
  | { type: "data-outcome"; data: OutcomePart };

type AgentUiTextPart = Extract<
  UIMessageChunk,
  { type: "text-start" | "text-delta" | "text-end" }
>;

type AgentUiChunk = AgentUiDataPart | AgentUiTextPart;

interface AgentUiWriter {
  write(part: AgentUiChunk): void;
}

const RETRIEVAL_LABEL = "ค้นหาเอกสาร";

function retrievalTaskId(runId: string, attempt: number): string {
  return `${runId}:retrieval:${attempt}`;
}

function answerTextId(runId: string): string {
  return `${runId}:answer`;
}

export function createAiSdkEventSink(writer: AgentUiWriter): AgentEventSink {
  const activeRetrievalAttempts = new Map<string, number>();
  let terminated = false;

  function emit(event: AgentEvent): void {
    if (terminated) {
      throw new Error("Agent event stream has already terminated");
    }

    switch (event.type) {
      case "run.started":
        writer.write({
          type: "data-status",
          data: statusPartSchema.parse({ phase: "thinking" }),
        });
        break;
      case "query.rewritten":
        writer.write({
          type: "data-reasoning",
          data: reasoningPartSchema.parse({
            summary: "ปรับคำค้นหาเพื่อค้นหาอีกครั้ง",
          }),
        });
        break;
      case "retrieval.started":
        activeRetrievalAttempts.set(event.runId, event.attempt);
        writer.write({
          type: "data-status",
          data: statusPartSchema.parse({ phase: "searching" }),
        });
        writer.write({
          type: "data-task",
          data: taskPartSchema.parse({
            id: retrievalTaskId(event.runId, event.attempt),
            label: RETRIEVAL_LABEL,
            status: "running",
            query: event.query,
          }),
        });
        break;
      case "retrieval.completed":
        writer.write({
          type: "data-task",
          data: taskPartSchema.parse({
            id: retrievalTaskId(event.runId, event.attempt),
            label: RETRIEVAL_LABEL,
            status: "done",
            matchCount: event.matchCount,
          }),
        });
        writer.write({
          type: "data-reasoning",
          data: reasoningPartSchema.parse({
            summary: `พบเอกสารที่เกี่ยวข้อง ${event.matchCount} รายการ`,
          }),
        });
        activeRetrievalAttempts.delete(event.runId);
        break;
      case "retrieval.failed": {
        const attempt = activeRetrievalAttempts.get(event.runId);
        if (attempt === undefined) {
          throw new Error("retrieval.failed requires an active retrieval attempt");
        }
        writer.write({
          type: "data-task",
          data: taskPartSchema.parse({
            id: retrievalTaskId(event.runId, attempt),
            label: RETRIEVAL_LABEL,
            status: "error",
            message: event.code,
          }),
        });
        activeRetrievalAttempts.delete(event.runId);
        break;
      }
      case "generation.started":
        writer.write({
          type: "data-status",
          data: statusPartSchema.parse({ phase: "answering" }),
        });
        break;
      case "answer.completed": {
        const id = answerTextId(event.runId);
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: event.text });
        writer.write({ type: "text-end", id });
        break;
      }
      case "citations.completed":
        writer.write({
          type: "data-citations",
          data: citationsPartSchema.parse({ citations: event.citations }),
        });
        break;
      case "suggestions.completed":
        writer.write({
          type: "data-suggestions",
          data: suggestionsPartSchema.parse({ suggestions: event.suggestions }),
        });
        break;
      case "run.completed":
        writer.write({
          type: "data-outcome",
          data: outcomePartSchema.parse({ outcome: event.outcome }),
        });
        break;
      case "run.failed":
        writer.write({
          type: "data-outcome",
          data: outcomePartSchema.parse({ outcome: "failed", code: event.code }),
        });
        break;
    }

    if (event.type === "run.completed" || event.type === "run.failed") {
      terminated = true;
    }
  }

  return { emit };
}
