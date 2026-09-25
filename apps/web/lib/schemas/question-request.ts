import { z } from "zod";

const MAX_MESSAGES = 20;
const MAX_PARTS_PER_MESSAGE = 20;
const MAX_MESSAGE_ID_LENGTH = 200;
const MAX_TEXT_LENGTH = 4_000;
const MAX_TOTAL_TEXT_LENGTH = 20_000;
const MAX_REQUEST_BODY_BYTES = 256 * 1024;

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

export async function parseQuestionRequestBody(
  request: Request,
): Promise<SafeQuestionRequest> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    Number(declaredLength) > MAX_REQUEST_BODY_BYTES
  ) {
    await request.body?.cancel();
    throw new Error("Question request body is too large");
  }

  if (!request.body) {
    throw new Error("Question request body is required");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel();
        throw new Error("Question request body is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(body),
  );
  return parseQuestionRequest(value);
}
