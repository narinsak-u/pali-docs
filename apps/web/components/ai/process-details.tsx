import { TimelineRail } from "./timeline-rail";
import { ReasoningStep } from "./reasoning-step";
import { TaskStep } from "./task-step";
import type { StepDescriptor } from "./step-descriptor";
import type { ReasoningPart, TaskPart } from "@/lib/schemas/ai-data-parts";

export interface ProcessDetailsProps {
  steps: StepDescriptor[];
  reasoning: Array<{ summary: string; excerpts?: string[] }>;
  tasks: Array<{
    id?: string;
    label: string;
    status: "pending" | "running" | "done" | "error";
    query?: string;
    matchCount?: number;
    message?: string;
  }>;
}

export function ProcessDetails({ steps, reasoning, tasks }: ProcessDetailsProps) {
  return (
    <div className="flex gap-3" data-testid="process-details">
      <TimelineRail steps={steps} />
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        {reasoning.map((r, i) => (
          <ReasoningStep key={`r-${i}`} summary={r.summary} excerpts={r.excerpts} />
        ))}
        {tasks.map((t, i) => (
          <TaskStep
            key={`t-${i}`}
            label={t.label}
            status={t.status}
            query={t.query}
            matchCount={t.matchCount}
            message={t.message}
          />
        ))}
      </div>
    </div>
  );
}
