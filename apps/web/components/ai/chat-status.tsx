"use client";

import { Loader2, Search, Brain, MessageSquare } from "lucide-react";
import type { ChatPhase } from "@/hooks/use-ai-chat";
import { cn } from "@/lib/utils";

const PHASE_CONFIG: Record<
  ChatPhase,
  { icon: typeof Brain; label: string; pulse: boolean }
> = {
  idle: { icon: Brain, label: "", pulse: false },
  thinking: { icon: Brain, label: "กำลังคิด...", pulse: true },
  searching: { icon: Search, label: "กำลังค้นหาเนื้อหา...", pulse: false },
  answering: {
    icon: MessageSquare,
    label: "กำลังเรียบเรียงคำตอบ...",
    pulse: false,
  },
  done: { icon: MessageSquare, label: "", pulse: false },
};

export function ChatStatus({ phase }: { phase: ChatPhase }) {
  if (phase === "idle" || phase === "done") return null;

  const config = PHASE_CONFIG[phase];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 py-2 px-4 text-sm text-muted-foreground",
        "animate-in fade-in slide-in-from-top-2 duration-300",
      )}
    >
      <div className="flex items-center gap-2 rounded-full border bg-card px-4 py-1.5 shadow-sm">
        {config.pulse ? (
          <Icon className="size-4 text-primary animate-pulse" />
        ) : (
          <div className="relative">
            <Icon className="size-4 text-primary" />
            <Loader2 className="size-3 absolute -right-0.5 -bottom-0.5 animate-spin text-primary" />
          </div>
        )}
        <span>{config.label}</span>
      </div>
    </div>
  );
}
