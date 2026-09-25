"use client";

import type { UIMessage } from "ai";
import { AlertCircle, RefreshCw } from "lucide-react";

import { ProcessStepsInline } from "@/components/ai/process-steps-inline";
import { ProcessBadge } from "@/components/ai/process-badge";
import { ProcessDetails } from "@/components/ai/process-details";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { reduceTaskParts, type DataTaskPart } from "@/lib/chat/reduce-task-parts";
import type { ReasoningPart, TaskPart } from "@/lib/schemas/ai-data-parts";

export interface QuizProcessProps {
  messages: UIMessage[];
  isStreaming: boolean;
  matchCount: number;
  error: Error | null;
  onRetry?: () => void;
  mode: "full" | "badge-only";
}

export function QuizProcess({
  messages,
  isStreaming,
  matchCount,
  error,
  onRetry,
  mode,
}: QuizProcessProps) {
  const reasoningParts: Array<{ type: "data-reasoning"; data: ReasoningPart }> = [];
  const rawTaskParts: DataTaskPart[] = [];

  for (const m of messages) {
    for (const p of m.parts ?? []) {
      if (p.type === "data-reasoning") {
        reasoningParts.push(p as { type: "data-reasoning"; data: ReasoningPart });
      } else if (p.type === "data-task") {
        rawTaskParts.push(p as DataTaskPart);
      }
    }
  }

  const taskPartsLatest: DataTaskPart[] = reduceTaskParts(rawTaskParts);

  const lastTaskStatus = taskPartsLatest.at(-1)?.data.status as TaskPart["status"] | undefined;
  const isDone =
    !isStreaming &&
    (lastTaskStatus === "done" || lastTaskStatus === "error" || taskPartsLatest.length === 0);

  const hasProcess = taskPartsLatest.length > 0 || reasoningParts.length > 0;
  const badgeLabel = error
    ? "เกิดข้อผิดพลาด"
    : matchCount > 0
      ? `ใช้เอกสาร ${matchCount} รายการ`
      : hasProcess
        ? "ขั้นตอนการคิด"
        : null;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertCircle className="size-12 text-red-500" />
        <h2 className="text-2xl font-bold text-red-600">เกิดข้อผิดพลาด</h2>
        <p className="text-muted-foreground">{error.message}</p>
        {onRetry && (
          <Button onClick={onRetry} variant="outline" className="gap-2">
            <RefreshCw className="size-4" />
            ลองอีกครั้ง
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", mode === "full" ? "p-6" : "")}>
      {mode === "full" && (
        <ProcessStepsInline
          steps={taskPartsLatest.map((t) => ({
            id: `task-${t.data.id ?? t.data.label}`,
            kind: "task" as const,
            status: t.data.status,
            label: t.data.label,
          }))}
          reasoning={reasoningParts}
          tasks={taskPartsLatest}
          isDone={isDone}
        />
      )}

      {badgeLabel && (
        <ProcessBadge label={badgeLabel}>
          <ProcessDetails
            steps={taskPartsLatest.map((t) => ({
              id: `task-${t.data.id ?? t.data.label}`,
              kind: "task" as const,
              status: t.data.status,
              label: t.data.label,
            }))}
            reasoning={reasoningParts.map((p) => p.data)}
            tasks={taskPartsLatest.map((t) => t.data)}
          />
        </ProcessBadge>
      )}
    </div>
  );
}
