import { describe, expect, it, vi } from "vitest";
import {
  compareProviderEvaluations,
  decidePromotion,
  type PairedEvaluation,
  type ProviderTrace,
  type EvaluationThresholds,
} from "@/lib/rag/provider-evaluation";
import * as ProviderEvaluation from "@/lib/rag/provider-evaluation";

import { CanaryController } from "@/lib/config/canary";
const thresholds: EvaluationThresholds = {
  minOutcomeAccuracy: 1,
  minGroundingRecall: 1,
  minCitationPrecision: 1,
  minCitationCompleteness: 1,
  maxLatencyP95Ms: 1000,
  maxFailureRate: 0,
  maxCancellationRate: 0,
};

const trace = {
  schemaVersion: "v1" as const,
  provider: "local" as const,
  caseId: "case-1",
  runId: "run-1",
  inputDigest: "digest",
  accessScopeDigest: "scope",
  corpusRevision: "corpus-1",
  model: "Qwen/Qwen3-8B",
  servingRevision: "vllm-1",
  outcome: "insufficient-evidence" as const,
  cancelled: false,
  grounding: {
    corpusRevision: "corpus-1",
    expectedSourceIds: [],
    forbiddenSourceIds: [],
    retrievedSourceIds: [],
    sourceRecall: 1,
  },
  citations: {
    sourceIds: [],
    precision: 1,
    completeness: 1,
    violations: [],
  },
  quality: {
    outcomeCorrect: true,
    grounding: { sourceRecall: 1 },
    citations: { precision: 1, completeness: 1 },
  },
  unicode: {
    inputCodePointCount: 1,
    inputNonAsciiCount: 0,
    outputCodePointCount: 0,
    outputNonAsciiCount: 0,
    outputNfc: true,
  },
  latency: { totalMs: 1, retrievalMs: 1, generationMs: 0 },
  capacity: { candidateCount: 0, acceptedCount: 0 },
  toolEvents: [],
  tools: { attempted: 0, succeeded: 0, failed: 0 },
  toolTelemetryPresent: false,
  evidence: {
    outcome: "insufficient-evidence" as const,
    retrievedSourceIds: [],
    citationSourceIds: [],
    latency: { totalMs: 1, retrievalMs: 1, generationMs: 0 },
    capacity: { candidateCount: 0, acceptedCount: 0 },
    tools: { attempted: 0, succeeded: 0, failed: 0 },
    toolEvents: [],
    toolTelemetryPresent: false,
    cancelled: false,
    unicode: {
      inputCodePointCount: 1,
      inputNonAsciiCount: 0,
      outputCodePointCount: 0,
      outputNonAsciiCount: 0,
      outputNfc: true,
    },
  },
};
function paired(): PairedEvaluation {
  return {
    schemaVersion: "v1",
    caseId: "case-1",
    inputDigest: "digest",
    accessScopeDigest: "scope",
    corpusRevision: "corpus-1",
    hosted: { ...trace, provider: "hosted", model: "hosted/model", servingRevision: "hosted-1" },
    local: trace,
  };
}

