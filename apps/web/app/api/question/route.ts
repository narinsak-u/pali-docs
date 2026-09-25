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
import { getRolloutConfig, selectRagBackend } from "@/lib/config/rollout";
import { isQuotaError } from "@/lib/services/quiz-pipeline";
import {
  parseQuestionRequestBody,
  type SafeQuestionRequest,
} from "@/lib/schemas/question-request";

export const runtime = "nodejs";
export const maxDuration = 120;

const JSON_HEADERS = { "Content-Type": "application/json" };

const FASTAPI_REQUEST_TIMEOUT_MS = 15_000;

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

function createAiSdkResponse(
  messages: SafeQuestionRequest["messages"],
  runId: string,
  req: Request,
): Response {
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

export async function POST(req: Request): Promise<Response> {
  let messages: SafeQuestionRequest["messages"];
  try {
    ({ messages } = await parseQuestionRequestBody(req));
  } catch {
    return errorResponse(400, "invalid_request", "Invalid request");
  }

  const runId = globalThis.crypto.randomUUID();
  const backend = selectRagBackend(runId, getRolloutConfig());

  if (backend === "langgraph") {
    const baseUrl = process.env.FASTAPI_BASE_URL?.trim().replace(/\/+$/, "");
    const internalToken = process.env.FASTAPI_INTERNAL_TOKEN?.trim();
    if (!baseUrl || !internalToken) {
      console.error("LangGraph question fallback:", {
        runId,
        reason: "missing_configuration",
      });
      return createAiSdkResponse(messages, runId, req);
    }
    let backendResponse: Response;
    const backendSignal = AbortSignal.any([
      req.signal,
      AbortSignal.timeout(FASTAPI_REQUEST_TIMEOUT_MS),
    ]);
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
        signal: backendSignal,
      });
    } catch (error: unknown) {
      if (req.signal.aborted) throw error;
      console.error("LangGraph question fallback:", { runId, error });
      return createAiSdkResponse(messages, runId, req);
    }

    if (!backendResponse.ok) {
      if (req.signal.aborted) req.signal.throwIfAborted();
      console.error("LangGraph question fallback:", {
        runId,
        reason: "backend_status",
        status: backendResponse.status,
      });
      return createAiSdkResponse(messages, runId, req);
    }

    if (
      !backendResponse.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("text/event-stream")
    ) {
      if (req.signal.aborted) req.signal.throwIfAborted();
      console.error("LangGraph question fallback:", {
        runId,
        reason: "invalid_content_type",
      });
      return createAiSdkResponse(messages, runId, req);
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

  return createAiSdkResponse(messages, runId, req);
}
