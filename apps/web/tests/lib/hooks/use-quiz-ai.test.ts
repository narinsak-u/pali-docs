import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { UIMessage } from "ai";

const mockedUseChat = vi.hoisted(() => vi.fn());

vi.mock("@ai-sdk/react", () => ({
  useChat: mockedUseChat,
}));

type ChatStatus = "submitted" | "streaming" | "ready" | "error";

const defaultChatState: {
  messages: UIMessage[];
  status: ChatStatus;
  error: Error | undefined;
  sendMessage: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  setMessages: ReturnType<typeof vi.fn>;
} = {
  messages: [] as UIMessage[],
  status: "ready",
  error: undefined,
  sendMessage: vi.fn(),
  stop: vi.fn(),
  setMessages: vi.fn(),
};

function setUseChatState(state: Partial<typeof defaultChatState>) {
  mockedUseChat.mockReturnValue({ ...defaultChatState, ...state });
}

import { useQuizAI } from "@/lib/hooks/use-quiz-ai";

beforeEach(() => {
  vi.clearAllMocks();
  setUseChatState({});
});

describe("useQuizAI", () => {
  it("derives phase=searching when no data-task done part has arrived", () => {
    setUseChatState({ messages: [], status: "submitted" });

    const { result } = renderHook(() => useQuizAI());

    expect(result.current.phase).toBe("searching");
    expect(result.current.questions).toEqual([]);
    expect(result.current.matchCount).toBe(0);
  });

  it("derives phase=generating when search done but no questions yet", () => {
    setUseChatState({
      messages: [
        {
          id: "1",
          role: "assistant",
          parts: [
            { type: "data-status", data: { phase: "searching" } },
            { type: "data-task", data: { id: "t1", label: "ค้นหาเอกสาร", status: "running" } },
            { type: "data-task", data: { id: "t1", label: "ค้นหาเอกสาร", status: "done", matchCount: 5 } },
            { type: "data-reasoning", data: { summary: "พบ 5 รายการ", excerpts: ["e1"] } },
            { type: "data-status", data: { phase: "answering" } },
          ],
        },
      ],
      status: "streaming",
    });

    const { result } = renderHook(() => useQuizAI());

    expect(result.current.phase).toBe("generating");
    expect(result.current.matchCount).toBe(5);
    expect(result.current.questions).toEqual([]);
  });

  it("derives phase=done and questions from data-question parts", () => {
    setUseChatState({
      messages: [
        {
          id: "1",
          role: "assistant",
          parts: [
            { type: "data-task", data: { id: "t1", label: "ค้นหาเอกสาร", status: "done", matchCount: 2 } },
            { type: "data-reasoning", data: { summary: "x", excerpts: [] } },
            { type: "data-question", data: { id: "q1", question: "Q1", answer: "A1", option1: "o1", option2: "o2", option3: "o3" } },
            { type: "data-question", data: { id: "q2", question: "Q2", answer: "A2", option1: "o1", option2: "o2", option3: "o3" } },
          ],
        },
      ],
      status: "ready",
    });

    const { result } = renderHook(() => useQuizAI());

    expect(result.current.phase).toBe("done");
    expect(result.current.questions).toHaveLength(2);
    expect(result.current.questions[0].question).toBe("Q1");
  });

  it("derives phase=error when useChat surfaces an error", () => {
    setUseChatState({
      error: new Error("quota"),
      status: "ready",
    });

    const { result } = renderHook(() => useQuizAI());

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it("submit calls setMessages([]) and sendMessage", () => {
    const sendMessage = vi.fn();
    const setMessages = vi.fn();
    setUseChatState({ sendMessage, setMessages });

    const { result } = renderHook(() => useQuizAI());

    act(() => {
      result.current.submit({ topics: ["x"], amount: 3 });
    });

    expect(setMessages).toHaveBeenCalledWith([]);
    expect(sendMessage).toHaveBeenCalled();
  });
});
