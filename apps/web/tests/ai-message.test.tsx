import { render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { AIMessage } from "@/components/ai/ai-message";

function outcomeMessage(data: unknown): UIMessage {
  const parts: UIMessage["parts"] = [
    { type: "data-outcome", data } as UIMessage["parts"][number],
  ];
  return { id: "assistant-outcome", role: "assistant", parts };
}

describe("AIMessage terminal outcomes", () => {
  it.each([
    [
      "insufficient-evidence",
      "ไม่พบหลักฐานเพียงพอในเอกสารเพื่อสร้างคำตอบ",
      "private evidence detail",
    ],
    [
      "retrieval-unavailable",
      "ไม่สามารถค้นหาเอกสารได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง",
      "private Pinecone detail",
    ],
    [
      "failed",
      "เกิดข้อผิดพลาดในการสร้างคำตอบ กรุณาลองใหม่อีกครั้ง",
      "private provider detail",
    ],
  ])("renders a generic message for %s", (outcome, expected, secret) => {
    render(
      <AIMessage
        message={outcomeMessage({ outcome, code: secret })}
        onSelectSuggestion={() => undefined}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(expected);
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
  });

  it("suppresses the terminal message for an intentional abort", () => {
    render(
      <AIMessage
        message={outcomeMessage({ outcome: "failed", code: "aborted" })}
        onSelectSuggestion={() => undefined}
      />,
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
