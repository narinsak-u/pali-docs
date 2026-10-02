import type {
  AgentEvent,
  AgentTurnInput,
  AgentTurnRunner,
} from "@/lib/agent/types";
import {
  assertReviewedCasesArtifactReady,
  attestProductionBaseline,
  compareProviderEvaluations,
  decidePromotion,
  parseProductionBaselineArtifact,
  runPairedEvaluationCase,
  type EvaluationCase,
  type EvaluationThresholds,
} from "@/lib/rag/provider-evaluation";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  vi.stubEnv("RAG_PROMOTION_ATTESTATION_SECRET", "provider-evaluation-test-secret");
  vi.stubEnv("RAG_BASELINE_ATTESTATION_SECRET", "provider-baseline-test-secret");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const evaluationCase: EvaluationCase = {
  id: "unicode-grounded",
  category: "english-single-source",
  language: "en",
  question: " Explain Pāli ānanda. ",
  expectedOutcome: "grounded",
  expectedSourceIds: ["source-1"],
  forbiddenSourceIds: ["secret-source"],
  accessScope: { tenant: "tenant-1", role: "learner" },
};
const thresholds: EvaluationThresholds = {
  minOutcomeAccuracy: 1,
  minGroundingRecall: 1,
  minCitationPrecision: 1,
  minCitationCompleteness: 1,
  maxLatencyP95Ms: 200,
  maxFailureRate: 0,
  maxCancellationRate: 0,
  maxToolFailureRate: 0,
  maxCost: 1,
};

function productionBaselineFixture() {
  return {
    artifactType: "ProductionBaseline",
    schemaVersion: 1,
    authoritative: true,
    sourceIssue: 42,
    artifactId: "baseline-2026-09-01",
    corpusRevision: "corpus-1",
    attestation: "attested-baseline",
    provider: "hosted",
    thresholds,
  };
}

describe("artifact readiness gates", () => {
  it("rejects reviewed cases missing authoritative source mappings", () => {
    expect(() =>
      assertReviewedCasesArtifactReady({
        artifactType: "ReviewedEvaluationCases",
        schemaVersion: 1,
        authoritative: true,
        corpusRevision: "corpus-1",
        cases: [{ ...evaluationCase, expectedSourceIds: [] }],
      }),
    ).toThrow("missing authoritative source mappings");
  });

  it("rejects reviewed cases with incomplete required cohorts", () => {
    expect(() =>
      assertReviewedCasesArtifactReady({
        artifactType: "ReviewedEvaluationCases",
        schemaVersion: 1,
        authoritative: true,
        corpusRevision: "corpus-1",
        cases: [evaluationCase],
      }),
    ).toThrow("reviewed cohort thai-single-source is incomplete");
  });

  it("rejects a ProductionBaseline missing attestation", () => {
    const { attestation: _attestation, ...withoutAttestation } = productionBaselineFixture();
    expect(() => parseProductionBaselineArtifact(withoutAttestation)).toThrow();
  });

  it("rejects a ProductionBaseline with the wrong source issue", () => {
    expect(() =>
      parseProductionBaselineArtifact({
        ...productionBaselineFixture(),
        sourceIssue: 41,
      }),
    ).toThrow();
  });

  it("rejects a ProductionBaseline with the wrong provider", () => {
    expect(() =>
      parseProductionBaselineArtifact({
        ...productionBaselineFixture(),
        provider: "local",
      }),
    ).toThrow();
  });

  it("rejects a ProductionBaseline with unknown fields", () => {
    expect(() =>
      parseProductionBaselineArtifact({
        ...productionBaselineFixture(),
        unexpected: true,
      }),
    ).toThrow();
  });
});

