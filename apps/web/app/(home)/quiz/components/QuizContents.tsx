"use client";

import { useQuiz } from "@/hooks/use-quiz";
import HomeState from "../states/HomeState";
import QuizState from "../states/QuizState";
import ResultState from "../states/ResultState";
import Disclaimer from "./Disclaimer";
import { QuizProcess } from "./QuizProcess";
import { QuizStatus } from "@/components/ai/quiz-status";
import { notFound } from "next/navigation";

function getErrorMessage(err: Error | null): string | null {
  if (!err) return null;
  const msg = err.message || "";
  if (msg.includes("quota") || msg.includes("429") || msg.includes("insufficient_quota")) {
    return "บริการ AI หมดโควต้าการใช้งาน กรุณาลองใหม่อีกครั้งในภายหลัง";
  }
  if (msg.includes("Failed to process")) {
    return "เกิดข้อผิดพลาดในการสร้างแบบทดสอบ กรุณาลองใหม่อีกครั้ง";
  }
  return "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง";
}

export default function QuizContents() {
  const quiz = useQuiz();
  const {
    appState,
    selectedTopic,
    questions,
    currentPage,
    answers,
    quizCompleted,
    timeExpired,
    allQuestionsAnswered,
    answeredQuestionsCount,
    progressPercentage,
    score,
    error,
    matchCount,
    messages,
    status,
    phase,
    isGenerating,
    startQuiz,
    selectOption,
    goToPage,
    timeUp,
    submitQuiz,
    restartQuiz,
  } = quiz;

  const handleRetry = () => {
    if (selectedTopic) {
      startQuiz(selectedTopic);
    }
  };

  if (appState === "home") {
    return <HomeState onStartQuiz={startQuiz} />;
  }

  if (appState === "loading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <QuizProcess
          messages={messages}
          isStreaming={status === "streaming" || status === "submitted"}
          matchCount={matchCount}
          error={error ? new Error(getErrorMessage(error) ?? "Unknown error") : null}
          onRetry={handleRetry}
          mode="full"
        />
        <QuizStatus phase={phase} />
      </div>
    );
  }

  if (appState === "quiz") {
    return (
      <>
        <QuizState
          selectedTopic={selectedTopic}
          currentPage={currentPage}
          setCurrentPage={goToPage}
          questions={questions}
          answers={answers}
          quizCompleted={quizCompleted}
          timeExpired={timeExpired}
          handleTimeUp={timeUp}
          handleSelectOption={selectOption}
          handleSubmitQuiz={submitQuiz}
          allQuestionsAnswered={allQuestionsAnswered}
          answeredQuestionsCount={answeredQuestionsCount}
          progressPercentage={progressPercentage}
          quizContext={{ messages, matchCount }}
        />
        <Disclaimer />
      </>
    );
  }

  if (appState === "results") {
    return (
      <>
        <ResultState
          selectedTopic={selectedTopic}
          score={score}
          questions={questions}
          handleRestartQuiz={restartQuiz}
          answers={answers}
        />
        <Disclaimer />
      </>
    );
  }

  notFound();
}
