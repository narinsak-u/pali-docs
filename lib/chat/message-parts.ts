import type { UIMessage } from "ai";
import {
  type CitationsPart,
  type OutcomePart,
  type QuestionPart,
  type ReasoningPart,
  type StatusPart,
  type SuggestionsPart,
  type TaskPart,
} from "@/lib/schemas/ai-data-parts";

type DataPart =
  | { type: "data-status"; data: StatusPart }
  | { type: "data-reasoning"; data: ReasoningPart }
  | { type: "data-task"; data: TaskPart }
  | { type: "data-suggestions"; data: SuggestionsPart }
  | { type: "data-citations"; data: CitationsPart }
  | { type: "data-outcome"; data: OutcomePart }
  | { type: "data-question"; data: QuestionPart };

function isDataPart(p: UIMessage["parts"][number]): p is DataPart {
  return (
    p.type === "data-status" ||
    p.type === "data-reasoning" ||
    p.type === "data-task" ||
    p.type === "data-suggestions" ||
    p.type === "data-citations" ||
    p.type === "data-outcome" ||
    p.type === "data-question"
  );
}

export { isDataPart };
