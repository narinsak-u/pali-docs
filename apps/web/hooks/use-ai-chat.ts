"use client";

import { useCallback, useMemo, useState } from "react";
import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  reduceTaskParts,
  type DataTaskPart,
} from "@/lib/chat/reduce-task-parts";
import {
  statusPartSchema,
  taskPartSchema,
} from "@/lib/schemas/ai-data-parts";

export type ChatPhase =
  | "idle"
  | "thinking"
  | "searching"
  | "answering"
  | "done";

type ChatHelpers = UseChatHelpers<UIMessage>;

export interface UseAIChatReturn {
  messages: ChatHelpers["messages"];
  status: ChatHelpers["status"];
  phase: ChatPhase;
  error: string | null;
  sendMessage: ChatHelpers["sendMessage"];
  regenerate: ChatHelpers["regenerate"];
  stop: ChatHelpers["stop"];
  clear: () => void;
  dismissError: () => void;
}

function mapErrorToThai(err: Error): string {
  const m = err.message.toLowerCase();
  if (m.includes("quota") || m.includes("429") || m.includes("rate limit")) {
    return "บริการ AI หมดโควต้าการใช้งาน กรุณาลองใหม่อีกครั้งในภายหลัง";
  }
  return "เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง";
}

function derivePhase(messages: UIMessage[], chatStatus: string): ChatPhase {
  if (messages.length === 0) return "idle";

  const last = messages[messages.length - 1];

  if (last.role === "user") {
    return chatStatus === "submitted" || chatStatus === "streaming"
      ? "thinking"
      : "idle";
  }

  if (chatStatus !== "streaming") return "done";

  const parts = Array.isArray(last.parts) ? last.parts : [];
  const taskParts: DataTaskPart[] = [];
  let statusPhase: "thinking" | "searching" | "answering" | null = null;

  for (const part of parts) {
    if (!("data" in part)) continue;

    if (part.type === "data-task") {
      const parsed = taskPartSchema.safeParse(part.data);
      if (parsed.success) {
        taskParts.push({ type: "data-task", data: parsed.data });
      }
    } else if (part.type === "data-status") {
      const parsed = statusPartSchema.safeParse(part.data);
      if (parsed.success) statusPhase = parsed.data.phase;
    }
  }

  const hasRunningTask = reduceTaskParts(taskParts).some(
    (part) => part.data.status === "running",
  );
  if (hasRunningTask) return "searching";
  if (statusPhase === "answering") return "answering";

  return "thinking";
}

export function useAIChat(): UseAIChatReturn {
  const [error, setError] = useState<string | null>(null);
  const { messages, status, sendMessage, regenerate, stop, setMessages } =
    useChat({
      transport: new DefaultChatTransport({ api: "/api/question" }),
      onError: (err) => setError(mapErrorToThai(err)),
    });

  const sendMessageWithErrorReset = useCallback<typeof sendMessage>(
    (...args) => {
      setError(null);
      return sendMessage(...args);
    },
    [sendMessage],
  );
  const regenerateWithErrorReset = useCallback<typeof regenerate>(
    (...args) => {
      setError(null);
      return regenerate(...args);
    },
    [regenerate],
  );
  const clear = useCallback(() => {
    setError(null);
    setMessages([]);
  }, [setMessages]);
  const dismissError = useCallback(() => setError(null), []);

  const phase = useMemo(
    () => derivePhase(messages, status),
    [messages, status],
  );

  return {
    messages,
    status,
    phase,
    error,
    sendMessage: sendMessageWithErrorReset,
    regenerate: regenerateWithErrorReset,
    stop,
    clear,
    dismissError,
  };
}

export { mapErrorToThai };