describe("whole-branch blocker regressions", () => {
  it("rejects a forged comparison instead of trusting caller gate fields", () => {
    const comparison = compareProviderEvaluations([paired()], thresholds);
    const forged = {
      ...comparison,
      aggregates: {
        local: { ...comparison.aggregates.local, outcomeAccuracy: 0 },
      },
      gates: {
        ...comparison.gates,
        local: { ...comparison.gates.local, pass: true, violations: [] },
      },
    };

    const decision = decidePromotion({
      comparison: forged,
      reviewedCases: undefined,
      productionBaseline: undefined,
    });

    expect(decision.promote).toBe(false);
    expect(decision.reasons).toContain("provider comparison is stale or forged");
  });
});

  it("rejects forged derived metrics without verifiable source evidence", () => {
    const original = paired();
    const forged = {
      ...original,
      local: {
        ...original.local,
        citations: { ...original.local.citations, precision: 0 },
        quality: {
          ...original.local.quality,
          citations: { ...original.local.quality.citations, precision: 0 },
        },
      },
    };

    expect(() => compareProviderEvaluations([forged], thresholds)).toThrow(
      "citation quality evidence mismatch",
    );
  });
  it("rejects forged latency and cost metrics without raw evidence", () => {
    const original = paired();
    const forged = {
      ...original,
      local: {
        ...original.local,
        latency: { ...original.local.latency, totalMs: 0 },
        cost: 0,
      },
    };

    expect(() => compareProviderEvaluations([forged], thresholds)).toThrow(
      "trace metric evidence mismatch",
    );
  });
  it("parses legacy v1 traces but fails active latency and cost gates without evidence", () => {
    const original = paired();
    const legacyTrace = (value: ProviderTrace): ProviderTrace => {
      const { evidence, toolEvents, toolTelemetryPresent, ...legacy } = value;
      return {
        ...legacy,
        latency: { ...legacy.latency, totalMs: 0 },
        cost: 0,
      } as ProviderTrace;
    };
    const comparison = compareProviderEvaluations(
      [
        {
          ...original,
          hosted: legacyTrace(original.hosted),
          local: legacyTrace(original.local),
        },
      ],
      { ...thresholds, maxCost: 1 },
    );

    expect(comparison.gates.local.violations).toEqual(
      expect.arrayContaining([
        "local latency evidence is incomplete",
        "local cost evidence is incomplete",
      ]),
    );
    const decision = decidePromotion({
      comparison,
      reviewedCases: undefined,
      productionBaseline: undefined,
    });
    expect(decision.reasons).not.toContain("provider comparison is stale or forged");
  });
  it("rejects trace mappings that do not match authoritative reviewed cases", () => {
    const original = paired();
    const forgedPaired: PairedEvaluation[] = [
      {
        ...original,
        local: {
          ...original.local,
          accessScope: { tenant: "forged-tenant" },
          grounding: {
            ...original.local.grounding,
            expectedSourceIds: ["forged-source"],
            sourceRecall: 0,
          },
          quality: {
            ...original.local.quality,
            grounding: { sourceRecall: 0 },
            citations: { precision: 1, completeness: 0 },
          },
          citations: {
            ...original.local.citations,
            completeness: 0,
          },
        },
      },
    ];
    const comparison = compareProviderEvaluations(forgedPaired, thresholds);
    const decision = decidePromotion({
      comparison,
      reviewedCases: {
        artifactType: "ReviewedEvaluationCases",
        schemaVersion: 1,
        authoritative: true,
        corpusRevision: "corpus-1",
        cases: [
          {
            category: "insufficient-evidence",
            id: "case-1",
            language: "en",
            question: "What is unknown?",
            expectedOutcome: "insufficient-evidence",
            expectedSourceIds: [],
          },
        ],
      },
      productionBaseline: {
        artifactType: "ProductionBaseline",
        schemaVersion: 1,
        authoritative: true,
        artifactId: "baseline-1",
        corpusRevision: "corpus-1",
        provider: "hosted",
        thresholds,
      },
      rollbackReady: true,
    });

    expect(decision.promote).toBe(false);
    expect(decision.reasons).toContain(
      "local trace source lineage mismatch for case case-1",
    );
    expect(decision.reasons).toContain(
      "local trace AccessScope projection mismatch for case case-1",
    );
  });
it("rejects rollback at the exact expiry boundary", () => {
  const gate = vi
    .spyOn(ProviderEvaluation, "decidePromotion")
    .mockReturnValue({ promote: true, reasons: [] });
  try {
    const controller = new CanaryController();
    const transition = controller.startCanary(
      { promote: true, reasons: [] },
      {
        now: "2026-09-26T00:00:00.000Z",
        trafficPercent: 10,
        cohortSalt: "salt",
        promotionEvidence: {
          decision: { promote: true, reasons: [] },
          input: {
            comparison: null,
            reviewedCases: null,
            productionBaseline: null,
            rollbackReady: true,
          },
        },
      },
    );
    expect(transition.accepted).toBe(true);
    const rollback = controller.rollback(
      "expired",
      "2026-09-27T00:00:00.000Z",
    );
    expect(rollback.accepted).toBe(false);
  } finally {
    gate.mockRestore();
  }
});
