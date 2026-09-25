"use client";

import { useEffect, useCallback, useRef } from "react";
import type { UIMessage } from "ai";
import { quizTopicsById } from "@/data/quiz-topic";
import { mapQuestionsFromResponse } from "@/helpers/map-questions";
import type { Question } from "@/lib/schemas/quiz";

import { useQuizFlow } from "@/lib/hooks/use-quiz-flow";
import { useQuizData } from "@/lib/hooks/use-quiz-data";
import { useQuizUI } from "@/lib/hooks/use-quiz-ui";
import { useQuizAI } from "@/lib/hooks/use-quiz-ai";
import { useQuizStats } from "@/lib/hooks/use-quiz-stats";

interface UseQuizReturn {
  appState: "home" | "loading" | "quiz" | "results";
  selectedTopic: string | null;
  questions: Question[];
  currentPage: number;
  answers: Record<string, string>;
  quizCompleted: boolean;
  timeExpired: boolean;
  isLoading: boolean;
  error: Error | null;
  matchCount: number;
  messages: UIMessage[];
  status: string;
  phase: "idle" | "searching" | "generating" | "done" | "error";
  isGenerating: boolean;
  renderedCount: number;
  totalExpected: number;
  allQuestionsAnswered: boolean;
  answeredQuestionsCount: number;
  progressPercentage: number;
  score: { correct: number; total: number; percentage: number };
  startQuiz: (topicId: string) => Promise<void>;
  selectOption: (questionId: string, optionId: string) => void;
  goToPage: (page: number) => void;
  timeUp: () => void;
  submitQuiz: () => void;
  restartQuiz: () => void;
}

export function useQuiz(): UseQuizReturn {
  const flow = useQuizFlow();
  const data = useQuizData();
  const ui = useQuizUI();
  const ai = useQuizAI();
  const { stats } = useQuizStats(data.questions, data.answers);

  const hasTransitioned = useRef(false);

  const startQuiz = useCallback(
    async (topicId: string) => {
      const topic = quizTopicsById.get(topicId);
      if (!topic) {
        console.error("Topic not found");
        return;
      }

      hasTransitioned.current = false;
      data.setTopic(topicId);
      flow.start();
      ui.reset();
      data.clearAnswers();

      ai.submit({
        amount: topic.amount,
        topics: topic.keywords,
        topicId: topic.id,
      });
    },
    [ai, data, flow, ui],
  );

  const selectOption = useCallback(
    (questionId: string, optionId: string) => {
      data.answer(questionId, optionId);
    },
    [data],
  );

  const goToPage = useCallback(
    (page: number) => {
      ui.setPage(page);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [ui],
  );

  const timeUp = useCallback(() => {
    ui.markExpired();

    data.setAnswers((prev) => {
      const next = { ...prev };
      for (const q of data.questions) {
        if (!next[q.id]) next[q.id] = "time-expired";
      }
      return next;
    });

    ui.markComplete();
    flow.goToResults();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [data, flow, ui]);

  const submitQuiz = useCallback(() => {
    ui.markComplete();
    flow.goToResults();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [flow, ui]);

  const selectedTopicData = quizTopicsById.get(data.selectedTopic ?? "");
  const totalExpected = selectedTopicData?.amount ?? 0;
  const isGenerating =
    ai.status === "streaming" && ai.questions.length < totalExpected;
  const renderedCount = ai.questions.length;

  const restartQuiz = useCallback(() => {
    flow.goToHome();
    data.setTopic(null);
    data.setQuestions([]);
    ui.reset();
    data.clearAnswers();
  }, [data, flow, ui]);

  // Transition from loading → quiz on first question received
  useEffect(() => {
    if (!hasTransitioned.current && ai.questions.length > 0) {
      hasTransitioned.current = true;
      const mapped = mapQuestionsFromResponse(ai.questions);
      data.setQuestions(mapped);
      flow.goToQuiz();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [ai.questions, data, flow]);

  // Update questions as more arrive
  useEffect(() => {
    if (hasTransitioned.current && ai.questions.length > 0) {
      const mapped = mapQuestionsFromResponse(ai.questions);
      data.setQuestions(mapped);
    }
  }, [ai.questions]);

  return {
    appState: flow.appState,
    selectedTopic: data.selectedTopic,
    questions: data.questions,
    currentPage: ui.currentPage,
    answers: data.answers,
    quizCompleted: ui.completed,
    timeExpired: ui.timeExpired,
    isLoading: ai.phase === "searching" || ai.phase === "generating",
    error: ai.error,
    matchCount: ai.matchCount,
    messages: ai.messages,
    status: ai.status,
  phase: ai.phase,
  isGenerating,
  renderedCount,
  totalExpected,
    allQuestionsAnswered: stats.allQuestionsAnswered,
    answeredQuestionsCount: stats.answeredQuestionsCount,
    progressPercentage: stats.progressPercentage,
    score: stats.score,
    startQuiz,
    selectOption,
    goToPage,
    timeUp,
    submitQuiz,
    restartQuiz,
  };
}
