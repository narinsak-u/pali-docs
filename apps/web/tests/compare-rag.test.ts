import type {
  AgentTurnInput,
  AgentTurnRunner,
} from "@/lib/agent/types";
import { runEvaluationCase } from "@/scripts/evaluate-rag";
import {
  assertComparisonReady,
  compareAggregates,
  compareRecords,
  createComparisonSummary,
  createFastApiRunner,
} from "@/scripts/compare-rag";
import { aggregateEvaluation } from "@/lib/rag/evaluation";
import type { RagEvaluationRecord } from "@/lib/rag/evaluation";
import { describe, expect, it, vi } from "vitest";

function readyManifest() {
  const cohorts = [
    ["thai-single-source", "th", 10, 1],
    ["english-single-source", "en", 5, 1],
    ["multi-source", "en", 5, 2],
    ["paraphrase-terminology", "en", 5, 1],
    ["insufficient-evidence", "en", 3, 0],
    ["retrieved-prompt-injection", "en", 2, 1],
  ] as const;
  const cases = cohorts.flatMap(([category, language, count, sourceCount]) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${category}-${index}`,
      category,
      language,
      question: `Question ${category} ${index}`,
      expectedOutcome:
        category === "insufficient-evidence" ? "insufficient-evidence" : "grounded",
      expectedSourceIds: Array.from(
        { length: sourceCount },
        (_, sourceIndex) => `source-${category}-${index}-${sourceIndex}`,
      ),
    })),
  );
  return {
    schemaVersion: 1,
    status: "ready",
    corpusRevision: "corpus-1",
    baseline: {
      outcomeAccuracy: 0.9,
      sourceRecall: 0.9,
      citationPrecision: 0.95,
      citationCompleteness: 0.9,
      maxLatencyP95: 500,
    },
    cases,
  };
}

function envelope(
  runId: string,
  sequence: number,
  eventType: string,
  payload: Record<string, unknown>,
): string {
  return `data: ${JSON.stringify({
    schemaVersion: "v1",
    runId,
    eventId: `${runId}:${sequence}`,
    sequence,
    eventType,
    timestamp: "2026-09-23T00:00:00.000Z",
    payload,
  })}\n\n`;
}

function streamResponse(body: string, contentType = "text/event-stream") {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

const readyIdentity = {
  status: "ready" as const,
  service: "api" as const,
  model: "Qwen/Qwen3-8B",
  servingRevision: "vllm-1",
  imageDigest: "vllm@sha256:test",
  tokenizer: "Qwen/Qwen3-8B",
  tokenizerRevision: "vllm-1",
  parser: "hermes",
  chatTemplate: "qwen3-pinned",
  precision: "bfloat16",
  servingLimits: {
    maxModelLen: 8192,
    maxNumSeqs: 4,
    maxNumBatchedTokens: 8192,
    gpuMemoryUtilization: 0.9,
    maxOutputTokens: 768,
  },
};

const input: AgentTurnInput = {
  runId: "run-1",
  messages: [
    {
      id: "message-1",
      role: "user",
      parts: [{ type: "text", text: "What is Pali?" }],
    },
  ],
};

describe("comparison readiness", () => {
  it("rejects incomplete manifests before configuration is accepted", () => {
    expect(() =>
      assertComparisonReady(
        {
          schemaVersion: 1,
          status: "incomplete",
          blocker: "source mapping is unavailable",
          corpusRevision: null,
          baseline: null,
          cases: [],
        },
        "corpus-1",
      ),
    ).toThrow("source mapping is unavailable");
  });

  it("accepts a complete manifest with the matching nonblank revision", () => {
    expect(assertComparisonReady(readyManifest(), " corpus-1 ").corpusRevision).toBe(
      "corpus-1",
    );
  });

  it("rejects missing and mismatched configured revisions", () => {
    expect(() => assertComparisonReady(readyManifest(), "  ")).toThrow(
      "PINECONE_CORPUS_REVISION",
    );
    expect(() => assertComparisonReady(readyManifest(), "corpus-2")).toThrow(
      "corpus revision mismatch",
    );
  });
});

describe("paired deltas", () => {
  const record = (
    overrides: Partial<RagEvaluationRecord> = {},
  ): RagEvaluationRecord => ({
    caseId: "case-1",
    category: "multi-source",
    language: "en",
    runner: "ai-sdk",
    corpusRevision: "corpus-1",
    modelId: "model-1",
    expectedOutcome: "grounded",
    actualOutcome: "grounded",
    expectedSourceIds: ["source-a", "source-b"],
    retrievedSourceIds: ["source-a", "source-b"],
    citationSourceIds: ["source-a", "source-b"],
    retrievalAttempts: 1,
    latencyMs: { total: 100, retrieval: 40, generation: 60 },
    candidateCount: 4,
    acceptedCount: 2,
    hierarchyExpansion: false,
    rerankerUsed: false,
    sourceRecall: 1,
    citationPrecision: 0.5,
    citationCompleteness: 0.5,
    cost: 0.01,
    ...overrides,
  });

  it("calculates LangGraph minus AI SDK retrieval and citation deltas", () => {
    const comparison = compareRecords(
      record(),
      record({
        runner: "langgraph",
        actualOutcome: "insufficient-evidence",
        citationSourceIds: ["source-a", "other"],
        candidateCount: 4,
        acceptedCount: 2,
        sourceRecall: 1,
        citationPrecision: 0,
        citationCompleteness: 0.5,
        latencyMs: { total: 125, retrieval: 50, generation: 75 },
        tokenUse: undefined,
        cost: undefined,
      }),
    );
    expect(comparison).toMatchObject({
      caseId: "case-1",
      deltas: {
        latencyMs: 25,
        outcomeChanged: true,
        candidateCount: 0,
        acceptedCount: 0,
        sourceRecall: 0,
        citationPrecision: -0.5,
        citationCompleteness: -0.5,
        cost: null,
      },
    });
  });

  it("reports deterministic aggregate deltas for quality configurations", () => {
    const baseline = aggregateEvaluation([record()]);
    const candidate = aggregateEvaluation([
      record({
        candidateCount: 8,
        acceptedCount: 1,
        retrievedSourceIds: ["source-a"],
        citationSourceIds: ["source-a"],
        hierarchyExpansion: true,
        rerankerUsed: true,
        latencyMs: { total: 125, retrieval: 50, generation: 75 },
        tokenUse: undefined,
        cost: undefined,
      }),
    ]);

    expect(compareAggregates(baseline, candidate)).toMatchObject({
      candidateCount: 4,
      acceptedCount: -1,
      sourceRecall: -0.5,
      citationCompleteness: -0.5,
      latencyMs: 25,
      tokenUse: null,
      cost: null,
    });
  });
  it("labels dense baseline and candidate aggregates alongside their deltas", () => {
    const baseline = aggregateEvaluation([record()]);
    const candidate = aggregateEvaluation([
      record({
        runner: "langgraph",
        candidateCount: 8,
        latencyMs: { total: 125, retrieval: 50, generation: 75 },
      }),
    ]);

    expect(
      createComparisonSummary(
        { runner: "ai-sdk", retrievalConfig: "dense-baseline", aggregate: baseline },
        { runner: "langgraph", retrievalConfig: "retrieval-quality", aggregate: candidate },
      ),
    ).toEqual({
      baseline: {
        runner: "ai-sdk",
        retrievalConfig: "dense-baseline",
        aggregate: baseline,
      },
      candidate: {
        runner: "langgraph",
        retrievalConfig: "retrieval-quality",
        aggregate: candidate,
      },
      deltas: compareAggregates(baseline, candidate),
    });
  });
});

describe("FastAPI runner", () => {
  it("sends the shared turn and forwards parsed SSE events into an answered result", async () => {
    const events = [
      envelope("run-1", 0, "run.started", { runId: "run-1" }),
      envelope("run-1", 1, "retrieval.completed", {
        runId: "run-1",
        attempt: 1,
        matchCount: 1,
        corpusRevision: "corpus-1",
        acceptedSourceIds: ["source-a"],
      }),
      envelope("run-1", 2, "answer.completed", {
        runId: "run-1",
        text: "Pali is an ancient language.",
      }),
      envelope("run-1", 3, "citations.completed", {
        runId: "run-1",
        citations: [
          { id: "citation-1", source: "citation-only", title: "A source", section: null },
        ],
      }),
      envelope("run-1", 4, "suggestions.completed", {
        runId: "run-1",
        suggestions: ["Tell me more"],
      }),
      envelope("run-1", 5, "run.completed", {
        runId: "run-1",
        outcome: "answered",
      }),
    ].join("");
    const fetchImpl = vi.fn(async (url: any, request: any) => {
      if (url === "https://api.example/internal/readyz") {
        return new Response(JSON.stringify(readyIdentity), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      expect(url).toBe("https://api.example/v1/question");
      expect(request.headers).toMatchObject({
        "Content-Type": "application/json",
        Authorization: "Bearer secret",
      });
      expect(request.headers["X-Principal"]).toMatch(/^v1\..+\..+$/);
      expect(request.headers).not.toHaveProperty("X-Access-Scope");
      expect(JSON.parse(String(request.body))).toEqual({
        runId: "run-1",
        corpusRevision: "corpus-1",
        messages: [{ role: "user", content: "What is Pali?" }],
      });
      return streamResponse(events);
    });
    const sink = { emit: vi.fn() };
    const scopedInput = {
      ...input,
      accessScope: { tenant: "tenant-1", authorization: "not-forwarded" },
    };
    const runner = createFastApiRunner({
      baseUrl: "https://api.example///",
      internalToken: "secret",
      identitySecret: "identity-secret",
      corpusRevision: "corpus-1",
      fetchImpl,
    });

    await expect(runner.runTurn(scopedInput, sink)).resolves.toEqual({
      outcome: "answered",
      answer: "Pali is an ancient language.",
      citations: [
        {
          id: "citation-1",
          source: "citation-only",
          title: "A source",
        },
      ],
      suggestions: ["Tell me more"],
    });
    expect(sink.emit).toHaveBeenCalledTimes(6);
    expect(runner.getRetrievedSourceIds()).toEqual(["source-a"]);
    expect(runner.observedCorpusRevision).toBe("corpus-1");
    const { status: _status, service: _service, ...observedIdentity } = readyIdentity;
    expect(runner.observedServingMetadata).toEqual(observedIdentity);
  });

  it("fails closed when FastAPI readiness identity is missing", async () => {
    const runner = createFastApiRunner({
      baseUrl: "https://api.example",
      internalToken: "secret",
      identitySecret: "identity-secret",
      corpusRevision: "corpus-1",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })),
    });
    await expect(runner.runTurn(input, { emit: vi.fn() })).rejects.toThrow(
      "FastAPI readiness identity is incomplete",
    );
  });

  it.each([
    ["non-OK response", new Response("no", { status: 503 }), "status 503"],
    [
      "wrong content type",
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      "not an SSE stream",
    ],
  ])("rejects a %s", async (_name, response, message) => {
    const runner = createFastApiRunner({
      baseUrl: "https://api.example",
      internalToken: "secret",
      identitySecret: "identity-secret",
      corpusRevision: "corpus-1",
      fetchImpl: vi.fn(async (url: any) => url.endsWith("/readyz") ? new Response(JSON.stringify(readyIdentity), { status: 200 }) : response),
    });
    await expect(runner.runTurn(input, { emit: vi.fn() })).rejects.toThrow(message);
  });

  it("rejects malformed and unterminated SSE streams", async () => {
    const malformed = createFastApiRunner({
      baseUrl: "https://api.example",
      internalToken: "secret",
      identitySecret: "identity-secret",
      corpusRevision: "corpus-1",
      fetchImpl: vi.fn(async (url: any) => url.endsWith("/readyz") ? new Response(JSON.stringify(readyIdentity), { status: 200 }) : streamResponse("data: not-json\n\n")),
    });
    await expect(malformed.runTurn(input, { emit: vi.fn() })).rejects.toThrow(
      "not valid JSON",
    );

    const unterminated = createFastApiRunner({
      baseUrl: "https://api.example",
      internalToken: "secret",
      identitySecret: "identity-secret",
      corpusRevision: "corpus-1",
      fetchImpl: vi.fn(async (url: any) =>
        url.endsWith("/readyz") ? new Response(JSON.stringify(readyIdentity), { status: 200 }) : streamResponse(envelope("run-1", 0, "run.started", { runId: "run-1" })),
      ),
    });
    await expect(unterminated.runTurn(input, { emit: vi.fn() })).rejects.toThrow(
      "without a terminal event",
    );
  });

  it("rejects wrong run IDs and missing stream bodies", async () => {
    const wrongRunId = createFastApiRunner({
      baseUrl: "https://api.example",
      internalToken: "secret",
      identitySecret: "identity-secret",
      corpusRevision: "corpus-1",
      fetchImpl: vi.fn(async (url: any) =>
        url.endsWith("/readyz") ? new Response(JSON.stringify(readyIdentity), { status: 200 }) : streamResponse(envelope("other-run", 0, "run.started", { runId: "other-run" })),
      ),
    });
    await expect(wrongRunId.runTurn(input, { emit: vi.fn() })).rejects.toThrow(
      "Invalid LangGraph event run ID",
    );

    const missingBody = createFastApiRunner({
      baseUrl: "https://api.example",
      internalToken: "secret",
      identitySecret: "identity-secret",
      corpusRevision: "corpus-1",
      fetchImpl: vi.fn(
        async (url: any) => url.endsWith("/readyz") ? new Response(JSON.stringify(readyIdentity), { status: 200 }) :
          new Response(null, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
      ),
    });
    await expect(missingBody.runTurn(input, { emit: vi.fn() })).rejects.toThrow(
      "has no body",
    );
  });

  it("returns terminal run.failed as a non-answer result", async () => {
    const runner = createFastApiRunner({
      baseUrl: "https://api.example",
      internalToken: "secret",
      identitySecret: "identity-secret",
      corpusRevision: "corpus-1",
      fetchImpl: vi.fn(async (url: any) =>
        url.endsWith("/readyz") ? new Response(JSON.stringify(readyIdentity), { status: 200 }) : streamResponse(
          [
            envelope("run-1", 0, "run.started", { runId: "run-1" }),
            envelope("run-1", 1, "run.failed", { runId: "run-1", code: "runner_error" }),
          ].join(""),
        ),
      ),
    });
    await expect(runner.runTurn(input, { emit: vi.fn() })).resolves.toEqual({
      outcome: "failed",
      code: "runner_error",
    });
  });
});

describe("same-case paired execution", () => {
  it("runs each runner once for the same evaluation case", async () => {
    const calls: string[] = [];
    const runner = (name: string): AgentTurnRunner => ({
      async runTurn(turn, sink) {
        calls.push(name);
        sink.emit({ type: "run.started", runId: turn.runId });
        sink.emit({
          type: "retrieval.started",
          runId: turn.runId,
          attempt: 1,
          query: "question",
        });
        sink.emit({
          type: "retrieval.completed",
          runId: turn.runId,
          attempt: 1,
          matchCount: 1,
        });
        sink.emit({ type: "generation.started", runId: turn.runId });
        sink.emit({
          type: "run.completed",
          runId: turn.runId,
          outcome: "answered",
        });
        return {
          outcome: "answered",
          answer: "answer",
          citations: [
            { id: "citation-1", source: "source-a", title: "A source" },
          ],
          suggestions: [],
        };
      },
    });
    const evaluationCase = assertComparisonReady(
      readyManifest(),
      "corpus-1",
    ).cases[0];
    const [aiSdk, langGraph] = await Promise.all([
      runEvaluationCase({
        evaluationCase,
        runner: runner("ai-sdk"),
        runnerName: "ai-sdk",
        corpusRevision: "corpus-1",
        modelId: "model-1",
        retrievedSourceIds: () => ["source-a"],
      }),
      runEvaluationCase({
        evaluationCase,
        runner: runner("langgraph"),
        runnerName: "langgraph",
        corpusRevision: "corpus-1",
        modelId: "model-1",
        retrievedSourceIds: () => ["source-a"],
      }),
    ]);
    expect(calls).toEqual(["ai-sdk", "langgraph"]);
    expect(aiSdk.caseId).toBe(langGraph.caseId);
    expect(aiSdk.runner).toBe("ai-sdk");
    expect(langGraph.runner).toBe("langgraph");
  });
});
