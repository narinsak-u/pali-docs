import type {
  AgentEvent,
  AgentEventSink,
  AgentTurnOutcome,
} from "@/lib/agent/types";

export interface AgentTraceRecord {
  eventType: AgentEvent["type"];
  runId: string;
  timestamp: number;
  attempt?: number;
  matchCount?: number;
  outcome?: AgentTurnOutcome;
  code?: string;
  durationMs?: number;
}

type RecordAgentTrace = (record: AgentTraceRecord) => void;

export function createStructuredTraceSink(
  record: RecordAgentTrace,
): AgentEventSink {
  const runStartedAt = new Map<string, number>();
  const retrievalStartedAt = new Map<
    string,
    { attempt: number; timestamp: number }
  >();
  const generationStartedAt = new Map<string, number>();
  let terminated = false;

  return {
    emit(event) {
      if (terminated) {
        throw new Error("Agent event stream has already terminated");
      }

      const timestamp = Date.now();
      const base = {
        eventType: event.type,
        runId: event.runId,
        timestamp,
      };

      switch (event.type) {
        case "run.started":
          runStartedAt.set(event.runId, timestamp);
          record(base);
          break;
        case "retrieval.started":
          retrievalStartedAt.set(event.runId, {
            attempt: event.attempt,
            timestamp,
          });
          record({ ...base, attempt: event.attempt });
          break;
        case "retrieval.completed": {
          const startedAt = retrievalStartedAt.get(event.runId)?.timestamp;
          record({
            ...base,
            attempt: event.attempt,
            matchCount: event.matchCount,
            ...(startedAt === undefined
              ? {}
              : { durationMs: timestamp - startedAt }),
          });
          retrievalStartedAt.delete(event.runId);
          break;
        }
        case "retrieval.failed": {
          const retrieval = retrievalStartedAt.get(event.runId);
          record({
            ...base,
            ...(retrieval === undefined
              ? {}
              : {
                  attempt: retrieval.attempt,
                  durationMs: timestamp - retrieval.timestamp,
                }),
            code: event.code,
          });
          retrievalStartedAt.delete(event.runId);
          break;
        }
        case "query.rewritten":
          record({ ...base, attempt: event.attempt });
          break;
        case "generation.started":
          generationStartedAt.set(event.runId, timestamp);
          record(base);
          break;
        case "answer.completed": {
          const startedAt = generationStartedAt.get(event.runId);
          record({
            ...base,
            ...(startedAt === undefined
              ? {}
              : { durationMs: timestamp - startedAt }),
          });
          generationStartedAt.delete(event.runId);
          break;
        }
        case "citations.completed":
        case "suggestions.completed":
          record(base);
          break;
        case "run.completed": {
          const startedAt = runStartedAt.get(event.runId);
          record({
            ...base,
            outcome: event.outcome,
            ...(startedAt === undefined
              ? {}
              : { durationMs: timestamp - startedAt }),
          });
          break;
        }
        case "run.failed": {
          const startedAt = runStartedAt.get(event.runId);
          record({
            ...base,
            code: event.code,
            ...(startedAt === undefined
              ? {}
              : { durationMs: timestamp - startedAt }),
          });
          break;
        }
      }

      if (event.type === "run.completed" || event.type === "run.failed") {
        terminated = true;
      }
    },
  };
}

export function createCompositeEventSink(
  sinks: readonly AgentEventSink[],
): AgentEventSink {
  let terminated = false;

  return {
    emit(event) {
      if (terminated) {
        throw new Error("Agent event stream has already terminated");
      }

      for (const sink of sinks) {
        sink.emit(event);
      }

      if (event.type === "run.completed" || event.type === "run.failed") {
        terminated = true;
      }
    },
  };
}
