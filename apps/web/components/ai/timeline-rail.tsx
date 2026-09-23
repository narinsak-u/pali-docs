import { cn } from "@/lib/utils";
import type { StepDescriptor, StepKind, StepStatus } from "./step-descriptor";

const KIND_CLASS: Record<StepKind, string> = {
  reasoning: "bg-purple-100 text-purple-700 border-purple-300",
  task: "bg-amber-100 text-amber-700 border-amber-300",
  response: "bg-blue-100 text-blue-700 border-blue-300",
  suggestions: "bg-emerald-100 text-emerald-700 border-emerald-300",
};

const KIND_DARK: Record<StepKind, string> = {
  reasoning: "dark:bg-purple-950 dark:text-purple-300 dark:border-purple-700",
  task: "dark:bg-amber-950 dark:text-amber-300 dark:border-amber-700",
  response: "dark:bg-blue-950 dark:text-blue-300 dark:border-blue-700",
  suggestions: "dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-700",
};

const STATUS_CLASS: Record<StepStatus, string> = {
  pending: "opacity-50",
  running: "animate-pulse ring-2 ring-current",
  done: "",
  error: "bg-red-100 text-red-700 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-700",
};

const GLYPH: Record<StepKind, string> = {
  reasoning: "?",
  task: "\u2699",
  response: "A",
  suggestions: "\u2192",
};

export function TimelineRail({ steps }: { steps: StepDescriptor[] }) {
  return (
    <div
      className="flex flex-col items-center gap-0 pt-2"
      data-testid="timeline-rail"
      aria-hidden="true"
    >
      {steps.map((step, i) => (
        <div key={step.id} className="flex flex-col items-center">
          <div
            data-testid="timeline-node"
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold",
              KIND_CLASS[step.kind],
              KIND_DARK[step.kind],
              STATUS_CLASS[step.status],
            )}
            title={`${step.label} · ${step.status}`}
          >
            {GLYPH[step.kind]}
          </div>
          {i < steps.length - 1 && (
            <div className="w-px h-6 bg-border" />
          )}
        </div>
      ))}
    </div>
  );
}
