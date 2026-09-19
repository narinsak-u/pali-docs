import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { createAiSdkEventSink } from "@/lib/agent/ai-sdk-event-sink";
import { createAiSdkAgentTurnRunner } from "@/lib/agent/ai-sdk-runner";
import {
  createCompositeEventSink,
  createStructuredTraceSink,
} from "@/lib/agent/structured-trace-sink";
import type { AgentTurnRunner } from "@/lib/agent/types";
import { isQuotaError } from "@/lib/services/quiz-pipeline";
import {
  parseQuestionRequestBody,
  type SafeQuestionRequest,
} from "@/lib/schemas/question-request";

export const runtime = "nodejs";
export const maxDuration = 120;

const JSON_HEADERS = { "Content-Type": "application/json" };

function errorResponse(
  status: number,
  error: string,
  message: string,
): Response {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: JSON_HEADERS,
  });
}

export async function POST(req: Request): Promise<Response> {
  let messages: SafeQuestionRequest["messages"];
  try {
    ({ messages } = await parseQuestionRequestBody(req));
  } catch {
    return errorResponse(400, "invalid_request", "Invalid request");
  }

  const runId = globalThis.crypto.randomUUID();

  try {
    const runner: AgentTurnRunner = createAiSdkAgentTurnRunner();
    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer }) => {
        const sink = createCompositeEventSink([
          createAiSdkEventSink(writer),
          createStructuredTraceSink((record) => {
            console.info("Question agent trace:", record);
          }),
        ]);

        await runner.runTurn({ runId, messages }, sink, req.signal);
      },
      onError: (error) => {
        console.error("Question agent stream error:", { runId, error });
        return "Internal server error";
      },
    });

    return createUIMessageStreamResponse({ stream }) as Response;
  } catch (error: unknown) {
    console.error("Question API error:", { runId, error });
    if (isQuotaError(error)) {
      return errorResponse(
        429,
        "insufficient_quota",
        "You exceeded your current quota",
      );
    }
    return errorResponse(500, "internal_error", "Internal server error");
  }
}
