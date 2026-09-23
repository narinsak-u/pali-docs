"use client";

import { useMemo } from "react";
import { getStats } from "@/helpers/get-stats";
import type { Question } from "@/lib/schemas/quiz";

interface Stats {
  allQuestionsAnswered: boolean;
  answeredQuestionsCount: number;
  progressPercentage: number;
  score: {
    correct: number;
    total: number;
    percentage: number;
  };
}

interface UseQuizStatsReturn {
  stats: Stats;
}

export function useQuizStats(
  questions: Question[],
  answers: Record<string, string>
): UseQuizStatsReturn {
  const stats = useMemo(() => getStats(questions, answers), [questions, answers]);

  return { stats };
}