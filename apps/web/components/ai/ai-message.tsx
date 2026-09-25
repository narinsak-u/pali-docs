"use client";

import type { UIMessage } from "ai";
import type { StepDescriptor } from "./step-descriptor";
import { CitationList } from "./citation-list";
import { ResponseStep } from "./response-step";
import { SuggestionStep } from "./suggestion-step";
import { ProcessBadge } from "./process-badge";
import { ProcessDetails } from "./process-details";
import { ProcessStepsInline } from "./process-steps-inline";
import {
  citationsPartSchema,
  outcomePartSchema,
  reasoningPartSchema,
  suggestionsPartSchema,
  taskPartSchema,
  type CitationsPart,
  type OutcomePart,
  type ReasoningPart,
  type SuggestionsPart,
} from "@/lib/schemas/ai-data-parts";
import { reduceTaskParts, type DataTaskPart } from "@/lib/chat/reduce-task-parts";

function terminalOutcomeMessage(outcome: OutcomePart): string | null {
  switch (outcome.outcome) {
    case "insufficient-evidence":
      return "ไม่พบหลักฐานเพียงพอในเอกสารเพื่อสร้างคำตอบ";
    case "retrieval-unavailable":
      return "ไม่สามารถค้นหาเอกสารได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง";
    case "failed":
      return outcome.code === "aborted"
        ? null
        : "เกิดข้อผิดพลาดในการสร้างคำตอบ กรุณาลองใหม่อีกครั้ง";
    case "answered":
      return null;
  }
}

export function AIMessage({
  message,
  consumedSuggestionMsgIds,
  onSelectSuggestion,
}: {
  message: UIMessage;
  consumedSuggestionMsgIds?: Set<string>;
  onSelectSuggestion: (text: string) => void;
}) {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const text = parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");

  const reasoningParts: Array<{
    type: "data-reasoning";
    data: ReasoningPart;
  }> = [];
  const suggestionParts: Array<{
    type: "data-suggestions";
    data: SuggestionsPart;
  }> = [];
  const citationParts: Array<{
    type: "data-citations";
    data: CitationsPart;
  }> = [];
  const rawTaskParts: DataTaskPart[] = [];
  let terminalOutcome: OutcomePart | null = null;

  for (const part of parts) {
    if (!("data" in part)) continue;

    if (part.type === "data-reasoning") {
      const parsed = reasoningPartSchema.safeParse(part.data);
      if (parsed.success) {
        reasoningParts.push({ type: "data-reasoning", data: parsed.data });
      }
    } else if (part.type === "data-task") {
      const parsed = taskPartSchema.safeParse(part.data);
      if (parsed.success) {
        rawTaskParts.push({ type: "data-task", data: parsed.data });
      }
    } else if (part.type === "data-suggestions") {
      const parsed = suggestionsPartSchema.safeParse(part.data);
      if (parsed.success) {
        suggestionParts.push({ type: "data-suggestions", data: parsed.data });
      }
    } else if (part.type === "data-citations") {
      const parsed = citationsPartSchema.safeParse(part.data);
      if (parsed.success) {
        citationParts.push({ type: "data-citations", data: parsed.data });
      }
    } else if (part.type === "data-outcome") {
      const parsed = outcomePartSchema.safeParse(part.data);
      if (parsed.success) terminalOutcome = parsed.data;
    }
  }

  const taskPartsLatest = reduceTaskParts(rawTaskParts);
  const citations = citationParts.flatMap((part) => part.data.citations);
  const terminalMessage = terminalOutcome
    ? terminalOutcomeMessage(terminalOutcome)
    : null;

  const processSteps: StepDescriptor[] = [
    ...reasoningParts.map((_, index) => ({
      id: `reasoning-${index}`,
      kind: "reasoning" as const,
      status: "done" as const,
      label: "Reasoning",
    })),
    ...taskPartsLatest.map((task) => ({
      id: task.data.id ? `task-${task.data.id}` : `task-${task.data.label}`,
      kind: "task" as const,
      status: task.data.status,
      label: task.data.label,
    })),
  ];

  const lastTaskStatus = taskPartsLatest.at(-1)?.data.status;
  const isDone =
    suggestionParts.length > 0 ||
    (text.length > 0 &&
      (lastTaskStatus === "done" ||
        lastTaskStatus === "error" ||
        taskPartsLatest.length === 0));

  const totalMatches = taskPartsLatest.reduce(
    (sum, task) => sum + (task.data.matchCount ?? 0),
    0,
  );
  const hasProcess = processSteps.length > 0;
  const badgeLabel = hasProcess
    ? totalMatches > 0
      ? `ใช้เอกสาร ${totalMatches} รายการ`
      : "ขั้นตอนการคิด"
    : null;

  return (
    <div className="flex flex-col gap-2 w-full" data-testid="ai-message">
      <ProcessStepsInline
        steps={processSteps}
        reasoning={reasoningParts}
        tasks={taskPartsLatest}
        isDone={isDone}
      />
      {text && <ResponseStep text={text} isStreaming={false} />}
      <CitationList citations={citations} />
      {terminalMessage && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
        >
          {terminalMessage}
        </div>
      )}

      {badgeLabel && (
        <ProcessBadge label={badgeLabel}>
          <ProcessDetails
            steps={processSteps}
            reasoning={reasoningParts.map((part) => part.data)}
            tasks={taskPartsLatest.map((task) => task.data)}
          />
        </ProcessBadge>
      )}

      {!consumedSuggestionMsgIds?.has(message.id) &&
        suggestionParts.map((part, index) => (
          <SuggestionStep
            key={`s-${index}`}
            suggestions={part.data.suggestions}
            onSelect={onSelectSuggestion}
          />
        ))}
    </div>
  );
}
