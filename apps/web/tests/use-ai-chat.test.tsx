import { act, renderHook } from "@testing-library/react";
import type { UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chat = vi.hoisted(() => ({
  useChat: vi.fn(),
  options: undefined as
    | { onError(error: Error): void }
    | undefined,
  sendMessage: vi.fn(),
  regenerate: vi.fn(),
  stop: vi.fn(),
  setMessages: vi.fn(),
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: chat.useChat,
}));

vi.mock("ai", () => ({
  DefaultChatTransport: class DefaultChatTransport {
    constructor(readonly options: unknown) {}
  },
}));

import { useAIChat } from "@/hooks/use-ai-chat";

function assistantMessage(parts: UIMessage["parts"]): UIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  chat.options = undefined;
  chat.useChat.mockImplementation((options) => {
    chat.options = options;
    return {
      messages: [],
      status: "ready",
      sendMessage: chat.sendMessage,
      regenerate: chat.regenerate,
      stop: chat.stop,
      setMessages: chat.setMessages,
    };
  });
});

describe("useAIChat", () => {
  it("derives answering from the latest reduced retrieval task and status parts", () => {
    chat.useChat.mockImplementation((options) => {
      chat.options = options;
      return {
        messages: [
          assistantMessage([
            {
              type: "data-task",
              data: {
                id: "run-1:retrieval:1",
                label: "ค้นหาเอกสาร",
                status: "running",
                query: "dhamma",
              },
            },
            {
              type: "data-task",
              data: {
                id: "run-1:retrieval:1",
                label: "ค้นหาเอกสาร",
                status: "done",
                matchCount: 2,
              },
            },
            { type: "data-status", data: { phase: "answering" } },
          ] as UIMessage["parts"]),
        ],
        status: "streaming",
        sendMessage: chat.sendMessage,
        regenerate: chat.regenerate,
        stop: chat.stop,
        setMessages: chat.setMessages,
      };
    });

    const { result } = renderHook(() => useAIChat());

    expect(result.current.phase).toBe("answering");
  });

  it("clears a prior transient error before sending", () => {
    const { result } = renderHook(() => useAIChat());
    act(() => chat.options?.onError(new Error("429 quota")));
    expect(result.current.error).not.toBeNull();

    act(() => {
      void result.current.sendMessage({ text: "hello" });
    });

    expect(result.current.error).toBeNull();
    expect(chat.sendMessage).toHaveBeenCalledWith({ text: "hello" });
  });

  it("clears a prior transient error before regenerating", () => {
    const { result } = renderHook(() => useAIChat());
    act(() => chat.options?.onError(new Error("network")));

    act(() => {
      void result.current.regenerate();
    });

    expect(result.current.error).toBeNull();
    expect(chat.regenerate).toHaveBeenCalledTimes(1);
  });

  it("clears a prior transient error before clearing messages", () => {
    const { result } = renderHook(() => useAIChat());
    act(() => chat.options?.onError(new Error("network")));

    act(() => result.current.clear());

    expect(result.current.error).toBeNull();
    expect(chat.setMessages).toHaveBeenCalledWith([]);
  });

  it("dismisses a prior transient error without changing messages", () => {
    const { result } = renderHook(() => useAIChat());
    act(() => chat.options?.onError(new Error("network")));

    act(() => result.current.dismissError());

    expect(result.current.error).toBeNull();
    expect(chat.setMessages).not.toHaveBeenCalled();
  });
});
