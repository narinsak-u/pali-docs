import { getTopicTitle, quizTopicsById } from "@/data/quiz-topic";
import { QuizTimer } from "../components/QuizTimer";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { QuizPagination } from "../components/QuizPagination";
import { Button } from "@/components/ui/button";
import { Question, QuizQuestion } from "../components/QuizQuestont";
import { QuizProcess } from "../components/QuizProcess";
import { CheckCircle } from "lucide-react";

type Props = {
  selectedTopic: string | null;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  questions: Question[];
  answers: Record<string, string>;
  quizCompleted: boolean;
  timeExpired: boolean;
  allQuestionsAnswered: boolean;
  answeredQuestionsCount: number;
  progressPercentage: number;
  handleTimeUp: () => void;
  handleSelectOption: (questionId: string, optionId: string) => void;
  handleSubmitQuiz: () => void;
  quizContext?: { messages: import("ai").UIMessage[]; matchCount: number };
};

const QuizState = ({
  selectedTopic,
  currentPage,
  setCurrentPage,
  questions,
  answers,
  quizCompleted,
  timeExpired,
  allQuestionsAnswered,
  answeredQuestionsCount,
  progressPercentage,
  handleTimeUp,
  handleSelectOption,
  handleSubmitQuiz,
  quizContext,
}: Props) => {
  const questionsPerPage = 5;
  const totalPages = Math.ceil(questions.length / questionsPerPage);
  const currentQuestions = questions.slice(
    (currentPage - 1) * questionsPerPage,
    currentPage * questionsPerPage
  );
  const topic = quizTopicsById.get(selectedTopic ?? "");

  return (
    <div className="border-l border-t border-r px-6 py-12">
      <div className="space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              {getTopicTitle(selectedTopic)}
            </h1>
            <p className="text-muted-foreground">
              {`กรุณาตอบคำถามทั้ง ${
                topic?.amount
              } ข้อเพื่อทำแบบทดสอบให้เสร็จสมบูรณ์`}
            </p>
          </div>

          <QuizTimer
            duration={
              (topic?.time ?? 0) * 60
            }
            onTimeUp={handleTimeUp}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {`ตอบแล้ว ${answeredQuestionsCount} จากทั้งหมด ${questions.length}`}
            </span>
            <span className="text-sm text-muted-foreground">
              {progressPercentage.toFixed(0)}% สมบูรณ์
            </span>
          </div>
          <Progress value={progressPercentage} className="h-2" />
        </div>

        {quizContext && (
          <QuizProcess
            messages={quizContext.messages}
            isStreaming={false}
            matchCount={quizContext.matchCount}
            error={null}
            mode="badge-only"
          />
        )}

        <Card>
          <CardContent className="p-6">
            <div className="space-y-8">
              {currentQuestions.map((question, index) => (
                  <QuizQuestion
                    key={question.id}
                    questionNo={index + 1}
                    question={question}
                    selectedOption={answers[question.id] || null}
                    onSelectOption={handleSelectOption}
                  />
                ))}
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-4 sm:flex-row sm:justify-between">
              <QuizPagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />

              <div className="flex flex-col gap-2 items-end">
                {allQuestionsAnswered && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle className="h-4 w-4" />
                    <span>คุณได้ตอบคำถามครบทั้งหมดแล้ว!</span>
                  </div>
                )}
                {!timeExpired && !allQuestionsAnswered && (
                  <p className="text-sm text-muted-foreground">
                    กรุณาตอบคำถามทั้งหมดก่อนส่ง.
                  </p>
                )}
                <Button
                  className="cursor-pointer"
                  onClick={handleSubmitQuiz}
                  disabled={!timeExpired && !allQuestionsAnswered}
                >
                  Submit
                </Button>
              </div>
            </CardFooter>
        </Card>
      </div>
    </div>
  );
};

export default QuizState;
