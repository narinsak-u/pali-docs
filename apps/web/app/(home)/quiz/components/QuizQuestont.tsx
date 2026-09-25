import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

export interface Question {
  id: string;
  questionText: string;
  options: {
    id: string;
    text: string;
  }[];
  answerId: string;
}

interface QuizQuestionProps {
  question: Question;
  questionNo: number;
  selectedOption: string | null;
  onSelectOption: (questionId: string, optionId: string) => void;
  showAnswer?: boolean;
}

export function QuizQuestion({
  question,
  questionNo,
  selectedOption,
  onSelectOption,
  showAnswer = false,
}: QuizQuestionProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-xl font-bold">
        {showAnswer
          ? questionNo + ". " + question.questionText
          : question.questionText}
      </h3>
      <RadioGroup
        value={selectedOption || ""}
        onValueChange={(value) => onSelectOption(question.id, value)}
      >
        <div className="space-y-2">
          {question.options.map((option) => {
            const isCorrect = option.id === question.answerId;
            const isTimeExpired = selectedOption === "time-expired";
            const isIncorrect =
              showAnswer && selectedOption === option.id && !isCorrect;

            return (
              <div
                key={option.id}
                className={`flex items-center rounded-lg border p-4 transition-colors ${
                  selectedOption === option.id ? "bg-muted" : ""
                } ${
                  showAnswer && isCorrect
                    ? "border-green-500 bg-green-50 dark:bg-green-950/20"
                    : ""
                }
                ${
                  isIncorrect
                    ? "border-red-500 bg-red-50 dark:bg-red-950/20"
                    : ""
                }`}
              >
                <RadioGroupItem
                  value={option.id}
                  id={option.id}
                  disabled={showAnswer}
                  className="mr-2"
                />
                <Label
                  htmlFor={option.id}
                  className="w-full cursor-pointer font-bold"
                >
                  {option.text}
                </Label>
                {showAnswer && isCorrect && (
                  <span className="ml-auto text-sm font-medium text-green-500">
                    Correct
                  </span>
                )}
                {isIncorrect && (
                  <span className="ml-auto text-sm font-medium text-red-500">
                    Incorrect
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </RadioGroup>

      {/* Show message for unanswered questions when time expired */}
      {showAnswer && selectedOption === "time-expired" && (
        <div className="mt-2 text-sm text-amber-600 dark:text-amber-500">
          หมดเวลา - คำถามไม่ได้รับคำตอบ
        </div>
      )}
    </div>
  );
}
