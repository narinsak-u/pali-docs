import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { consumeLangGraphSse } from "@/lib/agent/langgraph-event-adapter";
import { createAiSdkEventSink } from "@/lib/agent/ai-sdk-event-sink";
import { createAiSdkAgentTurnRunner } from "@/lib/agent/ai-sdk-runner";
import {
  createCompositeEventSink,
  createStructuredTraceSink,
} from "@/lib/agent/structured-trace-sink";
import type { AgentTurnRunner } from "@/lib/agent/types";
import { getModelConfig } from "@/lib/config/model";
import { getRagConfig } from "@/lib/config/rag";
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

function backendErrorResponse(status: number): Response {
  if (status === 400) {
    return errorResponse(400, "invalid_request", "Invalid request");
  }
  if (status === 429) {
    return errorResponse(429, "insufficient_quota", "You exceeded your current quota");
  }
  if (status === 503) {
    return errorResponse(503, "service_unavailable", "Question service unavailable");
  }
  return errorResponse(500, "internal_error", "Internal server error");
}

export async function POST(req: Request): Promise<Response> {
  let messages: SafeQuestionRequest["messages"];
  try {
    ({ messages } = await parseQuestionRequestBody(req));
  } catch {
    return errorResponse(400, "invalid_request", "Invalid request");
  }

  const runId = globalThis.crypto.randomUUID();

  if (process.env.RAG_BACKEND === "langgraph") {
    const baseUrl = process.env.FASTAPI_BASE_URL?.trim().replace(/\/+$/, "");
    const internalToken = process.env.FASTAPI_INTERNAL_TOKEN?.trim();
    if (!baseUrl || !internalToken) {
      return errorResponse(
        503,
        "service_unavailable",
        "Question service unavailable",
      );
    }

    let backendResponse: Response;
    try {
      backendResponse = await fetch(`${baseUrl}/v1/question`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${internalToken}`,
        },
        body: JSON.stringify({
          runId,
          messages: messages.flatMap(({ role, parts }) => {
            const content = parts.map((part) => part.text).join("");
            return content.trim().length > 0 ? [{ role, content }] : [];
          }),
        }),
        signal: req.signal,
      });
    } catch (error: unknown) {
      console.error("LangGraph question request error:", { runId, error });
      return errorResponse(
        503,
        "service_unavailable",
        "Question service unavailable",
      );
    }

    if (!backendResponse.ok) {
      return backendErrorResponse(backendResponse.status);
    }
    if (
      !backendResponse.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("text/event-stream")
    ) {
      return errorResponse(
        503,
        "service_unavailable",
        "Question service unavailable",
      );
    }

    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer }) => {
        await consumeLangGraphSse(
          backendResponse,
          createAiSdkEventSink(writer),
          req.signal,
          runId,
        );
      },
      onError: (error) => {
        console.error("LangGraph question stream error:", { runId, error });
        return "Internal server error";
      },
    });
    return createUIMessageStreamResponse({ stream }) as Response;
  }

  try {
    getModelConfig();
    getRagConfig();
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

        try {
          await runner.runTurn({ runId, messages }, sink, req.signal);
        } catch (error: unknown) {
          console.error("Question agent run error:", { runId, error });
          const code = req.signal.aborted
            ? "aborted"
            : isQuotaError(error)
              ? "insufficient_quota"
              : "internal_error";
          sink.emit({ type: "run.failed", runId, code });
        }
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
