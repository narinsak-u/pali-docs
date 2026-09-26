import { describe, expect, it, vi } from "vitest";
import {
  compareProviderEvaluations,
  decidePromotion,
  type PairedEvaluation,
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
  answer: "",
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
  tools: { attempted: 0, succeeded: 0, failed: 0 },
  toolTelemetryPresent: true,
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
