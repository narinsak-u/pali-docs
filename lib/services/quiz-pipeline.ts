import {
  streamText,
  createUIMessageStream,
  type InferUIMessageChunk,
  type UIMessage,
} from "ai";
import { getConfiguredModel } from "@/lib/services/llm-provider";
import { quizResponseSchema } from "@/lib/schemas/quiz";
import quizContent from "@/data/quiz-content.json";

export interface QuizInput {
  topics: string[];
  amount: number;
  topicId?: string;
}

const MAX_CONTEXT_CHARS = 1500;

function buildQuizPrompt(
  context: string,
  amount: number,
  topics: string[],
): string {
  return [
    "You are a quiz generator that creates multiple-choice questions based on provided context.",
    "You must output valid JSON only — no markdown, no explanation.",
    "",
    `Context from Pali textbook corpus:`,
    context,
    "",
    `Generate exactly ${amount} multiple-choice questions about ${topics.join(", ")}.`,
    "Base all questions on the provided context.",
    "Translate all questions, answers, and options to Thai.",
    "",
    `Output a JSON object with a "questions" array. Each question must have these fields:`,
    `  "question": "the question text",`,
    `  "answer": "correct answer (max 15 words)",`,
    `  "option1": "wrong option 1 (max 15 words)",`,
    `  "option2": "wrong option 2 (max 15 words)",`,
    `  "option3": "wrong option 3 (max 15 words)"`,
    "",
    "Example:",
    `{"questions":[{"question":"...","answer":"...","option1":"...","option2":"...","option3":"..."}]}`,
  ].join("\n");
}

function loadContent(topicId?: string): string {
  if (topicId) {
    const entry = (
      quizContent as Record<string, { title: string; content: string }>
    )[topicId];
    if (entry) return entry.content;
  }
  return "";
}

export function generateQuizStream(
  input: QuizInput,
): ReadableStream<InferUIMessageChunk<UIMessage>> {
  return createUIMessageStream({
    execute: async ({ writer }) => {
      let idCounter = 0;
      const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

      // 1. Signal client that content loading has started
      writer.write({
        type: "data-status",
        data: { phase: "searching" },
      });

      // 2. Load static content for the selected topic from quiz-content.json
      const content = loadContent(input.topicId);

      // 3. Emit search task lifecycle (running → done) to update the QuizProcess UI
      writer.write({
        type: "data-task",
        data: {
          id: nextId("search"),
          label: "ค้นหาเอกสาร",
          status: "running",
          query: input.topics.join(", "),
        },
      });
      writer.write({
        type: "data-task",
        data: {
          id: nextId("search"),
          label: "ค้นหาเอกสาร",
          status: "done",
          matchCount: content ? 1 : 0,
        },
      });

      // 4. Truncate context if it exceeds the limit to keep prompt size manageable
      let context = content;
      if (context.length > MAX_CONTEXT_CHARS) {
        context =
          context.slice(0, MAX_CONTEXT_CHARS) +
          "\n\n[เนื้อหาถูกตัดเนื่องจากความยาว...]";
      }

      // 5. Signal phase transition to "answering" — QuizStatus shows "กำลังสร้างคำถาม..."
      writer.write({
        type: "data-status",
        data: { phase: "answering" },
      });

      // 6. Build the LLM prompt with context + instructions, then call streamText
      //    The model returns a JSON string matching quizResponseSchema
      const prompt = buildQuizPrompt(context, input.amount, input.topics);
      const { model } = getConfiguredModel();

      const result = streamText({
        model,
        prompt,
      });

      // 7. Parse the LLM's JSON response and validate against the schema
      const parsed = quizResponseSchema.parse(JSON.parse(await result.text));

      // 8. Write each validated question to the SSE stream as a data-question event
      for (const q of parsed.questions) {
        writer.write({
          type: "data-question",
          data: {
            id: nextId("q"),
            question: q.question,
            answer: q.answer,
            option1: q.option1,
            option2: q.option2,
            option3: q.option3,
          },
        });
      }
    },
  });
}

export function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.includes("quota") || err.message.includes("429");
}
