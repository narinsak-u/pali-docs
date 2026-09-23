"use client";

import { Loader2, Search, FileQuestion } from "lucide-react";
import type { QuizPhase } from "@/lib/hooks/use-quiz-ai";
import { cn } from "@/lib/utils";

const PHASE_CONFIG: Record<
  QuizPhase,
  { icon: typeof Search; label: string; pulse: boolean } | null
> = {
  idle: null,
  searching: {
    icon: Search,
    label: "กำลังค้นหาเนื้อหา...",
    pulse: false,
  },
  generating: {
    icon: FileQuestion,
    label: "กำลังสร้างคำถาม...",
    pulse: false,
  },
  done: null,
  error: null,
};

export function QuizStatus({ phase }: { phase: QuizPhase }) {
  const config = PHASE_CONFIG[phase];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 py-2 px-4 text-sm text-muted-foreground",
        "animate-in fade-in slide-in-from-top-2 duration-300",
      )}
    >
      <div className="flex items-center gap-2 rounded-full border bg-card px-4 py-1.5 shadow-sm">
        <div className="relative">
          <Icon className="size-4 text-primary" />
          <Loader2 className="size-3 absolute -right-0.5 -bottom-0.5 animate-spin text-primary" />
        </div>
        <span>{config.label}</span>
      </div>
    </div>
  );
}
