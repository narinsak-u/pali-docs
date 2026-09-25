"use client";

import { useState, useCallback } from "react";

interface UseQuizUIReturn {
  currentPage: number;
  completed: boolean;
  timeExpired: boolean;
  setPage: (page: number) => void;
  markComplete: () => void;
  markExpired: () => void;
  reset: () => void;
}

export function useQuizUI(): UseQuizUIReturn {
  const [currentPage, setCurrentPage] = useState(1);
  const [completed, setCompleted] = useState(false);
  const [timeExpired, setTimeExpired] = useState(false);

  const setPage = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const markComplete = useCallback(() => {
    setCompleted(true);
  }, []);

  const markExpired = useCallback(() => {
    setTimeExpired(true);
  }, []);

  const reset = useCallback(() => {
    setCurrentPage(1);
    setCompleted(false);
    setTimeExpired(false);
  }, []);

  return {
    currentPage,
    completed,
    timeExpired,
    setPage,
    markComplete,
    markExpired,
    reset,
  };
}