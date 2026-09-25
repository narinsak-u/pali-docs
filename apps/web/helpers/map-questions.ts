import { type Question } from "@/lib/schemas/quiz";
import type { QuestionPart } from "@/lib/schemas/ai-data-parts";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const mapQuestionsFromResponse = (
  responseQuestions: QuestionPart[],
): Question[] => {
  return responseQuestions
    .map((question, index) => {
      if (!question?.question || !question?.answer) return undefined;

      const qId = question.id ?? `q-${index}`;
      const rawOptions = [
        { text: question.option1 },
        { text: question.option2 },
        { text: question.option3 },
        { text: question.answer },
      ];
      const shuffled = shuffle(rawOptions);
      const answerIndex = shuffled.findIndex((opt) => opt.text === question.answer);

      return {
        id: qId,
        questionText: question.question,
        options: shuffled.map((opt, optIndex) => ({
          id: `${qId}-opt-${optIndex}`,
          text: opt.text,
        })),
        answerId: `${qId}-opt-${answerIndex}`,
      };
    })
    .filter(
      (q): q is Question =>
        q !== undefined &&
        typeof q.questionText === "string" &&
        q.options?.every((opt) => typeof opt.text === "string"),
    );
};
