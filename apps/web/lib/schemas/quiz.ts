import { z } from "zod";

export interface Question {
  id: string;
  questionText: string;
  options: {
    id: string;
    text: string;
  }[];
  answerId: string;
}

export const quizSchema = z.object({
  topics: z.array(z.string()),
  amount: z.number(),
  topicId: z.string().optional(),
});

export const quizResponseSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string().describe("question text based on the book content"),
      answer: z
        .string()
        .describe("correct answer from the book (max 15 words)"),
      option1: z
        .string()
        .describe("wrong option 1 from the book (max 15 words)"),
      option2: z
        .string()
        .describe("wrong option 2 from the book (max 15 words)"),
      option3: z
        .string()
        .describe("wrong option 3 from the book (max 15 words)"),
    })
  ),
});

export type QuizResponse = z.infer<typeof quizResponseSchema>;
