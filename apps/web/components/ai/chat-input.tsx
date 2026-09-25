"use client";

import { useRef, useEffect, type ComponentProps } from "react";
import { Loader2, RefreshCw, Send, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export function ChatInput(props: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (text: string) => void;
  status: "ready" | "streaming" | "submitted" | "error";
  onStop: () => void;
  onRegenerate: () => void;
  onClear: () => void;
  hasMessages: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "inherit";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [props.value]);

  const submit = () => {
    const v = props.value.trim();
    if (!v) return;
    props.onSubmit(v);
    props.onChange("");
  };

  return (
    <div className="p-4 bg-fd-background/50 backdrop-blur-sm sticky bottom-0 z-10">
      <div className="max-w-4xl mx-auto relative flex flex-col gap-2">
        {props.hasMessages && props.status === "ready" && (
          <div className="flex justify-center gap-2 mb-2">
            <button
              type="button"
              onClick={props.onRegenerate}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "gap-2 rounded-full",
              )}
            >
              <RefreshCw className="size-3" />
              Regenerate
            </button>
            <button
              type="button"
              onClick={props.onClear}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "gap-2 rounded-full",
              )}
            >
              <Trash2 className="size-3" />
              Clear
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="relative flex items-center justify-center gap-2"
        >
          <TextareaInput
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            disabled={props.status !== "ready"}
            placeholder={
              props.status === "streaming" ? "กำลังหาคำตอบ..." : "ถามคำถาม..."
            }
            className="pr-12 min-h-[52px] max-h-[200px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div>
            {props.status === "streaming" ? (
              <button
                type="button"
                onClick={props.onStop}
                className={cn(
                  buttonVariants({ size: "icon", variant: "ghost" }),
                  "h-8 w-8 rounded-full",
                )}
              >
                <Loader2 className="size-4 animate-spin" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={props.status !== "ready"}
                className={cn(
                  buttonVariants({ size: "icon", variant: "default" }),
                  "h-8 w-8 rounded-full",
                )}
              >
                <Send className="size-4" />
              </button>
            )}
          </div>
        </form>
        <p className="text-xs text-center text-fd-muted-foreground mt-2">
          AI can make mistakes. Please check important information.
        </p>
      </div>
    </div>
  );
}

function TextareaInput(props: ComponentProps<"textarea">) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "inherit";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [props.value]);
  return (
    <textarea
      ref={textareaRef}
      {...props}
      className={cn(
        "flex w-full rounded-2xl border border-fd-input bg-fd-background px-4 py-3 text-sm ring-offset-fd-background placeholder:text-fd-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none overflow-hidden",
        props.className,
      )}
    />
  );
}
