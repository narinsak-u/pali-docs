import type { AgentEvent, AgentEventSink } from "@/lib/agent/types";
import { citationSchema } from "@/lib/schemas/ai-data-parts";
import { z } from "zod";

const eventTypes = [
  "run.started",
  "retrieval.started",
  "retrieval.completed",
  "retrieval.failed",
  "query.rewritten",
  "generation.started",
  "answer.completed",
  "citations.completed",
  "suggestions.completed",
  "run.completed",
  "run.failed",
] as const;

const envelopeSchema = z
  .object({
    schemaVersion: z.literal("v1"),
    runId: z.string().min(1),
    eventId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    eventType: z.enum(eventTypes),
    timestamp: z.string().datetime({ offset: true }),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

const runPayloadSchema = z.object({ runId: z.string().min(1) }).strict();
const retrievalStartedPayloadSchema = z
  .object({ runId: z.string().min(1), attempt: z.number().int().positive(), query: z.string().min(1) })
  .strict();
const retrievalCompletedPayloadSchema = z
  .object({ runId: z.string().min(1), attempt: z.number().int().positive(), matchCount: z.number().int().nonnegative() })
  .strict();
const codePayloadSchema = z.object({ runId: z.string().min(1), code: z.string().min(1) }).strict();
const rewrittenPayloadSchema = z
  .object({ runId: z.string().min(1), attempt: z.number().int().positive(), query: z.string().min(1) })
  .strict();
const answerPayloadSchema = z.object({ runId: z.string().min(1), text: z.string().min(1) }).strict();
const citationPayloadSchema = z
  .object({
    runId: z.string().min(1),
    citations: z
      .array(
        z
          .object({
            id: z.string().min(1),
            source: z.string().min(1),
            title: z.string().min(1),
            section: z.string().nullable().optional(),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
const suggestionsPayloadSchema = z
  .object({ runId: z.string().min(1), suggestions: z.array(z.string().min(1)).min(1).max(3) })
  .strict();
const completedPayloadSchema = z
  .object({
    runId: z.string().min(1),
    outcome: z.enum(["answered", "insufficient-evidence", "retrieval-unavailable", "failed"]),
  })
  .strict();

function parseBackendEvent(value: unknown, runId: string, sequence: number): AgentEvent {
  const envelope = envelopeSchema.parse(value);
  if (envelope.runId !== runId || envelope.sequence !== sequence) {
    throw new Error("Invalid LangGraph event sequence");
  }

  const requireRunId = <T extends { runId: string }>(payload: T): T => {
    if (payload.runId !== envelope.runId) throw new Error("Invalid LangGraph event run ID");
    return payload;
  };

  switch (envelope.eventType) {
    case "run.started":
    case "generation.started":
      requireRunId(runPayloadSchema.parse(envelope.payload));
      return { type: envelope.eventType, runId: envelope.runId };
    case "retrieval.started": {
      const payload = requireRunId(retrievalStartedPayloadSchema.parse(envelope.payload));
      return { type: envelope.eventType, runId: envelope.runId, attempt: payload.attempt, query: payload.query };
    }
    case "retrieval.completed": {
      const payload = requireRunId(retrievalCompletedPayloadSchema.parse(envelope.payload));
      return { type: envelope.eventType, runId: envelope.runId, attempt: payload.attempt, matchCount: payload.matchCount };
    }
    case "retrieval.failed": {
      const payload = requireRunId(codePayloadSchema.parse(envelope.payload));
      return { type: envelope.eventType, runId: envelope.runId, code: payload.code };
    }
    case "query.rewritten": {
      const payload = requireRunId(rewrittenPayloadSchema.parse(envelope.payload));
      return { type: envelope.eventType, runId: envelope.runId, attempt: payload.attempt, query: payload.query };
    }
    case "answer.completed": {
      const payload = requireRunId(answerPayloadSchema.parse(envelope.payload));
      return { type: envelope.eventType, runId: envelope.runId, text: payload.text };
    }
    case "citations.completed": {
      const payload = requireRunId(citationPayloadSchema.parse(envelope.payload));
      return {
        type: envelope.eventType,
        runId: envelope.runId,
        citations: payload.citations.map(({ section, ...citation }) =>
          citationSchema.parse(section === undefined || section === null ? citation : { ...citation, section }),
        ),
      };
    }
    case "suggestions.completed": {
      const payload = requireRunId(suggestionsPayloadSchema.parse(envelope.payload));
      return { type: envelope.eventType, runId: envelope.runId, suggestions: payload.suggestions };
    }
    case "run.completed": {
      const payload = requireRunId(completedPayloadSchema.parse(envelope.payload));
      return { type: envelope.eventType, runId: envelope.runId, outcome: payload.outcome };
    }
    case "run.failed": {
      const payload = requireRunId(codePayloadSchema.parse(envelope.payload));
      return { type: envelope.eventType, runId: envelope.runId, code: payload.code };
    }
  }
}

function parseSseData(data: string, runId: string, sequence: number): AgentEvent {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new Error("Invalid LangGraph SSE data");
  }
  return parseBackendEvent(value, runId, sequence);
}

export async function consumeLangGraphSse(
  response: Response,
  sink: AgentEventSink,
  signal: AbortSignal,
  expectedRunId: string,
): Promise<void> {
  if (!response.body) throw new Error("LangGraph response has no body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];
  let runId: string | undefined;
  let sequence = 0;
  let terminated = false;

  const consumeLine = (line: string): void => {
    if (line === "") {
      if (!dataLines.length) return;
      if (!runId) {
        const first = envelopeSchema.parse(JSON.parse(dataLines.join("\n")));
        if (first.runId !== expectedRunId) {
          throw new Error("Invalid LangGraph event run ID");
        }
        runId = first.runId;
      }
      const event = parseSseData(dataLines.join("\n"), expectedRunId, sequence);
      sequence += 1;
      sink.emit(event);
      if (event.type === "run.completed" || event.type === "run.failed") terminated = true;
      dataLines = [];
      return;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
      return;
    }
    if (!line.startsWith(":")) throw new Error("Invalid LangGraph SSE field");
  };

  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) consumeLine(line.endsWith("\r") ? line.slice(0, -1) : line);
      if (done) break;
    }
    if (buffer) consumeLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
    if (dataLines.length) consumeLine("");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!terminated) throw new Error("LangGraph stream ended without a terminal event");

}
