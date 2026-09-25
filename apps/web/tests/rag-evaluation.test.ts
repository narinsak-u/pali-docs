import type { AgentTurnRunner } from "@/lib/agent/types";
import { runEvaluationCase } from "@/scripts/evaluate-rag";
import { describe, expect, it } from "vitest";
import {
  aggregateEvaluation,
  assertEvaluationManifestReady,
  citationCompleteness,
  citationPrecision,
  evaluateGates,
  firstAcceptedSourceRank,
  outcomeAccuracy,
  sourceRecall,
  summarizeLatencies,
  type RagEvaluationRecord,
  parseEvaluationManifest,
} from "@/lib/rag/evaluation";

function record(
  overrides: Partial<RagEvaluationRecord> = {},
): RagEvaluationRecord {
  return {
    caseId: "case-1",
    category: "multi-source",
    language: "en",
    runner: "ai-sdk",
    corpusRevision: "corpus-1",
    modelId: "model-1",
    expectedOutcome: "grounded",
    actualOutcome: "grounded",
    expectedSourceIds: ["source-a", "source-b"],
    forbiddenSourceIds: [],
    retrievedSourceIds: ["source-x", "source-b", "source-a"],
    citationSourceIds: ["source-a", "source-b"],
    retrievalAttempts: 1,
    latencyMs: {
      total: 100,
      retrieval: 40,
      generation: 60,
    },
    candidateCount: 4,
    acceptedCount: 2,
    hierarchyExpansion: false,
    rerankerUsed: false,
    sourceRecall: 1,
    citationPrecision: 1,
    citationCompleteness: 1,
    tokenUse: 120,
    cost: 0.01,
    ...overrides,
  };
}

describe("RAG evaluation metrics", () => {
  it("calculates source recall from unique expected source IDs", () => {
    expect(
      sourceRecall(["source-a", "source-a", "source-b"], ["source-b"]),
    ).toBe(0.5);
    expect(sourceRecall([], [])).toBe(1);
  });

  it("returns the one-based rank of the first accepted source", () => {
    expect(
      firstAcceptedSourceRank(
        ["source-x", "source-b", "source-a"],
        ["source-a", "source-b"],
      ),
    ).toBe(2);
    expect(firstAcceptedSourceRank(["source-x"], ["source-a"])).toBeNull();
    expect(firstAcceptedSourceRank([], [])).toBeNull();
  });

  it("calculates exact outcome accuracy", () => {
    expect(
      outcomeAccuracy([
        record(),
        record({
          caseId: "case-2",
          expectedOutcome: "insufficient-evidence",
          actualOutcome: "insufficient-evidence",
          expectedSourceIds: [],
          retrievedSourceIds: [],
          citationSourceIds: [],
        }),
        record({ caseId: "case-3", actualOutcome: "failed" }),
      ]),
    ).toBeCloseTo(2 / 3);
  });

  it("calculates citation precision against reviewed sources", () => {
    expect(citationPrecision(["source-a", "source-b"], ["source-a", "other"])).toBe(
      0.5,
    );
    expect(citationPrecision([], [])).toBe(1);
    expect(citationPrecision([], ["other"])).toBe(0);
  });

  it("calculates citation completeness from unique reviewed sources", () => {
    expect(
      citationCompleteness(
        ["source-a", "source-b", "source-b"],
        ["source-b"],
      ),
    ).toBe(0.5);
    expect(citationCompleteness([], [])).toBe(1);
  });

  it("aggregates average attempts and all deterministic metrics", () => {
    const aggregate = aggregateEvaluation([
      record(),
      record({
        caseId: "case-2",
        expectedOutcome: "insufficient-evidence",
        actualOutcome: "insufficient-evidence",
        expectedSourceIds: [],
        retrievedSourceIds: [],
        citationSourceIds: [],
        retrievalAttempts: 2,
        latencyMs: { total: 200, retrieval: 120, generation: 80 },
      }),
    ]);

    expect(aggregate).toMatchObject({
      caseCount: 2,
      sourceRecall: 1,
      meanFirstAcceptedSourceRank: 2,
      outcomeAccuracy: 1,
      citationPrecision: 1,
      citationCompleteness: 1,
      averageRetrievalAttempts: 1.5,
    });
  });

  it("uses nearest-rank p50 and p95 stage latency aggregation", () => {

    expect(
      summarizeLatencies([
        { total: 50, retrieval: 5, generation: 45 },
        { total: 10, retrieval: 1, generation: 9 },
        { total: 40, retrieval: 4, generation: 36 },
        { total: 20, retrieval: 2, generation: 18 },
        { total: 30, retrieval: 3, generation: 27 },
      ]),
    ).toEqual({
      total: { p50: 30, p95: 50 },
      retrieval: { p50: 3, p95: 5 },
      generation: { p50: 27, p95: 45 },
    });
  });
  it("does not inflate source metrics with insufficient-evidence cases", () => {
    const aggregate = aggregateEvaluation([
      record({
        retrievedSourceIds: ["source-a"],
        citationSourceIds: ["source-a"],
      }),
      record({
        caseId: "case-2",
        expectedOutcome: "insufficient-evidence",
        actualOutcome: "insufficient-evidence",
        expectedSourceIds: [],
        retrievedSourceIds: [],
        citationSourceIds: [],
      }),
    ]);

    expect(aggregate.sourceRecall).toBe(0.5);
    expect(aggregate.citationCompleteness).toBe(0.5);
  });

  it("reports every nonzero evaluation gate violation", () => {
    const records = [
      record({
        actualOutcome: "failed",
        retrievedSourceIds: ["source-a"],
        citationSourceIds: ["source-a", "unaccepted", "forbidden"],
        forbiddenSourceIds: ["forbidden"],
        retrievalAttempts: 3,
      }),
    ];
    const aggregate = aggregateEvaluation(records);

    expect(evaluateGates(records, aggregate, { outcomeAccuracy: 1 })).toEqual([
      "outcome accuracy 0.000 is below baseline 1.000",
      "citation precision 0.333 is below required 1.000",
      "case case-1 exceeded two retrieval attempts (3)",
      "case case-1 emitted citations outside accepted evidence: forbidden, unaccepted",
      "case case-1 emitted forbidden citations: forbidden",
    ]);
  });
});


