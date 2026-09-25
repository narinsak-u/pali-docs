"use client";

import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";

export function ResponseStep({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const html = useMemo(() => {
    if (isStreaming || !text) return null;
    const raw = marked.parse(text, { async: false }) as string;
    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
    });
  }, [text, isStreaming]);

  return (
    <div
      data-testid="response-step"
      className={cn(
        "rounded-2xl rounded-tl-sm border bg-card px-4 py-3 text-card-foreground shadow-sm",
        "ai-response",
      )}
    >
      {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <>{text}</>}
      {isStreaming && (
        <span className="ml-0.5 inline-block w-1.5 h-4 align-text-bottom bg-current animate-pulse" />
      )}
    </div>
  );
}
