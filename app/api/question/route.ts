import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  tool,
} from "ai";
import { z } from "zod";
import { PALI_EXPERT_SYSTEM_PROMPT } from "@/lib/chat/pali-system-prompt";
import { retrieve } from "@/lib/rag/retriever";
import type { GroundingBundle } from "@/lib/rag/types";
import { getConfiguredModel } from "@/lib/services/llm-provider";
import { isQuotaError } from "@/lib/services/quiz-pipeline";
import {
  parseQuestionRequestBody,
  type SafeQuestionRequest,
} from "@/lib/schemas/question-request";

export const runtime = "nodejs";
export const maxDuration = 120;

// Append retrieved textbook context to the system prompt for grounded answers
function buildSystemWithContext(baseSystem: string, context: string): string {
  return `${baseSystem}\n\nContext from Pali textbook corpus:\n${context}\n\nUse this context to answer the question. Do not search again — you already have the necessary information.`;
}

const MAX_STEPS = 5;
const ANSWER_THRESHOLD = 150;

// Stop streaming when the model has generated a substantial answer (or hits max steps)
function stopWhenAnswered({ steps }: { steps: Array<{ text: string }> }) {
  if (steps.length >= MAX_STEPS) return true;
  const lastText = steps[steps.length - 1]?.text ?? "";
  return lastText.length > ANSWER_THRESHOLD;
}

export async function POST(req: Request) {
  let messages: SafeQuestionRequest["messages"];
  try {
    const request = await parseQuestionRequestBody(req);
    messages = request.messages;
  } catch {
    return new Response(
      JSON.stringify({
        error: "invalid_request",
        message: "Invalid request",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const { model } = getConfiguredModel();

    // Wrap the LLM call in a UI-aware message stream for real-time client updates
    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer }) => {
        let searchCompleted = false;
        let cachedResult: GroundingBundle | null = null;
        let suggestionsGenerated = false;

        // Signal the client that the model is processing the question
        writer.write({
          type: "data-status",
          data: { phase: "thinking" },
        });

        // Core RAG: LLM with tools for searching the textbook corpus and suggesting follow-ups
        const result = streamText({
          model,
          system: PALI_EXPERT_SYSTEM_PROMPT,
          messages: convertToModelMessages(messages),
          stopWhen: stopWhenAnswered,
          tools: {
            // Pinecone vector search — runs exactly once per question to avoid embedding costs
            searchDocs: tool({
              description:
                "Search the Pali textbook corpus for relevant passages.",
              inputSchema: z.object({ query: z.string().min(1) }),
              execute: async ({ query }, { toolCallId, abortSignal }) => {
                // Return cached results on repeated calls — prevents duplicate Pinecone queries
                if (searchCompleted && cachedResult) {
                  writer.write({
                    type: "data-task",
                    data: {
                      id: toolCallId,
                      label: "ค้นหาเอกสาร",
                      status: "done",
                      matchCount:
                        cachedResult.status === "grounded"
                          ? cachedResult.passages.length
                          : 0,
                    },
                  });
                  return cachedResult;
                }
                searchCompleted = true;
                // Notify client that search has started
                writer.write({
                  type: "data-task",
                  data: {
                    id: toolCallId,
                    label: "ค้นหาเอกสาร",
                    status: "running",
                    query,
                  },
                });

                const grounding = await retrieve(
                  { query, attempt: 0 },
                  abortSignal,
                );
                cachedResult = grounding;

                if (grounding.status === "unavailable") {
                  writer.write({
                    type: "data-task",
                    data: {
                      id: toolCallId,
                      label: "ค้นหาเอกสาร",
                      status: "error",
                      message: grounding.errorCode,
                    },
                  });
                  return grounding;
                }

                const matchCount = grounding.passages.length;
                writer.write({
                  type: "data-task",
                  data: {
                    id: toolCallId,
                    label: "ค้นหาเอกสาร",
                    status: "done",
                    matchCount,
                  },
                });
                const excerpts = grounding.passages.map((passage) =>
                  passage.text.slice(0, 120).trim(),
                );
                // Show matched excerpts to the user
                writer.write({
                  type: "data-reasoning",
                  data: {
                    summary: `พบเอกสารที่เกี่ยวข้อง ${matchCount} รายการ`,
                    excerpts,
                  },
                });
                return grounding;
              },
            }),
            // Generate 3 Thai follow-up questions after the answer
            suggestQuestions: tool({
              description:
                "Generate 3 follow-up questions for the user based on the conversation.",
              inputSchema: z.object({
                suggestions: z.array(z.string().min(1)).min(1).max(3),
              }),
              execute: async ({ suggestions }) => {
                if (suggestionsGenerated) return { ok: false };
                suggestionsGenerated = true;
                if (suggestions.length === 0) return { ok: false };
                writer.write({
                  type: "data-suggestions",
                  data: { suggestions },
                });
                return { ok: true };
              },
            }),
          },
          // After search completes: inject context into system prompt and disable search tool
          prepareStep: async ({ steps }) => {
            for (const step of steps) {
              for (const tr of step.toolResults) {
                if (
                  tr.toolName === "searchDocs" &&
                  tr.output &&
                  typeof tr.output === "object" &&
                  "status" in tr.output &&
                  tr.output.status === "grounded" &&
                  "context" in tr.output &&
                  typeof tr.output.context === "string"
                ) {
                  writer.write({
                    type: "data-status",
                    data: { phase: "answering" },
                  });
                  return {
                    system: buildSystemWithContext(
                      PALI_EXPERT_SYSTEM_PROMPT,
                      tr.output.context,
                    ),
                    // Remove searchDocs so model cannot call it again — saves cost
                    activeTools: ["suggestQuestions"] as const,
                  };
                }
              }
            }
            return undefined;
          },
        });

        // Merge LLM output into the UI stream and wait for completion
        writer.merge(result.toUIMessageStream({ sendReasoning: false }));
        await result.consumeStream();
      },
    });

    return createUIMessageStreamResponse({ stream }) as unknown as Response;
  } catch (error: unknown) {
    console.error("Question API error:", error);
    if (isQuotaError(error)) {
      return new Response(
        JSON.stringify({
          error: "insufficient_quota",
          message: "You exceeded your current quota",
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        error: "internal_error",
        message: "Internal server error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
