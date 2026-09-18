import { z } from "zod";

const MAX_MESSAGES = 20;
const MAX_PARTS_PER_MESSAGE = 20;
const MAX_MESSAGE_ID_LENGTH = 200;
const MAX_TEXT_LENGTH = 4_000;
const MAX_TOTAL_TEXT_LENGTH = 20_000;

const rawMessageSchema = z.object({
  id: z.string().min(1).max(MAX_MESSAGE_ID_LENGTH),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.unknown()).max(MAX_PARTS_PER_MESSAGE),
});

const rawQuestionRequestSchema = z.object({
  messages: z.array(rawMessageSchema).min(1).max(MAX_MESSAGES),
});

const safeTextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().max(MAX_TEXT_LENGTH),
});

const safeQuestionRequestSchema = z
  .object({
    messages: z
      .array(
        z.object({
          id: z.string().min(1).max(MAX_MESSAGE_ID_LENGTH),
          role: z.enum(["user", "assistant"]),
          parts: z.array(safeTextPartSchema).max(MAX_PARTS_PER_MESSAGE),
        }),
      )
      .min(1)
      .max(MAX_MESSAGES),
  })
  .superRefine((request, context) => {
    const totalTextLength = request.messages.reduce(
      (total, message) =>
        total +
        message.parts.reduce(
          (messageTotal, part) => messageTotal + part.text.length,
          0,
        ),
      0,
    );
    if (totalTextLength > MAX_TOTAL_TEXT_LENGTH) {
      context.addIssue({
        code: "custom",
        path: ["messages"],
        message: "Question history is too large",
      });
    }

    const finalMessage = request.messages.at(-1);
    if (
      finalMessage?.role !== "user" ||
      !finalMessage.parts.some((part) => part.text.trim().length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["messages"],
        message: "The final message must contain a user question",
      });
    }
  });

export type SafeQuestionRequest = z.infer<typeof safeQuestionRequestSchema>;

export function parseQuestionRequest(value: unknown): SafeQuestionRequest {
  const request = rawQuestionRequestSchema.parse(value);
  const messages = request.messages
    .map((message) => ({
      id: message.id,
      role: message.role,
      parts: message.parts.flatMap((part) => {
        if (
          typeof part !== "object" ||
          part === null ||
          !("type" in part) ||
          part.type !== "text"
        ) {
          return [];
        }
        return [safeTextPartSchema.parse(part)];
      }),
    }))
    .filter((message) => message.parts.length > 0);

  return safeQuestionRequestSchema.parse({ messages });
}
