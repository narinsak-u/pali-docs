import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import type {
  AgentEvent,
  AgentEventSink,
  AgentTurnInput,
  AgentTurnResult,
  AgentTurnRunner,
} from "@/lib/agent/types";
import type { RagEvaluationCase, RagActualOutcome } from "@/lib/rag/evaluation";
import {
  citationCompleteness,
  citationPrecision,
  sourceRecall,
} from "@/lib/rag/evaluation";
import { z } from "zod";

export type EvaluationCase = RagEvaluationCase;
export type EvaluationProvider = "hosted" | "local";

export interface ServingMetadata {
  model: string;
  servingRevision: string;
  endpoint?: string;
  imageDigest?: string;
  tokenizer?: string;
  decoding?: Record<string, string | number | boolean>;
  [key: string]: unknown;
}

export interface EvaluationThresholds {
  minOutcomeAccuracy: number;
  minGroundingRecall: number;
  minCitationPrecision: number;
  minCitationCompleteness: number;
  maxLatencyP95Ms: number;
  maxFailureRate: number;
  maxCancellationRate: number;
  maxCost?: number;
  maxToolFailureRate?: number;
}

export interface ProviderTrace {
  schemaVersion: "v1";
  caseId: string;
  provider: EvaluationProvider;
  runId: string;
  inputDigest: string;
  corpusRevision: string;
  model: string;
  servingRevision: string;
  endpoint?: string;
  imageDigest?: string;
  tokenizer?: string;
  decoding?: Record<string, string | number | boolean>;
  outcome: RagActualOutcome;
  grounding: {
    corpusRevision: string;
    retrievedSourceIds: string[];
    sourceRecall: number;
  };
  citations: {
    sourceIds: string[];
    precision: number;
    completeness: number;
  };
  quality: {
    outcomeCorrect: boolean;
    grounding: { sourceRecall: number };
    citations: { precision: number; completeness: number };
  };
  unicode: {
    inputCodePointCount: number;
    inputNonAsciiCount: number;
    outputCodePointCount: number;
    outputNonAsciiCount: number;
    outputNfc: boolean;
  };
  latency: {
    totalMs: number;
    retrievalMs: number;
    generationMs: number;
  };
  capacity: {
    candidateCount?: number;
    acceptedCount?: number;
    promptTokens?: number;
    completionTokens?: number;
    queueMs?: number;
  };
  tools: {
    attempted: number;
    succeeded: number;
    failed: number;
  };
  failure?: string;
  cancelled?: boolean;
  cost?: number;
}

export interface PairedEvaluation {
  schemaVersion: "v1";
  caseId: string;
  inputDigest: string;
  corpusRevision: string;
  hosted: ProviderTrace;
  local: ProviderTrace;
}

export interface ProviderAggregate {
  caseCount: number;
  outcomeAccuracy: number;
  groundingRecall: number;
  citationPrecision: number;
  citationCompleteness: number;
  latencyP95Ms: number;
  failureRate: number;
  cancellationRate: number;
  averageCost: number | null;
  toolFailureRate: number;
}

export interface ProviderGateResult {
  pass: boolean;
  violations: string[];
  aggregate: ProviderAggregate;
}

export interface ProviderComparison {
  schemaVersion: "v1";
  caseCount: number;
  thresholds: EvaluationThresholds;
  paired: PairedEvaluation[];
  aggregates: Record<EvaluationProvider, ProviderAggregate>;
  gates: Record<EvaluationProvider, ProviderGateResult>;
}

export interface ReviewedCasesArtifact {
  artifactType: "ReviewedEvaluationCases";
  schemaVersion: 1;
  authoritative: true;
  corpusRevision: string;
  cases: EvaluationCase[];
}

export interface ProductionBaselineArtifact {
  artifactType: "ProductionBaseline";
  schemaVersion: 1;
  authoritative: true;
  artifactId: string;
  corpusRevision: string;
  provider: "hosted";
  thresholds: EvaluationThresholds;
}

export interface PromotionDecision {
  promote: boolean;
  reasons: string[];
}

