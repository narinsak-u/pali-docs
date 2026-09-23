import { createUIMessageStreamResponse } from "ai";
import { generateQuizStream, isQuotaError } from "@/lib/services/quiz-pipeline";
import { quizSchema } from "@/lib/schemas/quiz";
import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages = body.messages ?? [];
    const lastUserMessage = messages.findLast(
      (m: { role: string }) => m.role === "user",
    );
    const rawText = lastUserMessage
      ? (lastUserMessage.parts?.[0]?.text ?? lastUserMessage.content)
      : undefined;
    const payload = rawText ? JSON.parse(rawText) : body;
    const parsed = quizSchema.parse(payload);

    const stream = generateQuizStream({
      topics: parsed.topics,
      amount: parsed.amount,
      topicId: parsed.topicId,
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error: unknown) {
    console.error("Quiz API error:", error);
    if (isQuotaError(error)) {
      return NextResponse.json(
        { error: "บริการ AI หมดโควต้าการใช้งาน กรุณาลองใหม่อีกครั้งในภายหลัง" },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: "เกิดข้อผิดพลาดในการสร้างแบบทดสอบ กรุณาลองใหม่อีกครั้ง" },
      { status: 500 },
    );
  }
}
