"use client";

import { useState, useCallback } from "react";

type AppState = "home" | "loading" | "quiz" | "results";

interface UseQuizFlowReturn {
  appState: AppState;
  start: () => void;
  goToQuiz: () => void;
  goToResults: () => void;
  goToHome: () => void;
}

export function useQuizFlow(): UseQuizFlowReturn {
  const [appState, setAppState] = useState<AppState>("home");

  const start = useCallback(() => {
    setAppState("loading");
  }, []);

  const goToQuiz = useCallback(() => {
    setAppState("quiz");
  }, []);

  const goToResults = useCallback(() => {
    setAppState("results");
  }, []);

  const goToHome = useCallback(() => {
    setAppState("home");
  }, []);

  return {
    appState,
    start,
    goToQuiz,
    goToResults,
    goToHome,
  };
}