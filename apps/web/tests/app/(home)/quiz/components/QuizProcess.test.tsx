import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { QuizProcess } from "@/app/(home)/quiz/components/QuizProcess";

const messages: UIMessage[] = [
  {
    id: "1",
    role: "assistant",
    parts: [
      { type: "data-task", data: { id: "t1", label: "ค้นหาเอกสาร", status: "done", matchCount: 3 } },
      { type: "data-reasoning", data: { summary: "พบ 3 รายการ", excerpts: ["passage A", "passage B"] } },
    ],
  },
];

describe("QuizProcess", () => {
  it("renders process steps and badge in full mode", () => {
    render(<QuizProcess messages={messages} isStreaming={false} matchCount={3} error={null} mode="full" />);

    expect(screen.getByTestId("process-steps")).toBeInTheDocument();
    expect(screen.getByTestId("process-badge")).toBeInTheDocument();
  });

  it("renders only the badge in badge-only mode", () => {
    render(<QuizProcess messages={messages} isStreaming={false} matchCount={3} error={null} mode="badge-only" />);

    expect(screen.queryByTestId("process-steps")).not.toBeInTheDocument();
    expect(screen.getByTestId("process-badge")).toBeInTheDocument();
  });
});