interface RunMetrics {
  retrievedSourceIds: string[];
  citationSourceIds: string[];
  retrievalAttempts: number;
  retrievalMs: number;
  generationMs: number;
  candidateCount?: number;
  acceptedCount?: number;
  answer?: string;
  failure?: string;
  cancelled?: boolean;
  cost?: number;
  capacity: ProviderTrace["capacity"];
  tools: ProviderTrace["tools"];
}

const SAFE_CODE: Record<string, true> = {
  aborted: true,
  cancelled: true,
  failed: true,
  runner_error: true,
  service_unavailable: true,
  timeout: true,
  tool_unavailable: true,
  vector_store_unavailable: true,
};

function safeCode(value: unknown): string {
  return typeof value === "string" && SAFE_CODE[value] === true ? value : "unknown";
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) return undefined;
  return value;
}

function canonicalInput(input: AgentTurnInput): AgentTurnInput {
  return {
    runId: "normalized",
    messages: input.messages.map((message) => ({
      ...message,
      parts: message.parts.map((part) => ({
        ...part,
        text: part.text.replace(/\r\n?/g, "\n").normalize("NFC").trim(),
      })),
    })),
  };
}

function inputDigest(input: AgentTurnInput): string {
  const normalized = canonicalInput(input);
  return createHash("sha256")
    .update(JSON.stringify({ messages: normalized.messages }))
    .digest("hex");
}

function runId(provider: EvaluationProvider, caseId: string, digest: string): string {
  return `${provider}-eval-${caseId}-${digest.slice(0, 16)}`;
}

function unicodeMetrics(text: string): {
  codePointCount: number;
  nonAsciiCount: number;
  nfc: boolean;
} {
  const points = [...text];
  return {
    codePointCount: points.length,
    nonAsciiCount: points.filter((point) => point.codePointAt(0)! > 0x7f).length,
    nfc: text.normalize("NFC") === text,
  };
}

function safeServingMetadata(metadata: ServingMetadata): Pick<
  ProviderTrace,
  "model" | "servingRevision" | "endpoint" | "imageDigest" | "tokenizer" | "decoding"