function runnerFor(
  answer: string,
  options: {
    source?: string | string[];
    toolFailure?: string;
    failure?: string;
    outcome?: "insufficient-evidence";
    observedModel?: string;
    observedServingRevision?: string;
  } = {},
): AgentTurnRunner {
  return {
    supportsAccessScope: true,
    supportsCostTelemetry: true,
    observedCorpusRevision: "corpus-1",
    ...(options.observedModel === undefined
      ? {}
      : {
          observedServingMetadata: {
            model: options.observedModel,
            servingRevision: options.observedServingRevision ?? "observed-1",
          },
        }),
    async runTurn(input: AgentTurnInput, sink) {
      const sourceIds = options.source
        ? Array.isArray(options.source)
          ? options.source
          : [options.source]
        : [];
      sink.emit({ type: "run.started", runId: input.runId });
      sink.emit({
        type: "retrieval.started",
        runId: input.runId,
        attempt: 1,
        query: "private query with secret",
      });
      sink.emit({
        type: "retrieval.completed",
        runId: input.runId,
        attempt: 1,
        corpusRevision: "corpus-1",
        matchCount: 2,
        acceptedSourceIds: sourceIds,
        candidateCount: 2,
        acceptedCount: sourceIds.length,
      });
      sink.emit({
        type: "tool.started",
        runId: input.runId,
        toolId: "retrieval-tool",
      });
      if (options.toolFailure) {
        sink.emit({
          type: "tool.failed",
          runId: input.runId,
          toolId: "retrieval-tool",
          code: options.toolFailure,
        });
      } else {
        sink.emit({
          type: "tool.completed",
          runId: input.runId,
          toolId: "retrieval-tool",
        });
      }
      if (options.failure) {
        sink.emit({ type: "run.failed", runId: input.runId, code: options.failure });
        return { outcome: "failed", code: options.failure };
      }
      if (options.outcome) {
        sink.emit({
          type: "run.completed",
          runId: input.runId,
          outcome: options.outcome,
          cost: 0.1,
        } as AgentEvent);
        return { outcome: options.outcome };
      }
      sink.emit({ type: "answer.completed", runId: input.runId, text: answer });
      sink.emit({
        type: "citations.completed",
        runId: input.runId,
        citations: sourceIds.map((source) => ({
          id: "passage-secret",
          source,
          title: "private passage",
        })),
      });
      sink.emit({
        type: "run.completed",
        runId: input.runId,
        outcome: "answered",
        cost: 0.1,
      } as AgentEvent);
      return {
        outcome: "answered",
        answer,
        citations: sourceIds.map((source) => ({
          id: "passage-secret",
          source,
          title: "private passage",
        })),
        suggestions: [],
      };
    },
  };
}

