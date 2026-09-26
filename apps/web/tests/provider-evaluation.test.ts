import type {
  AgentEvent,
  AgentTurnInput,
  AgentTurnRunner,
} from "@/lib/agent/types";
import {
  compareProviderEvaluations,
  decidePromotion,
  runPairedEvaluationCase,
  type EvaluationCase,
  type EvaluationThresholds,
} from "@/lib/rag/provider-evaluation";
import { describe, expect, it } from "vitest";

const evaluationCase: EvaluationCase = {
  id: "unicode-grounded",
  category: "english-single-source",
  language: "en",
  question: " Explain Pāli ānanda. ",
  expectedOutcome: "grounded",
  expectedSourceIds: ["source-1"],
  forbiddenSourceIds: ["secret-source"],
};

const thresholds: EvaluationThresholds = {
  minOutcomeAccuracy: 1,
  minGroundingRecall: 1,
  minCitationPrecision: 1,
  minCitationCompleteness: 1,
  maxLatencyP95Ms: 200,
  maxFailureRate: 0,
  maxCancellationRate: 0,
  maxCost: 1,
};

function runnerFor(
  answer: string,
  options: { source?: string; toolFailure?: string; failure?: string; outcome?: "insufficient-evidence" } = {},
): AgentTurnRunner {
  return {
    async runTurn(input: AgentTurnInput, sink) {
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
        matchCount: 2,
        acceptedSourceIds: options.source ? [options.source] : [],
        candidateCount: 2,
        acceptedCount: options.source ? 1 : 0,
      });
      sink.emit({ type: "generation.started", runId: input.runId });
      if (options.toolFailure) {
        sink.emit({
          type: "tool.failed",
          runId: input.runId,
          tool: "retrieval-tool",
          code: options.toolFailure,
        } as AgentEvent);
      } else {
        sink.emit({
          type: "tool.completed",
          runId: input.runId,
          tool: "retrieval-tool",
        } as AgentEvent);
      }
      if (options.failure) {
        sink.emit({ type: "run.failed", runId: input.runId, code: options.failure });
        return { outcome: "failed", code: options.failure };
      }
      if (options.outcome) {
        sink.emit({ type: "run.completed", runId: input.runId, outcome: options.outcome });
        return { outcome: options.outcome };
      }
      sink.emit({ type: "answer.completed", runId: input.runId, text: answer });
      sink.emit({
        type: "citations.completed",
        runId: input.runId,
        citations: options.source
          ? [{ id: "passage-secret", source: options.source, title: "private passage" }]
          : [],
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
        citations: options.source
          ? [{ id: "passage-secret", source: options.source, title: "private passage" }]
          : [],
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
    const reviewedCaseList = Array.from({ length: 30 }, (_, index) => ({
      ...evaluationCase,
      id: `reviewed-${index}`,
    }));
    const paired = await Promise.all(
      reviewedCaseList.map((reviewedCase) =>
        runPairedEvaluationCase({
          evaluationCase: reviewedCase,
          hosted: runnerFor("answer", { source: "source-1" }),
          local: runnerFor("answer", { source: "source-1" }),
          hostedMetadata: { model: "hosted/model", servingRevision: "hosted-1" },
          localMetadata: { model: "Qwen/Qwen3-8B", servingRevision: "vllm-1" },
          corpusRevision: "corpus-1",
        }),
      ),
    );
    const comparison = compareProviderEvaluations(paired, thresholds);
    const reviewedCases = {
      artifactType: "ReviewedEvaluationCases",
      schemaVersion: 1,
      authoritative: true,
      corpusRevision: "corpus-1",
      cases: reviewedCaseList,
    } as const;
    const productionBaseline = {
      artifactType: "ProductionBaseline",
      schemaVersion: 1,
      authoritative: true,
      artifactId: "baseline-2026-09-01",
      corpusRevision: "corpus-1",
      thresholds,
      provider: "hosted",
    } as const;

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
        reviewedCases: { ...reviewedCases, corpusRevision: "corpus-old" },
        productionBaseline,
        rollbackReady: true,
      }).promote,
    ).toBe(false);
  });
});