describe("RAG evaluation manifest safeguards", () => {
  it("refuses an incomplete manifest with its external prerequisite", () => {
    const manifest = parseEvaluationManifest({
      schemaVersion: 1,
      status: "incomplete",
      blocker:
        "authoritative source IDs and corpus revision are required from the ingestion owner",
      corpusRevision: null,
      baseline: null,
      cases: [
        {
          id: "insufficient-1",
          category: "insufficient-evidence",
          language: "en",
          question: "What is tomorrow's weather?",
          expectedOutcome: "insufficient-evidence",
          expectedSourceIds: [],
        },
      ],
    });

    expect(() => assertEvaluationManifestReady(manifest)).toThrow(
      "RAG evaluation prerequisite unavailable: authoritative source IDs and corpus revision are required from the ingestion owner",
    );
  });

  it("rejects unsupported outcomes, revision mismatches, and configured regressions", () => {
    const records = [
      record({
        actualOutcome: "not-supported" as RagEvaluationRecord["actualOutcome"],
        corpusRevision: "corpus-old",
        retrievedSourceIds: ["source-a"],
        sourceRecall: 0.5,
      }),
    ];

    const violations = evaluateGates(
      records,
      aggregateEvaluation(records),
      { outcomeAccuracy: 0, sourceRecall: 1 },
      "corpus-current",
    );
    expect(violations).toEqual([
      "source recall 0.500 is below baseline 1.000",
      "case case-1 has an unsupported outcome: not-supported",
      "case case-1 uses corpus revision corpus-old instead of corpus-current",
      "case case-1 emitted citations outside accepted evidence: source-b",
    ]);
  });

  it("rejects a ready manifest without 30 reviewed cases", () => {
    const manifest = parseEvaluationManifest({
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
      cases: [],
    });

    expect(() => assertEvaluationManifestReady(manifest)).toThrow(
      "RAG evaluation manifest must contain at least 30 reviewed cases",
    );
  });

  it("rejects 30 reviewed cases that omit required evaluation cohorts", () => {
    const manifest = parseEvaluationManifest({
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
      cases: Array.from({ length: 30 }, (_, index) => ({
        id: `insufficient-${index}`,
        category: "insufficient-evidence",
        language: "en",
        question: `Out-of-corpus question ${index}`,
        expectedOutcome: "insufficient-evidence",
        expectedSourceIds: [],
      })),
    });

    expect(() => assertEvaluationManifestReady(manifest)).toThrow(
      "RAG evaluation manifest is missing required cohorts: thai-single-source 0/10, english-single-source 0/5, multi-source 0/5, paraphrase-terminology 0/5, retrieved-prompt-injection 0/2",
    );
  });
});

