import { describe, expect, it } from "vitest";
import { consumeLangGraphSse } from "@/lib/agent/langgraph-event-adapter";
import type { AgentEvent } from "@/lib/agent/types";

function envelope(
  sequence: number,
  eventType: string,
  payload: Record<string, unknown>,
) {
  return {
    schemaVersion: "v1",
    runId: "run-1",
    eventId: `event-${sequence}`,
    sequence,
    eventType,
    timestamp: "2026-09-26T00:00:00.000Z",
    payload: { runId: "run-1", ...payload },
  };
}

async function consume(events: unknown[]): Promise<AgentEvent[]> {
  const response = new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
  );
  const emitted: AgentEvent[] = [];
  await consumeLangGraphSse(
    response,
    { emit: (event) => emitted.push(event) },
    new AbortController().signal,
    "run-1",
  );
  return emitted;
}

describe("LangGraph retrieval event contract", () => {
  it("preserves provenance and versioned reranker telemetry without passage bodies", async () => {
    const emitted = await consume([
      envelope(0, "retrieval.completed", {
        attempt: 1,
        matchCount: 1,
        acceptedProvenance: [
          {
            id: "chunk-1",
            source: "book-1",
            sourceVersion: "source-v1",
            title: "Chapter 1",
            section: "§1",
            parentId: "parent-1",
          },
        ],
        candidateCount: 2,
        acceptedCount: 1,
        hierarchyExpansion: true,
        rerankerUsed: true,
        rerankerFallbackReason: null,
        rerankerLatencyMs: 12.5,
        rerankerModelVersion: "lexical-v1",
        retrievalConfigVersion: "rag-v1",
      }),
      envelope(1, "run.completed", { outcome: "answered" }),
    ]);

    expect(emitted[0]).toMatchObject({
      type: "retrieval.completed",
      acceptedProvenance: [
        {
          id: "chunk-1",
          source: "book-1",
          sourceVersion: "source-v1",
          section: "§1",
          parentId: "parent-1",
        },
      ],
      rerankerFallbackReason: null,
      rerankerLatencyMs: 12.5,
      rerankerModelVersion: "lexical-v1",
      retrievalConfigVersion: "rag-v1",
    });
    expect(JSON.stringify(emitted)).not.toContain("text");
  });
  it("accepts legacy successful reranker events without telemetry additions", async () => {
    const emitted = await consume([
      envelope(0, "retrieval.completed", {
        attempt: 1,
        matchCount: 1,
        rerankerUsed: true,
      }),
      envelope(1, "run.completed", { outcome: "answered" }),
    ]);

    expect(emitted[0]).toMatchObject({
      type: "retrieval.completed",
      rerankerUsed: true,
    });
  });
  it("forwards cost telemetry and strict tool lifecycle events", async () => {
    const emitted = await consume([
      envelope(0, "tool.started", { toolId: "retrieval-tool" }),
      envelope(1, "tool.completed", { toolId: "retrieval-tool" }),
      envelope(2, "run.completed", {
        outcome: "answered",
        cost: 0.12,
        promptTokens: 20,
        completionTokens: 8,
        queueMs: 3.5,
      }),
    ]);
    expect(emitted).toEqual([
      { type: "tool.started", runId: "run-1", toolId: "retrieval-tool" },
      { type: "tool.completed", runId: "run-1", toolId: "retrieval-tool" },
      {
        type: "run.completed",
        runId: "run-1",
        outcome: "answered",
        cost: 0.12,
        promptTokens: 20,
        completionTokens: 8,
        queueMs: 3.5,
      },
    ]);
  });


  it("rejects a new reranker success event without required telemetry dimensions", async () => {
    await expect(
      consume([
        envelope(0, "retrieval.completed", {
          attempt: 1,
          matchCount: 1,
          rerankerUsed: true,
          rerankerFallbackReason: null,
        }),
        envelope(1, "run.completed", { outcome: "answered" }),
      ]),
    ).rejects.toThrow();
  });
});
