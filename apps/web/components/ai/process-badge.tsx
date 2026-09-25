"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProcessBadgeProps {
  label: string;
  children: React.ReactNode;
}

export function ProcessBadge({ label, children }: ProcessBadgeProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        data-testid="process-badge"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground",
          "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Sparkles className="size-3" />
        {label}
      </button>
      {open && (
        <div
          data-testid="process-badge-popover"
          role="dialog"
          aria-label="Process details"
          className="mt-1 w-full overflow-auto rounded-md border bg-popover p-3 text-popover-foreground shadow-md"
        >
          {children}
        </div>
      )}
    </div>
  );
}