> {
  const model = metadata.model.trim();
  const servingRevision = metadata.servingRevision.trim();
  if (!model || !servingRevision) throw new Error("evaluation serving metadata is incomplete");
  const SAFE_DECODING_KEYS: Record<string, true> = {
    temperature: true,
    topP: true,
    topK: true,
    maxTokens: true,
    seed: true,
    enableThinking: true,
  };
  const result: Pick<
    ProviderTrace,
    "model" | "servingRevision" | "endpoint" | "imageDigest" | "tokenizer" | "decoding"
  > = {
    model,
    servingRevision,
  };
  for (const key of ["endpoint", "imageDigest", "tokenizer"] as const) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) result[key] = value.trim();
  }
  if (result.endpoint) {
    try {
      const url = new URL(result.endpoint);
      result.endpoint = `${url.protocol}//${url.host}${url.pathname}`.replace(/\/$/, "");
    } catch {
      delete result.endpoint;
    }
  }
  if (metadata.decoding) {
    const decoding: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(metadata.decoding)) {
      if (
        SAFE_DECODING_KEYS[key] === true &&
        ((typeof value === "string" && value.length <= 200) ||
          typeof value === "number" ||
          typeof value === "boolean")
      ) {
        decoding[key] = value;
      }
    }
    if (Object.keys(decoding).length > 0) result.decoding = decoding;
  }
  return result;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function nearestRank(values: readonly number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

function extractRunMetrics(): {
  metrics: RunMetrics;
  sink: AgentEventSink;
} {
  const retrievalStarted = new Map<number, number>();
  const metrics: RunMetrics = {
    retrievedSourceIds: [],
    citationSourceIds: [],
    retrievalAttempts: 0,
    retrievalMs: 0,
    generationMs: 0,
    capacity: {},
    tools: { attempted: 0, succeeded: 0, failed: 0 },
  };
  let generationStarted: number | undefined;
  const clock = () => performance.now();
  const sink: AgentEventSink = {
    emit(rawEvent: AgentEvent): void {
      const event = rawEvent as unknown as Record<string, unknown>;
      const now = clock();
      switch (event.type) {
        case "retrieval.started": {
          const attempt = Number(event.attempt);
          metrics.retrievalAttempts = Math.max(metrics.retrievalAttempts, attempt);
          retrievalStarted.set(attempt, now);
          break;
        }
        case "retrieval.completed": {
          const attempt = Number(event.attempt);
          const started = retrievalStarted.get(attempt);
          if (started !== undefined) metrics.retrievalMs += now - started;
          retrievalStarted.delete(attempt);
          const ids = Array.isArray(event.acceptedSourceIds) ? event.acceptedSourceIds : [];
          metrics.retrievedSourceIds = unique(
            metrics.retrievedSourceIds.concat(ids.filter((id): id is string => typeof id === "string")),
          );
          if (typeof event.candidateCount === "number") metrics.candidateCount = event.candidateCount;
          else if (typeof event.matchCount === "number") metrics.candidateCount = event.matchCount;
          if (typeof event.acceptedCount === "number") metrics.acceptedCount = event.acceptedCount;
          break;
        }
        case "retrieval.failed":
        case "run.failed":
          metrics.failure = safeCode(event.code);
          metrics.cancelled = event.code === "aborted" || event.code === "cancelled";
          break;
        case "generation.started":
          generationStarted = now;
          break;
        case "answer.completed":
          if (typeof event.text === "string") metrics.answer = event.text;
          break;
        case "citations.completed": {
          const citations = Array.isArray(event.citations) ? event.citations : [];
          metrics.citationSourceIds = unique(
            citations
              .map((citation) => {
                if (citation && typeof citation === "object" && "source" in citation) {
                  return safeId(citation.source);
                }
                return undefined;
              })
              .filter((source): source is string => source !== undefined),
          );
          break;
        }
        case "run.completed":
          if (typeof event.cost === "number" && Number.isFinite(event.cost)) metrics.cost = event.cost;
          if (typeof event.promptTokens === "number") metrics.capacity.promptTokens = event.promptTokens;
          if (typeof event.completionTokens === "number") metrics.capacity.completionTokens = event.completionTokens;
          if (typeof event.queueMs === "number") metrics.capacity.queueMs = event.queueMs;
          break;
        case "tool.started":
          metrics.tools.attempted += 1;
          break;
        case "tool.completed":
          metrics.tools.attempted += metrics.tools.attempted === 0 ? 1 : 0;
          metrics.tools.succeeded += 1;
          break;
        case "tool.failed":
          metrics.tools.attempted += metrics.tools.attempted === 0 ? 1 : 0;
          metrics.tools.failed += 1;
          break;
        default:
          break;
      }
      if (generationStarted !== undefined && event.type === "run.completed") {
        metrics.generationMs += now - generationStarted;
        generationStarted = undefined;
      }
    },
  };
  return { metrics, sink };
}

async function runProvider(
  provider: EvaluationProvider,
  evaluationCase: EvaluationCase,
  runner: AgentTurnRunner,
  metadata: ServingMetadata,
  corpusRevision: string,
  now: () => number,
): Promise<ProviderTrace> {
  const baseInput: AgentTurnInput = {
    runId: "normalized",
    messages: [
      {
        id: `evaluation-${evaluationCase.id}`,
        role: "user",
        parts: [{ type: "text", text: evaluationCase.question }],
      },
    ],
  };
  const normalized = canonicalInput(baseInput);
  const digest = inputDigest(normalized);
  const inputText = normalized.messages
    .flatMap((message) => message.parts.map((part) => part.text))
    .join("\n");
  const inputUnicode = unicodeMetrics(inputText);
  const { metrics, sink } = extractRunMetrics();
  let startedAt = now();
  let result: AgentTurnResult;
  try {
    result = await runner.runTurn(
      { ...normalized, runId: runId(provider, evaluationCase.id, digest) },
      sink,
    );
  } catch {
    result = { outcome: "failed", code: "failed" };
    metrics.failure = "failed";
  }
  const completedAt = now();
  const observedSources = unique(metrics.retrievedSourceIds);
  const citationSources = unique(metrics.citationSourceIds);
  const actualOutcome: RagActualOutcome =
    result.outcome === "answered"
      ? citationSources.length > 0 && citationSources.every((source) => observedSources.includes(source))
        ? "grounded"
        : "unsupported-answer"
      : result.outcome;
  const outputUnicode = unicodeMetrics(metrics.answer ?? "");
  const model = safeServingMetadata(metadata);
  const failure = metrics.failure ?? ("code" in result ? safeCode(result.code) : undefined);
  return {
    schemaVersion: "v1",
    caseId: evaluationCase.id,
    provider,
    runId: runId(provider, evaluationCase.id, digest),
    inputDigest: digest,
    corpusRevision,
    ...model,
    outcome: actualOutcome,
    grounding: {
      corpusRevision,
      retrievedSourceIds: observedSources,
      sourceRecall: sourceRecall(evaluationCase.expectedSourceIds, observedSources),
    },
    citations: {
      sourceIds: citationSources,
      precision: citationPrecision(evaluationCase.expectedSourceIds, citationSources),
      completeness: citationCompleteness(evaluationCase.expectedSourceIds, citationSources),
    },
    quality: {
      outcomeCorrect: actualOutcome === evaluationCase.expectedOutcome,
      grounding: { sourceRecall: sourceRecall(evaluationCase.expectedSourceIds, observedSources) },
      citations: {
        precision: citationPrecision(evaluationCase.expectedSourceIds, citationSources),
        completeness: citationCompleteness(evaluationCase.expectedSourceIds, citationSources),
      },
    },
    unicode: {
      inputCodePointCount: inputUnicode.codePointCount,
      inputNonAsciiCount: inputUnicode.nonAsciiCount,
      outputCodePointCount: outputUnicode.codePointCount,
      outputNonAsciiCount: outputUnicode.nonAsciiCount,
      outputNfc: outputUnicode.nfc,
    },
    latency: {
      totalMs: Math.max(0, Math.round((completedAt - startedAt) * 1_000) / 1_000),
      retrievalMs: Math.max(0, Math.round(metrics.retrievalMs * 1_000) / 1_000),
      generationMs: Math.max(0, Math.round(metrics.generationMs * 1_000) / 1_000),
    },
    capacity: {
      ...(metrics.candidateCount === undefined ? {} : { candidateCount: metrics.candidateCount }),
      ...(metrics.acceptedCount === undefined ? {} : { acceptedCount: metrics.acceptedCount }),
      ...metrics.capacity,
    },
    tools: metrics.tools,
    ...(failure === undefined ? {} : { failure }),
    ...(metrics.cancelled ? { cancelled: true } : {}),
    ...(metrics.cost === undefined ? {} : { cost: metrics.cost }),
  };
}

export async function runPairedEvaluationCase(options: {
  evaluationCase: EvaluationCase;
  hosted: AgentTurnRunner;
  local: AgentTurnRunner;
  hostedMetadata: ServingMetadata;
  localMetadata: ServingMetadata;
  corpusRevision: string;
  now?: () => number;
}): Promise<PairedEvaluation> {
  const now = options.now ?? performance.now.bind(performance);
  const hosted = await runProvider(
    "hosted",
    options.evaluationCase,
    options.hosted,
    options.hostedMetadata,
    options.corpusRevision,
    now,
  );
  const local = await runProvider(
    "local",
    options.evaluationCase,
    options.local,
    options.localMetadata,
    options.corpusRevision,
    now,
  );
  return {
    schemaVersion: "v1",
    caseId: options.evaluationCase.id,
    inputDigest: hosted.inputDigest,
    corpusRevision: options.corpusRevision,
    hosted,
    local,
  };
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function aggregate(provider: EvaluationProvider, paired: readonly PairedEvaluation[]): ProviderAggregate {
  const traces = paired.map((item) => item[provider]);
  const costs = traces.map((trace) => trace.cost).filter((cost): cost is number => cost !== undefined);
  const attemptedTools = traces.reduce((sum, trace) => sum + trace.tools.attempted, 0);
  return {
    caseCount: traces.length,
    outcomeAccuracy: average(traces.map((trace) => (trace.quality.outcomeCorrect ? 1 : 0))),
    groundingRecall: average(traces.map((trace) => trace.grounding.sourceRecall)),
    citationPrecision: average(traces.map((trace) => trace.citations.precision)),
    citationCompleteness: average(traces.map((trace) => trace.citations.completeness)),
    latencyP95Ms: nearestRank(traces.map((trace) => trace.latency.totalMs), 0.95),
    failureRate: average(traces.map((trace) => (trace.outcome === "failed" || trace.outcome === "retrieval-unavailable" ? 1 : 0))),
    cancellationRate: average(traces.map((trace) => (trace.cancelled ? 1 : 0))),
    averageCost: costs.length === 0 ? null : average(costs),
    toolFailureRate: attemptedTools === 0 ? 0 : traces.reduce((sum, trace) => sum + trace.tools.failed, 0) / attemptedTools,
  };
}

function evaluateGate(aggregateValue: ProviderAggregate, thresholds: EvaluationThresholds, provider: EvaluationProvider): ProviderGateResult {
  const violations: string[] = [];
  const checkMin = (label: string, actual: number, required: number) => {
    if (actual < required) violations.push(`${provider} ${label} ${actual.toFixed(3)} is below threshold ${required.toFixed(3)}`);
  };
  const checkMax = (label: string, actual: number, maximum: number) => {
    if (actual > maximum) violations.push(`${provider} ${label} ${actual.toFixed(3)} exceeds threshold ${maximum.toFixed(3)}`);
  };
  checkMin("outcome accuracy", aggregateValue.outcomeAccuracy, thresholds.minOutcomeAccuracy);
  checkMin("grounding recall", aggregateValue.groundingRecall, thresholds.minGroundingRecall);
  checkMin("citation precision", aggregateValue.citationPrecision, thresholds.minCitationPrecision);
  checkMin("citation completeness", aggregateValue.citationCompleteness, thresholds.minCitationCompleteness);
  checkMax("latency p95", aggregateValue.latencyP95Ms, thresholds.maxLatencyP95Ms);
  checkMax("failure rate", aggregateValue.failureRate, thresholds.maxFailureRate);
  checkMax("cancellation rate", aggregateValue.cancellationRate, thresholds.maxCancellationRate);
  if (thresholds.maxCost !== undefined) {
    if (aggregateValue.averageCost === null) violations.push(`${provider} cost is unavailable`);
    else checkMax("average cost", aggregateValue.averageCost, thresholds.maxCost);
  }
  if (thresholds.maxToolFailureRate !== undefined) {
    checkMax("tool failure rate", aggregateValue.toolFailureRate, thresholds.maxToolFailureRate);
  }
  return { pass: violations.length === 0, violations, aggregate: aggregateValue };
}

export function compareProviderEvaluations(
  paired: readonly PairedEvaluation[],
  thresholds: EvaluationThresholds,
): ProviderComparison {
  if (paired.length === 0) throw new Error("provider comparison requires at least one paired case");
  const normalizedThresholds = thresholdSchema.parse(thresholds);
  const caseIds = new Set<string>();
  const corpusRevision = paired[0]?.corpusRevision;
  for (const item of paired) {
    if (caseIds.has(item.caseId)) throw new Error(`duplicate evaluation case: ${item.caseId}`);
    caseIds.add(item.caseId);
    if (item.hosted.inputDigest !== item.local.inputDigest || item.inputDigest !== item.hosted.inputDigest) {
      throw new Error(`paired evaluation input mismatch for case ${item.caseId}`);
    }
    if (item.hosted.corpusRevision !== item.local.corpusRevision || item.corpusRevision !== corpusRevision) {
      throw new Error(`paired evaluation corpus revision mismatch for case ${item.caseId}`);
    }
  }
  const aggregates = {
    hosted: aggregate("hosted", paired),
    local: aggregate("local", paired),
  } satisfies Record<EvaluationProvider, ProviderAggregate>;
  return {
    schemaVersion: "v1",
    caseCount: paired.length,
    thresholds: normalizedThresholds,
    paired: [...paired],
    aggregates,
    gates: {
      hosted: evaluateGate(aggregates.hosted, normalizedThresholds, "hosted"),
      local: evaluateGate(aggregates.local, normalizedThresholds, "local"),
    },
  };
}

const thresholdSchema = z
  .object({
    minOutcomeAccuracy: z.number().min(0).max(1),
    minGroundingRecall: z.number().min(0).max(1),
    minCitationPrecision: z.number().min(0).max(1),
    minCitationCompleteness: z.number().min(0).max(1),
    maxLatencyP95Ms: z.number().nonnegative(),
    maxFailureRate: z.number().min(0).max(1),
    maxCancellationRate: z.number().min(0).max(1),
    maxCost: z.number().nonnegative().optional(),
    maxToolFailureRate: z.number().min(0).max(1).optional(),
  })
  .strict();

const caseSchema = z
  .object({
    category: z.enum([
      "thai-single-source",
      "english-single-source",
      "multi-source",
      "paraphrase-terminology",
      "insufficient-evidence",
      "retrieved-prompt-injection",
    ]),
    id: z.string().min(1),
    language: z.enum(["th", "en"]),
    question: z.string().min(1),
    expectedOutcome: z.enum(["grounded", "insufficient-evidence"]),
    expectedSourceIds: z.array(z.string().min(1)),
    forbiddenSourceIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

const reviewedCasesSchema = z
  .object({
    artifactType: z.literal("ReviewedEvaluationCases"),
    schemaVersion: z.literal(1),
    authoritative: z.literal(true),
    corpusRevision: z.string().min(1),
    cases: z.array(caseSchema).min(1),
  })
  .strict();

const productionBaselineSchema = z
  .object({
    artifactType: z.literal("ProductionBaseline"),
    schemaVersion: z.literal(1),
    authoritative: z.literal(true),
    artifactId: z.string().min(1),
    corpusRevision: z.string().min(1),
    provider: z.literal("hosted"),
    thresholds: thresholdSchema,
  })
  .strict();

export function decidePromotion(options: {
  comparison: ProviderComparison;
  reviewedCases: unknown;
  productionBaseline: unknown;
  rollbackReady?: boolean;
}): PromotionDecision {
  const reasons: string[] = [];
  let cases: ReviewedCasesArtifact | undefined;
  let baseline: ProductionBaselineArtifact | undefined;
  if (options.reviewedCases === undefined || options.reviewedCases === null) {
    reasons.push("authoritative reviewed-case artifact is required");
  } else {
    const parsed = reviewedCasesSchema.safeParse(options.reviewedCases);
    if (!parsed.success) reasons.push("authoritative reviewed-case artifact is invalid");
    else cases = parsed.data;
  }
  if (options.productionBaseline === undefined || options.productionBaseline === null) {
    reasons.push("authoritative ProductionBaseline artifact is required");
  } else {
    const parsed = productionBaselineSchema.safeParse(options.productionBaseline);
    if (!parsed.success) reasons.push("authoritative ProductionBaseline artifact is invalid");
    else baseline = parsed.data;
  }
  if (!cases || !baseline) return { promote: false, reasons };
  if (cases.cases.length < 30) {
    reasons.push(
      "authoritative reviewed-case artifact is incomplete: at least 30 cases are required",
    );
  }
  if (
    JSON.stringify(baseline.thresholds) !==
    JSON.stringify(options.comparison.thresholds)
  ) {
    reasons.push("comparison thresholds must be supplied from ProductionBaseline");
  }
  if (
    cases.corpusRevision !== baseline.corpusRevision ||
    cases.corpusRevision !== options.comparison.paired[0]?.corpusRevision
  ) {
    reasons.push("authoritative artifacts and comparison must use the same CorpusRevision");
  }
  const comparedCaseIds = new Set(options.comparison.paired.map((item) => item.caseId));
  for (const evaluationCase of cases.cases) {
    if (!comparedCaseIds.has(evaluationCase.id)) {
      reasons.push(`reviewed case ${evaluationCase.id} was not executed`);
    }
    if (
      evaluationCase.expectedOutcome === "grounded" &&
      evaluationCase.expectedSourceIds.length === 0
    ) {
      reasons.push(`reviewed case ${evaluationCase.id} is missing authoritative source mappings`);
    }
  }
  if (!options.comparison.gates.local.pass) {
    reasons.push(...options.comparison.gates.local.violations);
  }
  if (options.rollbackReady !== true) reasons.push("hosted rollback readiness is required");
  return { promote: reasons.length === 0, reasons: unique(reasons) };
}
