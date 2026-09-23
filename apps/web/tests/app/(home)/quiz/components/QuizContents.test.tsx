import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-quiz", () => ({
  useQuiz: vi.fn(),
}));

import { useQuiz } from "@/hooks/use-quiz";
import QuizContents from "@/app/(home)/quiz/components/QuizContents";

const mockedUseQuiz = vi.mocked(useQuiz);

describe("QuizContents", () => {
  it("renders QuizProcess in loading state (not LoadingOverlay)", () => {
    mockedUseQuiz.mockReturnValue({
      appState: "loading",
      selectedTopic: "x",
      questions: [],
      currentPage: 1,
      answers: {},
      quizCompleted: false,
      timeExpired: false,
      isLoading: true,
      error: null,
      matchCount: 3,
      isGenerating: false,
      messages: [],
      status: "streaming",
      allQuestionsAnswered: false,
      answeredQuestionsCount: 0,
      progressPercentage: 0,
      score: { correct: 0, total: 0, percentage: 0 },
      startQuiz: vi.fn(),
      selectOption: vi.fn(),
      goToPage: vi.fn(),
      timeUp: vi.fn(),
      submitQuiz: vi.fn(),
      restartQuiz: vi.fn(),
    } as never);

    render(<QuizContents />);
    expect(screen.getByTestId("process-badge")).toBeInTheDocument();
  });
});
