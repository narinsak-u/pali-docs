import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getTopicTitle } from "@/data/quiz-topic";
import { RotateCcw, Trophy } from "lucide-react";
import React from "react";
import { Question, QuizQuestion } from "../components/QuizQuestont";

type Props = {
  selectedTopic: string | null;
  score: {
    percentage: number;
    correct: number;
    total: number;
  };
  questions: Question[];
  handleRestartQuiz: () => void;
  answers: Record<string, string>;
};

const ResultState = ({
  selectedTopic,
  score,
  questions,
  handleRestartQuiz,
  answers,
}: Props) => {
  return (
    <div className="border-l border-t border-r px-6 py-12">
      <div className="space-y-8">
        <div className="overflow-hidden">
          <div className="bg-primary p-6 text-primary-foreground rounded-xs">
            <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-foreground">
                <Trophy className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">แบบทดสอบเสร็จสิ้น!</h1>
                <p>
                  {`คุณได้ทำแบบทดสอบเกี่ยวกับ "${getTopicTitle(selectedTopic)}"
                    เสร็จแล้ว`}
                </p>
              </div>
              <div className="ml-auto hidden sm:block">
                <Button
                  className="cursor-pointer"
                  variant="secondary"
                  onClick={handleRestartQuiz}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  เลือกทำแบบทดสอบอื่น
                </Button>
              </div>
            </div>
          </div>
          <div className="p-6">
            <div className="mb-6 space-y-2">
              <h2 className="text-xl font-bold">คะแนนของคุณ</h2>
              <div className="flex items-center gap-4">
                <div className="text-4xl font-bold">{score.percentage}%</div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {`ยินดีด้วย 🎉 คุณตอบถูก ${score.correct} ข้อ จากทั้งหมด ${score.total} ข้อ`}
                  </p>
                  <Progress value={score.percentage} className="mt-2 h-2" />
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <h2 className="text-xl font-bold">ตรวจสอบคำตอบของคุณ</h2>
              {questions.map((question, index) => (
                <QuizQuestion
                  key={question.id}
                  questionNo={index + 1}
                  question={question}
                  selectedOption={answers[question.id] || null}
                  onSelectOption={() => {}}
                  showAnswer={true}
                />
              ))}
            </div>
          </div>
          <div className="sm:hidden">
            <Button
              className="w-full cursor-pointer"
              onClick={handleRestartQuiz}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              เลือกทำแบบทดสอบอื่น
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResultState;