describe("RAG evaluation records", () => {
  it("uses the runner contract while omitting prompts, answers, and passage bodies", async () => {
    const runner: AgentTurnRunner = {
      async runTurn(input, sink) {
        sink.emit({
          type: "retrieval.started",
          runId: input.runId,
          attempt: 1,
          query: "private rewritten query",
        });
        sink.emit({
          type: "retrieval.completed",
          runId: input.runId,
          attempt: 1,
          matchCount: 4,
          acceptedSourceIds: ["source-a"],
          candidateCount: 4,
          acceptedCount: 1,
          hierarchyExpansion: true,
          rerankerUsed: true,
        });
        sink.emit({ type: "generation.started", runId: input.runId });
        return {
          outcome: "answered",
          answer: "private answer body",
          citations: [
            {
              id: "vector-id",
              source: "source-a",
              title: "Private title",
            },
          ],
          suggestions: [],
        };
      },
    };
    const ticks = [0, 10, 30, 40, 100];

    const evaluationRecord = await runEvaluationCase({
      evaluationCase: {
        id: "case-safe-record",
        category: "english-single-source",
        language: "en",
        question: "private user prompt",
        expectedOutcome: "grounded",
        expectedSourceIds: ["source-a"],
      },
      runner,
      runnerName: "ai-sdk",
      corpusRevision: "corpus-1",
      modelId: "model-1",
      retrievedSourceIds: () => ["source-a"],
      now: () => ticks.shift() ?? 100,
    });

    expect(evaluationRecord).toMatchObject({
      caseId: "case-safe-record",
      actualOutcome: "grounded",
      retrievedSourceIds: ["source-a"],
      citationSourceIds: ["source-a"],
      retrievalAttempts: 1,
      latencyMs: { total: 100, retrieval: 20, generation: 60 },
      candidateCount: 4,
      acceptedCount: 1,
      hierarchyExpansion: true,
      rerankerUsed: true,
      sourceRecall: 1,
      citationPrecision: 1,
      citationCompleteness: 1,
    });
    expect(JSON.stringify(evaluationRecord)).not.toContain("private");
    expect(JSON.stringify(evaluationRecord)).not.toContain("vector-id");
  });

  it("measures an unsuccessful retrieval through terminal completion", async () => {
    const runner: AgentTurnRunner = {
      async runTurn(input, sink) {
        sink.emit({
          type: "retrieval.started",
          runId: input.runId,
          attempt: 1,
          query: "private query",
        });
        sink.emit({
          type: "retrieval.failed",
          runId: input.runId,
          code: "vector_store_unavailable",
        });
        return {
          outcome: "retrieval-unavailable",
          code: "vector_store_unavailable",
        };
      },
    };
    const ticks = [0, 10, 100];

    const evaluationRecord = await runEvaluationCase({
      evaluationCase: {
        id: "case-unavailable",
        category: "english-single-source",
        language: "en",
        question: "private user prompt",
        expectedOutcome: "grounded",
        expectedSourceIds: ["source-a"],
      },
      runner,
      runnerName: "ai-sdk",
      corpusRevision: "corpus-1",
      modelId: "model-1",
      retrievedSourceIds: () => [],
      now: () => ticks.shift() ?? 100,
    });

    expect(evaluationRecord).toMatchObject({
      actualOutcome: "retrieval-unavailable",
      retrievalAttempts: 1,
      latencyMs: { total: 100, retrieval: 90, generation: 0 },
    });
  });

  it("fails closed when the runner answers without accepted citations", async () => {
    const runner: AgentTurnRunner = {
      async runTurn() {
        return {
          outcome: "answered",
          answer: "uncited direct answer",
          citations: [],
          suggestions: [],
        };
      },
    };
    const ticks = [0, 10];

    const evaluationRecord = await runEvaluationCase({
      evaluationCase: {
        id: "case-direct-answer",
        category: "english-single-source",
        language: "en",
        question: "A corpus-grounded question",
        expectedOutcome: "grounded",
        expectedSourceIds: ["source-a"],
      },
      runner,
      runnerName: "ai-sdk",
      corpusRevision: "corpus-1",
      modelId: "model-1",
      retrievedSourceIds: () => [],
      now: () => ticks.shift() ?? 10,
    });

    expect(evaluationRecord.actualOutcome).toBe("unsupported-answer");
    expect(
      evaluateGates(
        [evaluationRecord],
        aggregateEvaluation([evaluationRecord]),
        { outcomeAccuracy: 0 },
      ),
    ).toContain(
      "case case-direct-answer returned an answer without accepted citations",
    );
  });
});