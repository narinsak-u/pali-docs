import { cn } from "@/lib/utils";
import { TimelineRail } from "./timeline-rail";
import { ReasoningStep } from "./reasoning-step";
import { TaskStep } from "./task-step";
import type { StepDescriptor } from "./step-descriptor";
import type { ReasoningPart, TaskPart } from "@/lib/schemas/ai-data-parts";

export interface ProcessStepsInlineProps {
  steps: StepDescriptor[];
  reasoning: Array<{ type: "data-reasoning"; data: ReasoningPart }>;
  tasks: Array<{ type: "data-task"; data: TaskPart }>;
  isDone: boolean;
}

export function ProcessStepsInline({
  steps,
  reasoning,
  tasks,
  isDone,
}: ProcessStepsInlineProps) {
  if (steps.length === 0) return null;
  return (
    <div
      data-testid="process-steps"
      className={cn(
        "overflow-hidden transition-all duration-[400ms] ease-out",
        isDone ? "max-h-0 opacity-0" : "max-h-[1500px] opacity-100",
      )}
    >
      <div className="flex gap-3 py-2">
        <TimelineRail steps={steps} />
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          {reasoning.map((p, i) => (
            <ReasoningStep key={`r-${i}`} summary={p.data.summary} excerpts={p.data.excerpts} />
          ))}
          {tasks.map((t, i) => (
            <TaskStep
              key={`t-${i}`}
              label={t.data.label}
              status={t.data.status}
              query={t.data.query}
              matchCount={t.data.matchCount}
              message={t.data.message}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