describe("provider evaluation traces", () => {
  it("runs the normalized case against both providers with deterministic correlation and redaction", async () => {
    const inputs: AgentTurnInput[] = [];
    const runner = (answer: string): AgentTurnRunner => {
      const base = runnerFor(answer, { source: "source-1" });
      return {
        supportsAccessScope: true,
        supportsCostTelemetry: true,
        async runTurn(input, sink, signal) {
          inputs.push(input);
          return base.runTurn(input, sink, signal);
        },
      };
    };

    const paired = await runPairedEvaluationCase({
      evaluationCase,
      hosted: runner("Pāli ānanda answer"),
      local: runner("Pāli ānanda local answer"),
      hostedMetadata: {
        model: "hosted/model-v1",
        servingRevision: "hosted-2026-09-01",
        endpoint: "https://hosted.example/v1",
        apiKey: "hosted-secret",
        decoding: { temperature: 0, apiKey: "decoded-secret" },
      },
      localMetadata: {
        model: "Qwen/Qwen3-8B",
        servingRevision: "vllm-image@sha256:abc",
        endpoint: "http://vllm.internal:8000/v1",
        apiKey: "local-secret",
        decoding: { temperature: 0, apiKey: "decoded-secret" },
      },
      corpusRevision: "corpus-1",
      now: (() => {
        let tick = 0;
        return () => (tick += 10);
      })(),
    });

    expect(inputs).toHaveLength(2);
    expect(inputs[0].messages).toEqual(inputs[1].messages);
    expect(paired.hosted.inputDigest).toBe(paired.local.inputDigest);
    expect(paired.hosted.runId).toMatch(/^hosted-eval-unicode-grounded-/);
    expect(paired.local.runId).toMatch(/^local-eval-unicode-grounded-/);
    expect(inputs[0].accessScope).toEqual(inputs[1].accessScope);
    expect(inputs[0].accessScope).toEqual({ tenant: "tenant-1", role: "learner" });
    expect(paired.hosted.accessScopeDigest).toBe(paired.local.accessScopeDigest);

    const serialized = JSON.stringify(paired);
    for (const secret of [
      evaluationCase.question,
      "private query with secret",
      "Pāli ānanda answer",
      "Pāli ānanda local answer",
      "private passage",
      "hosted-secret",
      "local-secret",
      "decoded-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(paired.hosted.model).toBe("hosted/model-v1");
    expect(paired.local.model).toBe("Qwen/Qwen3-8B");
    expect(paired.hosted.quality.grounding.sourceRecall).toBe(1);
    expect(paired.local.quality.citations.precision).toBe(1);
    expect(paired.hosted.unicode.outputNonAsciiCount).toBeGreaterThan(0);
    expect(paired.local.tools).toEqual({ attempted: 1, succeeded: 1, failed: 0 });
  });

  it("extracts failure, capacity, and latency outcomes without exposing event payloads", async () => {
    const trace = await runPairedEvaluationCase({
      evaluationCase,
      hosted: runnerFor("answer", { source: "source-1" }),
      local: runnerFor("ignored", { failure: "timeout", toolFailure: "tool_unavailable" }),
      hostedMetadata: { model: "hosted/model", servingRevision: "hosted-1" },
      localMetadata: { model: "Qwen/Qwen3-8B", servingRevision: "vllm-1" },
      corpusRevision: "corpus-1",
      now: (() => {
        let tick = 0;
        return () => (tick += 25);
      })(),
    });

    expect(trace.local.outcome).toBe("failed");
    expect(trace.local.failure).toBe("timeout");
    expect(trace.local.tools).toEqual({ attempted: 1, succeeded: 0, failed: 1 });
    expect(trace.local.latency.totalMs).toBeGreaterThan(0);
    expect(trace.local.capacity).toEqual({ candidateCount: 2, acceptedCount: 0 });
  });
});

describe("provider comparison and promotion gates", () => {
  it("reports explicit threshold violations and fails closed without authoritative artifacts", async () => {
    const paired = await runPairedEvaluationCase({
      evaluationCase,
      hosted: runnerFor("answer", { source: "source-1" }),
      local: runnerFor("ignored", { failure: "timeout" }),
      hostedMetadata: { model: "hosted/model", servingRevision: "hosted-1" },
      localMetadata: { model: "Qwen/Qwen3-8B", servingRevision: "vllm-1" },
      corpusRevision: "corpus-1",
    });
    const comparison = compareProviderEvaluations([paired], thresholds);

    expect(comparison.gates.local.violations.some((violation) => violation.includes("outcome accuracy"))).toBe(true);
    expect(comparison.gates.local.violations.some((violation) => violation.includes("failure rate"))).toBe(true);

    expect(
      decidePromotion({ comparison, reviewedCases: undefined, productionBaseline: undefined }),
    ).toEqual({
      promote: false,
      reasons: [
        "authoritative reviewed-case artifact is required",
        "authoritative ProductionBaseline artifact is required",
      ],
    });
    expect(
      decidePromotion({
        comparison,
        reviewedCases: { status: "incomplete", corpusRevision: null, cases: [] },
        productionBaseline: { artifactType: "ProductionBaseline" },
      }).promote,
    ).toBe(false);
  });

  it("requires matching authoritative artifacts before allowing a passing candidate", async () => {
    const cohortPlan = [
      ...Array.from({ length: 10 }, () => ["thai-single-source", "th", "grounded"] as const),
      ...Array.from({ length: 5 }, () => ["english-single-source", "en", "grounded"] as const),
      ...Array.from({ length: 5 }, () => ["multi-source", "en", "grounded"] as const),
      ...Array.from({ length: 5 }, () => ["paraphrase-terminology", "en", "grounded"] as const),
      ...Array.from({ length: 3 }, () => ["insufficient-evidence", "en", "insufficient-evidence"] as const),
      ...Array.from({ length: 2 }, () => ["retrieved-prompt-injection", "en", "grounded"] as const),
    ];
    const reviewedCaseList = cohortPlan.map(([category, language, expectedOutcome], index) => ({
      ...evaluationCase,
      id: `reviewed-${index}`,
      category,
      language,
      expectedOutcome,
      expectedSourceIds:
        expectedOutcome === "insufficient-evidence"
          ? []
          : category === "multi-source"
            ? ["source-1", "source-2"]
            : ["source-1"],
    }));
    const passingThresholds = {
      ...thresholds,
      minGroundingRecall: 0.5,
      minCitationCompleteness: 0.5,
    };
    const paired = await Promise.all(
      reviewedCaseList.map((reviewedCase) =>
        runPairedEvaluationCase({
          evaluationCase: reviewedCase,
          hosted: runnerFor("answer", {
            observedModel: "hosted/model",
            observedServingRevision: "hosted-1",
            source:
              reviewedCase.expectedOutcome === "insufficient-evidence"
                ? undefined
                : reviewedCase.category === "multi-source"
                  ? ["source-1", "source-2"]
                  : "source-1",
            outcome:
              reviewedCase.expectedOutcome === "insufficient-evidence"
                ? "insufficient-evidence"
                : undefined,
          }),
          local: runnerFor("answer", {
            observedModel: "Qwen/Qwen3-8B",
            observedServingRevision: "vllm-1",
            source:
              reviewedCase.expectedOutcome === "insufficient-evidence"
                ? undefined
                : reviewedCase.category === "multi-source"
                  ? ["source-1", "source-2"]
                  : "source-1",
            outcome:
              reviewedCase.expectedOutcome === "insufficient-evidence"
                ? "insufficient-evidence"
                : undefined,
          }),
          hostedMetadata: { model: "hosted/model", servingRevision: "hosted-1" },
          localMetadata: { model: "Qwen/Qwen3-8B", servingRevision: "vllm-1" },
          corpusRevision: "corpus-1",
        }),
      ),
    );
    const comparison = compareProviderEvaluations(paired, passingThresholds);
    const reviewedCases = {
      artifactType: "ReviewedEvaluationCases",
      schemaVersion: 1,
      authoritative: true,
      corpusRevision: "corpus-1",
      cases: reviewedCaseList,
    } as const;
    const baselineUnsigned = {
      artifactType: "ProductionBaseline" as const,
      schemaVersion: 1 as const,
      authoritative: true as const,
      sourceIssue: 42 as const,
      artifactId: "baseline-2026-09-01",
      corpusRevision: "corpus-1",
      provider: "hosted" as const,
      thresholds: passingThresholds,
    };
    const productionBaseline = {
      ...baselineUnsigned,
      attestation: attestProductionBaseline(baselineUnsigned)!,
    };

    expect(
      decidePromotion({
        comparison,
        reviewedCases,
        productionBaseline,
        rollbackReady: true,
      }),
    ).toEqual({ promote: true, reasons: [] });
    expect(
      decidePromotion({
        comparison,
        reviewedCases,
        productionBaseline: { ...productionBaseline, attestation: "forged" },
        rollbackReady: true,
      }).reasons,
    ).toContain("ProductionBaseline attestation is invalid");
    const staleCasesDecision = decidePromotion({
      comparison,
      reviewedCases: { ...reviewedCases, corpusRevision: "corpus-old" },
      productionBaseline,
      rollbackReady: true,
    });
    expect(staleCasesDecision.promote).toBe(false);
    expect(staleCasesDecision.reasons).toContain(
      "hosted trace CorpusRevision mismatch for case reviewed-0",
    );
    expect(staleCasesDecision.reasons).toContain(
      "local trace CorpusRevision mismatch for case reviewed-0",
    );

    const staleIndex = paired.map((item) => ({
      ...item,
      local: { ...item.local, observedCorpusRevision: "corpus-old" },
    }));
    expect(() => compareProviderEvaluations(staleIndex, passingThresholds)).toThrow(
      "observed retrieval corpus revision mismatch",
    );
    const conflictingRunner = await runPairedEvaluationCase({
      evaluationCase,
      hosted: runnerFor("answer", {
        observedModel: "hosted/model",
        observedServingRevision: "hosted-1",
      }),
      local: {
        ...runnerFor("answer", {
          observedModel: "Qwen/Qwen3-8B",
          observedServingRevision: "vllm-1",
        }),
        observedCorpusRevision: "corpus-old",
      },
      hostedMetadata: { model: "hosted/model", servingRevision: "hosted-1" },
      localMetadata: { model: "Qwen/Qwen3-8B", servingRevision: "vllm-1" },
      corpusRevision: "corpus-1",
    });
    expect(conflictingRunner.local.observedCorpusRevision).toBeUndefined();

    const forgedIdentity = paired.map((item) => ({
      ...item,
      local: {
        ...item.local,
        observedServingMetadata: {
          ...item.local.observedServingMetadata!,
          model: "some/other-model",
        },
      },
    }));
    const forgedIdentityComparison = compareProviderEvaluations(forgedIdentity, passingThresholds);
    const forgedIdentityDecision = decidePromotion({
      comparison: forgedIdentityComparison,
      reviewedCases,
      productionBaseline,
      rollbackReady: true,
    });
    expect(forgedIdentityDecision.promote).toBe(false);
    expect(forgedIdentityDecision.reasons).toContain(
      "local provider must use Qwen/Qwen3-8B for case reviewed-0",
    );

    const invalidCases = {
      ...reviewedCases,
      cases: [
        {
          ...reviewedCases.cases[0],
          expectedSourceIds: ["source-1", "source-1"],
          forbiddenSourceIds: ["source-1"],
        },
        ...reviewedCases.cases.slice(1),
      ],
    };
    const invalidDecision = decidePromotion({
      comparison,
      reviewedCases: invalidCases,
      productionBaseline,
      rollbackReady: true,
    });
    expect(invalidDecision.promote).toBe(false);
    expect(invalidDecision.reasons).toEqual(
      expect.arrayContaining([
        "reviewed case reviewed-0 has duplicate expected source mappings",
        "reviewed case reviewed-0 has overlapping source mappings",
      ]),
    );
  });
  it("rejects paired case, scope, and citation identity mismatches", async () => {
    const paired = await runPairedEvaluationCase({
      evaluationCase,
      hosted: runnerFor("answer", { source: "source-1" }),
      local: runnerFor("answer", { source: "source-1" }),
      hostedMetadata: { model: "hosted/model", servingRevision: "hosted-1" },
      localMetadata: { model: "Qwen/Qwen3-8B", servingRevision: "vllm-1" },
      corpusRevision: "corpus-1",
    });
    expect(() =>
      compareProviderEvaluations(
        [{ ...paired, local: { ...paired.local, caseId: "other-case" } }],
        thresholds,
      ),
    ).toThrow("case identity");
    expect(() =>
      compareProviderEvaluations(
        [{ ...paired, local: { ...paired.local, accessScopeDigest: "different" } }],
        thresholds,
      ),
    ).toThrow("AccessScope");

    const forbiddenCase = { ...evaluationCase, forbiddenSourceIds: ["secret-source"] };
    const forbidden = await runPairedEvaluationCase({
      evaluationCase: forbiddenCase,
      hosted: runnerFor("answer", { source: "secret-source" }),
      local: runnerFor("answer", { source: "secret-source" }),
      hostedMetadata: { model: "hosted/model", servingRevision: "hosted-1" },
      localMetadata: { model: "Qwen/Qwen3-8B", servingRevision: "vllm-1" },
      corpusRevision: "corpus-1",
    });
    const comparison = compareProviderEvaluations([forbidden], thresholds);
    expect(
      comparison.gates.local.violations.some((violation) =>
        violation.includes("citation safety"),
      ),
    ).toBe(true);
  });
  it("fails cost and tool gates when telemetry is absent", async () => {
    const noTelemetryRunner: AgentTurnRunner = {
      supportsAccessScope: true,
      async runTurn(input, sink) {
        sink.emit({ type: "run.started", runId: input.runId });
        sink.emit({
          type: "retrieval.completed",
          runId: input.runId,
          attempt: 1,
          corpusRevision: "corpus-1",
          matchCount: 1,
          acceptedSourceIds: ["source-1"],
          candidateCount: 1,
          acceptedCount: 1,
        });
        sink.emit({ type: "answer.completed", runId: input.runId, text: "answer" });
        sink.emit({
          type: "citations.completed",
          runId: input.runId,
          citations: [{ id: "p-1", source: "source-1", title: "source" }],
        });
        sink.emit({ type: "run.completed", runId: input.runId, outcome: "answered" });
        return {
          outcome: "answered",
          answer: "answer",
          citations: [{ id: "p-1", source: "source-1", title: "source" }],
          suggestions: [],
        };
      },
    };
    const paired = await runPairedEvaluationCase({
      evaluationCase,
      hosted: noTelemetryRunner,
      local: noTelemetryRunner,
      hostedMetadata: { model: "hosted/model", servingRevision: "hosted-1" },
      localMetadata: { model: "Qwen/Qwen3-8B", servingRevision: "vllm-1" },
      corpusRevision: "corpus-1",
    });
    const comparison = compareProviderEvaluations([paired], thresholds);
    expect(comparison.gates.local.violations).toEqual(
      expect.arrayContaining(["local cost telemetry is incomplete", "local tool telemetry is incomplete"]),
    );
    await expect(
      runPairedEvaluationCase({
        evaluationCase,
        hosted: noTelemetryRunner,
        local: noTelemetryRunner,
        hostedMetadata: { model: "hosted/model", servingRevision: "hosted-1" },
        localMetadata: { model: "Qwen/Qwen3-8B", servingRevision: "vllm-1" },
        corpusRevision: "corpus-1",
        requireCostTelemetry: true,
      }),
    ).rejects.toThrow("cost telemetry");
  });
  it("rejects malformed tool lifecycle telemetry before tool gates can pass", async () => {
    const malformedRunner: AgentTurnRunner = {
      supportsAccessScope: true,
      async runTurn(input, sink) {
        sink.emit({ type: "run.started", runId: input.runId });
        sink.emit({
          type: "tool.completed",
          runId: input.runId,
          toolId: "orphaned-tool",
        });
        sink.emit({ type: "run.completed", runId: input.runId, outcome: "answered", cost: 0.1 });
        return { outcome: "answered", answer: "answer", citations: [], suggestions: [] };
      },
    };
    const paired = await runPairedEvaluationCase({
      evaluationCase,
      hosted: malformedRunner,
      local: malformedRunner,
      hostedMetadata: { model: "hosted/model", servingRevision: "hosted-1" },
      localMetadata: { model: "Qwen/Qwen3-8B", servingRevision: "vllm-1" },
      corpusRevision: "corpus-1",
    });
    expect(paired.hosted.toolTelemetryPresent).toBe(false);
    expect(compareProviderEvaluations([paired], thresholds).gates.local.violations).toContain(
      "local tool telemetry is incomplete",
    );
  });

  it("redacts unknown access-scope keys and rejects runners without scope enforcement", async () => {
    const scopedCase = {
      ...evaluationCase,
      accessScope: {
        tenant: "tenant-1",
        authorization: "Bearer secret",
        session: "session-secret",
        privateKey: "private-key",
      },
    };
    const paired = await runPairedEvaluationCase({
      evaluationCase: scopedCase,
      hosted: runnerFor("answer", { source: "source-1" }),
      local: runnerFor("answer", { source: "source-1" }),
      hostedMetadata: { model: "hosted/model", servingRevision: "hosted-1" },
      localMetadata: { model: "Qwen/Qwen3-8B", servingRevision: "vllm-1" },
      corpusRevision: "corpus-1",
    });
    expect(paired.hosted.accessScope).toEqual({ tenant: "tenant-1" });
    expect(JSON.stringify(paired)).not.toContain("Bearer secret");
    await expect(
      runPairedEvaluationCase({
        evaluationCase: scopedCase,
        hosted: { ...runnerFor("answer"), supportsAccessScope: false },
        local: runnerFor("answer"),
        hostedMetadata: { model: "hosted/model", servingRevision: "hosted-1" },
        localMetadata: { model: "Qwen/Qwen3-8B", servingRevision: "vllm-1" },
        corpusRevision: "corpus-1",
      }),
    ).rejects.toThrow("enforce AccessScope");
  });
});
