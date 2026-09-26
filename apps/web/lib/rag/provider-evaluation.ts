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

export interface EvaluationCase extends Omit<RagEvaluationCase, "forbiddenSourceIds"> {
  forbiddenSourceIds?: string[];
  accessScope?: Record<string, unknown>;
}
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
  toolEvents?: Array<{
    type: "started" | "completed" | "failed";
    toolId: string;
  }>;
  evidence?: {
    outcome: RagActualOutcome;
    retrievedSourceIds: string[];
    citationSourceIds: string[];
    latency: { totalMs: number; retrievalMs: number; generationMs: number };
    capacity: ProviderTrace["capacity"];
    tools: ProviderTrace["tools"];
    toolEvents: Array<{
      type: "started" | "completed" | "failed";
      toolId: string;
    }>;
    toolTelemetryPresent: boolean;
    cancelled: boolean;
    unicode: ProviderTrace["unicode"];
    cost?: number;
    failure?: string;
  };
  caseId: string;
  provider: EvaluationProvider;
  runId: string;
  inputDigest: string;
  accessScopeDigest: string;
  accessScope?: Record<string, string | number | boolean | string[]>;
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
    expectedSourceIds: string[];
    forbiddenSourceIds: string[];
    retrievedSourceIds: string[];
    sourceRecall: number;
  };
  citations: {
    sourceIds: string[];
    precision: number;
    completeness: number;
    violations: string[];
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
  toolTelemetryPresent: boolean;
  failure?: string;
  cancelled?: boolean;
  cost?: number;
}

export interface PairedEvaluation {
  schemaVersion: "v1";
  caseId: string;
  inputDigest: string;
  accessScopeDigest: string;
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
  costMeasurementCount: number;
  toolFailureRate: number;
  toolTelemetryCount: number;
  citationViolationCount: number;
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
  tools: ProviderTrace["tools"];
  toolEvents: ProviderTrace["toolEvents"];
  toolTelemetryPresent: boolean;
  toolTelemetryMalformed: boolean;
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
type SafeAccessScope = Record<string, string | number | boolean | string[]>;
type EvaluationTurnInput = AgentTurnInput & { accessScope?: SafeAccessScope };

const SAFE_SCOPE_KEYS: Record<string, true> = {
  tenant: true,
  tenantId: true,
  role: true,
  roles: true,
  documentIds: true,
  visibility: true,
  principalId: true,
  permissions: true,
};

function normalizeAccessScope(scope: Record<string, unknown> | undefined): SafeAccessScope {
  if (!scope) return {};
  const normalized: SafeAccessScope = {};
  for (const key of Object.keys(scope).sort()) {
    if (SAFE_SCOPE_KEYS[key] !== true) continue;
    const value = scope[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      normalized[key] = value;
    } else if (
      Array.isArray(value) &&
      value.every((entry): entry is string => typeof entry === "string")
    ) {
      normalized[key] = value.slice(0, 20);
    }
  }
  return normalized;
}

function scopeDigest(scope: SafeAccessScope): string {
  return createHash("sha256").update(JSON.stringify(scope)).digest("hex");
}

function canonicalInput(input: EvaluationTurnInput): EvaluationTurnInput {
  return {
    runId: "normalized",
    ...(input.accessScope === undefined
      ? {}
      : { accessScope: normalizeAccessScope(input.accessScope) }),
    messages: input.messages.map((message) => ({
      ...message,
      parts: message.parts.map((part) => ({
        ...part,
        text: part.text.replace(/\r\n?/g, "\n").normalize("NFC").trim(),
      })),
    })),
  };
}

function inputDigest(input: EvaluationTurnInput): string {
  const normalized = canonicalInput(input);
  return createHash("sha256")
    .update(
      JSON.stringify({
        accessScope: normalized.accessScope ?? {},
        messages: normalized.messages,
      }),
    )
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
    toolEvents: [],
    toolTelemetryPresent: false,
    toolTelemetryMalformed: false,
  };
  let generationStarted: number | undefined;
  const startedTools = new Set<string>();
  const terminalTools = new Set<string>();
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
        case "tool.completed":
        case "tool.failed": {
          const toolId =
            typeof event.toolId === "string"
              ? event.toolId.trim()
              : typeof event.tool === "string"
                ? event.tool.trim()
                : "";
          if (!toolId) {
            metrics.toolTelemetryMalformed = true;
            metrics.toolTelemetryPresent = false;
            break;
          }
          if (event.type === "tool.started") {
            if (startedTools.has(toolId)) {
              metrics.toolTelemetryMalformed = true;
              metrics.toolTelemetryPresent = false;
              break;
            }
            metrics.toolEvents.push({ type: "started", toolId });
            startedTools.add(toolId);
            metrics.tools.attempted += 1;
            break;
          }
          if (!startedTools.has(toolId) || terminalTools.has(toolId)) {
            metrics.toolTelemetryMalformed = true;
            metrics.toolTelemetryPresent = false;
            break;
          }
          metrics.toolEvents.push({
            type: event.type === "tool.completed" ? "completed" : "failed",
            toolId,
          });
          terminalTools.add(toolId);
          if (event.type === "tool.completed") metrics.tools.succeeded += 1;
          else metrics.tools.failed += 1;
          metrics.toolTelemetryPresent =
            !metrics.toolTelemetryMalformed &&
            startedTools.size > 0 &&
            terminalTools.size === startedTools.size;
          break;
        }
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
function evaluationCaseInput(evaluationCase: EvaluationCase): EvaluationTurnInput {
  return {
    runId: "normalized",
    accessScope: normalizeAccessScope(evaluationCase.accessScope),
    messages: [
      {
        id: `evaluation-${evaluationCase.id}`,
        role: "user",
        parts: [{ type: "text", text: evaluationCase.question }],
      },
    ],
  };
}
async function runProvider(
  provider: EvaluationProvider,
  evaluationCase: EvaluationCase,
  runner: AgentTurnRunner,
  metadata: ServingMetadata,
  corpusRevision: string,
  now: () => number,
): Promise<ProviderTrace> {
  const normalized = canonicalInput(evaluationCaseInput(evaluationCase));
  const digest = inputDigest(normalized);
  const activeScopeDigest = scopeDigest(normalized.accessScope ?? {});
  const inputText = normalized.messages
    .flatMap((message) => message.parts.map((part) => part.text))
    .join("\n");
  const inputUnicode = unicodeMetrics(inputText);
  const { metrics, sink } = extractRunMetrics();
  const startedAt = now();
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
  const expectedSources = new Set(evaluationCase.expectedSourceIds);
  const forbiddenSources = new Set(evaluationCase.forbiddenSourceIds ?? []);
  const citationViolations = unique([
    ...citationSources
      .filter((source) => forbiddenSources.has(source))
      .map((source) => `forbidden:${source}`),
    ...citationSources
      .filter((source) => !expectedSources.has(source))
      .map((source) => `unknown:${source}`),
  ]);
  const model = safeServingMetadata(metadata);
  const failure = metrics.failure ?? ("code" in result ? safeCode(result.code) : undefined);
  return {
    schemaVersion: "v1",
    caseId: evaluationCase.id,
    provider,
    runId: runId(provider, evaluationCase.id, digest),
    inputDigest: digest,
    accessScopeDigest: activeScopeDigest,
    ...(Object.keys(normalized.accessScope ?? {}).length === 0
      ? {}
      : { accessScope: normalized.accessScope }),
    corpusRevision,
    ...model,
    outcome: actualOutcome,
    grounding: {
      corpusRevision,
      expectedSourceIds: [...evaluationCase.expectedSourceIds],
      forbiddenSourceIds: [...(evaluationCase.forbiddenSourceIds ?? [])],
      retrievedSourceIds: observedSources,
      sourceRecall: sourceRecall(evaluationCase.expectedSourceIds, observedSources),
    },
    citations: {
      sourceIds: citationSources,
      precision: citationPrecision(evaluationCase.expectedSourceIds, citationSources),
      completeness: citationCompleteness(evaluationCase.expectedSourceIds, citationSources),
      violations: citationViolations,
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
    toolEvents: metrics.toolEvents,
    tools: metrics.tools,
    toolTelemetryPresent: metrics.toolTelemetryPresent,
    evidence: {
      outcome: actualOutcome,
      retrievedSourceIds: observedSources,
      citationSourceIds: citationSources,
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
      toolEvents: metrics.toolEvents,
      toolTelemetryPresent: metrics.toolTelemetryPresent,
      cancelled: metrics.cancelled === true,
      unicode: {
        inputCodePointCount: inputUnicode.codePointCount,
        inputNonAsciiCount: inputUnicode.nonAsciiCount,
        outputCodePointCount: outputUnicode.codePointCount,
        outputNonAsciiCount: outputUnicode.nonAsciiCount,
        outputNfc: outputUnicode.nfc,
      },
      ...(failure === undefined ? {} : { failure }),
      ...(metrics.cost === undefined ? {} : { cost: metrics.cost }),
    },
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
  requireCostTelemetry?: boolean;
}): Promise<PairedEvaluation> {
  const now = options.now ?? performance.now.bind(performance);
  const accessScope = normalizeAccessScope(options.evaluationCase.accessScope);
  if (
    Object.keys(accessScope).length > 0 &&
    (options.hosted.supportsAccessScope !== true ||
      options.local.supportsAccessScope !== true)
  ) {
    throw new Error("provider evaluation requires runners that enforce AccessScope");
  }
  if (
    options.requireCostTelemetry === true &&
    (options.hosted.supportsCostTelemetry !== true ||
      options.local.supportsCostTelemetry !== true)
  ) {
    throw new Error("provider evaluation requires runners with cost telemetry");
  }
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
    accessScopeDigest: hosted.accessScopeDigest,
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
  const costs = traces
    .map((trace) => trace.cost)
    .filter((cost): cost is number => cost !== undefined && Number.isFinite(cost));
  const attemptedTools = traces.reduce((sum, trace) => sum + trace.tools.attempted, 0);
  return {
    caseCount: traces.length,
    outcomeAccuracy: average(traces.map((trace) => (trace.quality.outcomeCorrect ? 1 : 0))),
    groundingRecall: average(traces.map((trace) => trace.grounding.sourceRecall)),
    citationPrecision: average(traces.map((trace) => trace.citations.precision)),
    citationCompleteness: average(traces.map((trace) => trace.citations.completeness)),
    latencyP95Ms: nearestRank(traces.map((trace) => trace.latency.totalMs), 0.95),
    failureRate: average(
      traces.map((trace) =>
        trace.outcome === "failed" || trace.outcome === "retrieval-unavailable" ? 1 : 0,
      ),
    ),
    cancellationRate: average(traces.map((trace) => (trace.cancelled ? 1 : 0))),
    averageCost: costs.length === 0 ? null : average(costs),
    costMeasurementCount: costs.length,
    toolFailureRate:
      attemptedTools === 0
        ? 0
        : traces.reduce((sum, trace) => sum + trace.tools.failed, 0) / attemptedTools,
    toolTelemetryCount: traces.filter((trace) => trace.toolTelemetryPresent).length,
    citationViolationCount: traces.reduce(
      (sum, trace) => sum + trace.citations.violations.length,
      0,
    ),
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
  if (aggregateValue.citationViolationCount > 0) {
    violations.push(
      `${provider} citation safety violations ${aggregateValue.citationViolationCount}`,
    );
  }
  if (thresholds.maxCost !== undefined) {
    if (aggregateValue.costMeasurementCount !== aggregateValue.caseCount) {
      violations.push(`${provider} cost telemetry is incomplete`);
    } else if (aggregateValue.averageCost === null) {
      violations.push(`${provider} cost is unavailable`);
    } else {
      checkMax("average cost", aggregateValue.averageCost, thresholds.maxCost);
    }
  }
  if (thresholds.maxToolFailureRate !== undefined) {
    if (aggregateValue.toolTelemetryCount !== aggregateValue.caseCount) {
      violations.push(`${provider} tool telemetry is incomplete`);
    } else {
      checkMax("tool failure rate", aggregateValue.toolFailureRate, thresholds.maxToolFailureRate);
    }
  }
  return { pass: violations.length === 0, violations, aggregate: aggregateValue };
}

function validateTraceEvidence(trace: ProviderTrace, caseId: string): void {
  const evidence = trace.evidence;
  if (evidence !== undefined && (
    evidence.outcome !== trace.outcome ||
    JSON.stringify(evidence.retrievedSourceIds) !==
      JSON.stringify(trace.grounding.retrievedSourceIds) ||
    JSON.stringify(evidence.citationSourceIds) !==
      JSON.stringify(trace.citations.sourceIds) ||
    JSON.stringify(evidence.latency) !== JSON.stringify(trace.latency) ||
    JSON.stringify(evidence.capacity) !== JSON.stringify(trace.capacity) ||
    JSON.stringify(evidence.tools) !== JSON.stringify(trace.tools) ||
    JSON.stringify(evidence.toolEvents) !== JSON.stringify(trace.toolEvents) ||
    evidence.toolTelemetryPresent !== trace.toolTelemetryPresent ||
    evidence.cancelled !== (trace.cancelled === true) ||
    JSON.stringify(evidence.unicode) !== JSON.stringify(trace.unicode) ||
    evidence.cost !== trace.cost ||
    evidence.failure !== trace.failure
  )) {
    throw new Error(`trace metric evidence mismatch for case ${caseId}`);
  }
  const expected = trace.grounding.expectedSourceIds;
  const forbidden = trace.grounding.forbiddenSourceIds;
  const retrieved = trace.grounding.retrievedSourceIds;
  const citations = trace.citations.sourceIds;
  if (unique(retrieved).length !== retrieved.length) {
    throw new Error(`duplicate retrieved source evidence for case ${caseId}`);
  }
  if (unique(citations).length !== citations.length) {
    throw new Error(`duplicate citation source evidence for case ${caseId}`);
  }
  const expectedRecall = sourceRecall(expected, retrieved);
  if (trace.grounding.sourceRecall !== expectedRecall) {
    throw new Error(`grounding recall evidence mismatch for case ${caseId}`);
  }
  const expectedPrecision = citationPrecision(expected, citations);
  const expectedCompleteness = citationCompleteness(expected, citations);
  if (
    trace.citations.precision !== expectedPrecision ||
    trace.citations.completeness !== expectedCompleteness ||
    trace.quality.grounding.sourceRecall !== expectedRecall ||
    trace.quality.citations.precision !== expectedPrecision ||
    trace.quality.citations.completeness !== expectedCompleteness
  ) {
    throw new Error(`citation quality evidence mismatch for case ${caseId}`);
  }
  const expectedViolations = unique([
    ...citations
      .filter((source) => forbidden.includes(source))
      .map((source) => `forbidden:${source}`),
    ...citations
      .filter((source) => !expected.includes(source))
      .map((source) => `unknown:${source}`),
  ]);
  if (JSON.stringify(trace.citations.violations) !== JSON.stringify(expectedViolations)) {
    throw new Error(`citation violation evidence mismatch for case ${caseId}`);
  }

  const started = new Set<string>();
  const terminal = new Set<string>();
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  const toolEvents = trace.toolEvents ?? [];
  for (const event of toolEvents) {
    if (event.type === "started") {
      if (started.has(event.toolId)) {
        throw new Error(`duplicate tool start evidence for case ${caseId}`);
      }
      started.add(event.toolId);
      attempted += 1;
      continue;
    }
    if (!started.has(event.toolId) || terminal.has(event.toolId)) {
      throw new Error(`invalid tool lifecycle evidence for case ${caseId}`);
    }
    terminal.add(event.toolId);
    if (event.type === "completed") succeeded += 1;
    else failed += 1;
  }
  const expectedTools = { attempted, succeeded, failed };
  if (JSON.stringify(trace.tools) !== JSON.stringify(expectedTools)) {
    throw new Error(`tool count evidence mismatch for case ${caseId}`);
  }
  const expectedTelemetry = started.size > 0 && terminal.size === started.size;
  if (
    trace.toolTelemetryPresent !== undefined &&
    trace.toolTelemetryPresent !== expectedTelemetry
  ) {
    throw new Error(`tool telemetry evidence mismatch for case ${caseId}`);
  }
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
    if (
      item.hosted.caseId !== item.caseId ||
      item.local.caseId !== item.caseId
    ) {
      throw new Error(`paired evaluation case identity mismatch for case ${item.caseId}`);
    }
    if (
      item.hosted.inputDigest !== item.local.inputDigest ||
      item.inputDigest !== item.hosted.inputDigest
    ) {
      throw new Error(`paired evaluation input mismatch for case ${item.caseId}`);
    }
    if (
      item.hosted.accessScopeDigest !== item.local.accessScopeDigest ||
      item.accessScopeDigest !== item.hosted.accessScopeDigest
    ) {
      throw new Error(`paired evaluation AccessScope mismatch for case ${item.caseId}`);
    }
    if (
      item.hosted.corpusRevision !== item.local.corpusRevision ||
      item.corpusRevision !== corpusRevision
    ) {
      throw new Error(`paired evaluation corpus revision mismatch for case ${item.caseId}`);
    }
    for (const trace of [item.hosted, item.local]) {
      const expected = trace.grounding.expectedSourceIds;
      const forbidden = trace.grounding.forbiddenSourceIds;
      if (unique(expected).length !== expected.length) {
        throw new Error(`duplicate expected source mapping for case ${item.caseId}`);
      }
      if (unique(forbidden).length !== forbidden.length) {
        throw new Error(`duplicate forbidden source mapping for case ${item.caseId}`);
      }
      if (expected.some((sourceId) => forbidden.includes(sourceId))) {
        throw new Error(`overlapping source mapping for case ${item.caseId}`);
      }
      validateTraceEvidence(trace, item.caseId);
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
const traceScalarSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
]);
const accessScopeValueSchema = z.union([
  traceScalarSchema,
  z.array(z.string()),
]);
const providerTraceSchema = z
  .object({
    schemaVersion: z.literal("v1"),
    caseId: z.string().min(1),
    provider: z.enum(["hosted", "local"]),
    runId: z.string().min(1),
    inputDigest: z.string().min(1),
    accessScopeDigest: z.string().min(1),
    accessScope: z.record(z.string(), accessScopeValueSchema).optional(),
    corpusRevision: z.string().min(1),
    model: z.string().min(1),
    servingRevision: z.string().min(1),
    endpoint: z.string().min(1).optional(),
    imageDigest: z.string().min(1).optional(),
    tokenizer: z.string().min(1).optional(),
    decoding: z.record(z.string(), traceScalarSchema).optional(),
    outcome: z.enum([
      "grounded",
      "insufficient-evidence",
      "retrieval-unavailable",
      "unsupported-answer",
      "failed",
    ]),
    grounding: z
      .object({
        corpusRevision: z.string().min(1),
        expectedSourceIds: z.array(z.string().min(1)),
        forbiddenSourceIds: z.array(z.string().min(1)),
        retrievedSourceIds: z.array(z.string().min(1)),
        sourceRecall: z.number().finite().min(0).max(1),
      })
      .strict(),
    citations: z
      .object({
        sourceIds: z.array(z.string().min(1)),
        precision: z.number().finite().min(0).max(1),
        completeness: z.number().finite().min(0).max(1),
        violations: z.array(z.string().min(1)),
      })
      .strict(),
    quality: z
      .object({
        outcomeCorrect: z.boolean(),
        grounding: z.object({ sourceRecall: z.number().finite().min(0).max(1) }).strict(),
        citations: z
          .object({
            precision: z.number().finite().min(0).max(1),
            completeness: z.number().finite().min(0).max(1),
          })
          .strict(),
      })
      .strict(),
    unicode: z
      .object({
        inputCodePointCount: z.number().int().nonnegative(),
        inputNonAsciiCount: z.number().int().nonnegative(),
        outputCodePointCount: z.number().int().nonnegative(),
        outputNonAsciiCount: z.number().int().nonnegative(),
        outputNfc: z.boolean(),
      })
      .strict(),
    latency: z
      .object({
        totalMs: z.number().finite().nonnegative(),
        retrievalMs: z.number().finite().nonnegative(),
        generationMs: z.number().finite().nonnegative(),
      })
      .strict(),
    capacity: z
      .object({
        candidateCount: z.number().finite().nonnegative().optional(),
        acceptedCount: z.number().finite().nonnegative().optional(),
        promptTokens: z.number().finite().nonnegative().optional(),
        completionTokens: z.number().finite().nonnegative().optional(),
        queueMs: z.number().finite().nonnegative().optional(),
      })
      .strict(),
    evidence: z
      .object({
        outcome: z.enum([
          "grounded",
          "insufficient-evidence",
          "retrieval-unavailable",
          "unsupported-answer",
          "failed",
        ]),
        retrievedSourceIds: z.array(z.string().min(1)),
        citationSourceIds: z.array(z.string().min(1)),
        latency: z
          .object({
            totalMs: z.number().finite().nonnegative(),
            retrievalMs: z.number().finite().nonnegative(),
            generationMs: z.number().finite().nonnegative(),
          })
          .strict(),
        capacity: z
          .object({
            candidateCount: z.number().finite().nonnegative().optional(),
            acceptedCount: z.number().finite().nonnegative().optional(),
            promptTokens: z.number().finite().nonnegative().optional(),
            completionTokens: z.number().finite().nonnegative().optional(),
            queueMs: z.number().finite().nonnegative().optional(),
          })
          .strict(),
        tools: z
          .object({
            attempted: z.number().int().nonnegative(),
            succeeded: z.number().int().nonnegative(),
            failed: z.number().int().nonnegative(),
          })
          .strict(),
        toolEvents: z
          .array(
            z
              .object({
                type: z.enum(["started", "completed", "failed"]),
                toolId: z.string().min(1),
              })
              .strict(),
          ),
        toolTelemetryPresent: z.boolean(),
        cancelled: z.boolean(),
        unicode: z
          .object({
            inputCodePointCount: z.number().int().nonnegative(),
            inputNonAsciiCount: z.number().int().nonnegative(),
            outputCodePointCount: z.number().int().nonnegative(),
            outputNonAsciiCount: z.number().int().nonnegative(),
            outputNfc: z.boolean(),
          })
          .strict(),
        cost: z.number().finite().nonnegative().optional(),
        failure: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    toolEvents: z
      .array(
        z
          .object({
            type: z.enum(["started", "completed", "failed"]),
            toolId: z.string().min(1),
          })
          .strict(),
      ).optional(),
    tools: z
      .object({
        attempted: z.number().int().nonnegative(),
        succeeded: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
      })
      .strict(),
    toolTelemetryPresent: z.boolean().optional(),
    failure: z.string().min(1).optional(),
    cancelled: z.boolean().optional(),
    cost: z.number().finite().nonnegative().optional(),
  })
  .strict();
const pairedEvaluationSchema = z
  .object({
    schemaVersion: z.literal("v1"),
    caseId: z.string().min(1),
    inputDigest: z.string().min(1),
    accessScopeDigest: z.string().min(1),
    corpusRevision: z.string().min(1),
    hosted: providerTraceSchema,
    local: providerTraceSchema,
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
    accessScope: z.record(z.string(), z.unknown()).optional(),
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
const REQUIRED_COHORT_COUNTS: Record<EvaluationCase["category"], number> = {
  "thai-single-source": 10,
  "english-single-source": 5,
  "multi-source": 5,
  "paraphrase-terminology": 5,
  "insufficient-evidence": 3,
  "retrieved-prompt-injection": 2,
};

function reviewedCaseViolations(cases: readonly EvaluationCase[]): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();
  const counts: Record<EvaluationCase["category"], number> = {
    "thai-single-source": 0,
    "english-single-source": 0,
    "multi-source": 0,
    "paraphrase-terminology": 0,
    "insufficient-evidence": 0,
    "retrieved-prompt-injection": 0,
  };
  for (const evaluationCase of cases) {
    if (seen.has(evaluationCase.id)) {
      violations.push(`reviewed case ${evaluationCase.id} is duplicated`);
    }
    seen.add(evaluationCase.id);
    counts[evaluationCase.category] += 1;
    const expectedSourceIds = evaluationCase.expectedSourceIds;
    const forbiddenSourceIds = evaluationCase.forbiddenSourceIds ?? [];
    const expectedSources = expectedSourceIds.length;
    if (new Set(expectedSourceIds).size !== expectedSourceIds.length) {
      violations.push(`reviewed case ${evaluationCase.id} has duplicate expected source mappings`);
    }
    if (new Set(forbiddenSourceIds).size !== forbiddenSourceIds.length) {
      violations.push(`reviewed case ${evaluationCase.id} has duplicate forbidden source mappings`);
    }
    if (expectedSourceIds.some((sourceId) => forbiddenSourceIds.includes(sourceId))) {
      violations.push(`reviewed case ${evaluationCase.id} has overlapping source mappings`);
    }
    const valid =
      (evaluationCase.category === "thai-single-source" &&
        evaluationCase.language === "th" &&
        evaluationCase.expectedOutcome === "grounded" &&
        expectedSources === 1) ||
      (evaluationCase.category === "english-single-source" &&
        evaluationCase.language === "en" &&
        evaluationCase.expectedOutcome === "grounded" &&
        expectedSources === 1) ||
      (evaluationCase.category === "multi-source" &&
        evaluationCase.expectedOutcome === "grounded" &&
        expectedSources >= 2) ||
      ((evaluationCase.category === "paraphrase-terminology" ||
        evaluationCase.category === "retrieved-prompt-injection") &&
        evaluationCase.expectedOutcome === "grounded" &&
        expectedSources > 0) ||
      (evaluationCase.category === "insufficient-evidence" &&
        evaluationCase.expectedOutcome === "insufficient-evidence" &&
        expectedSources === 0);
    if (!valid) {
      violations.push(`reviewed case ${evaluationCase.id} does not match its cohort`);
    }
    if (evaluationCase.expectedOutcome === "grounded" && expectedSources === 0) {
      violations.push(`reviewed case ${evaluationCase.id} is missing authoritative source mappings`);
    }
  }
  for (const [category, required] of Object.entries(REQUIRED_COHORT_COUNTS)) {
    const actual = counts[category as EvaluationCase["category"]];
    if (actual < required) violations.push(`reviewed cohort ${category} is incomplete`);
  }
  return violations;
}

function canonicalEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalEvidence);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalEvidence(item)]),
    );
  }
  return value;
}

function verifiedComparison(value: unknown): ProviderComparison | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const candidate = value as { paired?: unknown; thresholds?: unknown };
  try {
    const paired = pairedEvaluationSchema
      .array()
      .min(1)
      .parse(candidate.paired);
    const thresholds = thresholdSchema.parse(candidate.thresholds);
    const recomputed = compareProviderEvaluations(paired, thresholds);
    return JSON.stringify(canonicalEvidence(recomputed)) ===
      JSON.stringify(canonicalEvidence(value))
      ? recomputed
      : undefined;
  } catch {
    return undefined;
  }
}

export function decidePromotion(options: {
  comparison: unknown;
  reviewedCases: unknown;
  productionBaseline: unknown;
  rollbackReady?: boolean;
}): PromotionDecision {
  const reasons: string[] = [];
  const comparison = verifiedComparison(options.comparison);
  if (comparison === undefined) {
    return { promote: false, reasons: ["provider comparison is stale or forged"] };
  }
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
  const reviewedCasesById = new Map(cases.cases.map((evaluationCase) => [evaluationCase.id, evaluationCase]));
  for (const item of comparison.paired) {
    const evaluationCase = reviewedCasesById.get(item.caseId);
    if (!evaluationCase) continue;
    const expectedSourceIds = evaluationCase.expectedSourceIds;
    const forbiddenSourceIds = evaluationCase.forbiddenSourceIds ?? [];
    for (const provider of ["hosted", "local"] as const) {
      const trace = item[provider];
      if (trace.provider !== provider) {
        reasons.push(`${provider} trace provider lineage mismatch for case ${item.caseId}`);
      }
      const expectedScope = normalizeAccessScope(evaluationCase.accessScope);
      if (
        JSON.stringify(canonicalEvidence(trace.accessScope ?? {})) !==
        JSON.stringify(canonicalEvidence(expectedScope))
      ) {
        reasons.push(`${provider} trace AccessScope projection mismatch for case ${item.caseId}`);
      }
      if (trace.accessScopeDigest !== scopeDigest(expectedScope)) {
        reasons.push(`${provider} trace AccessScope digest mismatch for case ${item.caseId}`);
      }
      if (
        trace.corpusRevision !== cases.corpusRevision ||
        trace.grounding.corpusRevision !== cases.corpusRevision
      ) {
        reasons.push(`${provider} trace corpus lineage mismatch for case ${item.caseId}`);
      }
      if (
        JSON.stringify(trace.grounding.expectedSourceIds) !==
          JSON.stringify(expectedSourceIds) ||
        JSON.stringify(trace.grounding.forbiddenSourceIds) !==
          JSON.stringify(forbiddenSourceIds)
      ) {
        reasons.push(`${provider} trace source lineage mismatch for case ${item.caseId}`);
      }
      if (trace.quality.outcomeCorrect !== (trace.outcome === evaluationCase.expectedOutcome)) {
        reasons.push(`${provider} trace outcome lineage mismatch for case ${item.caseId}`);
      }
    }
  }
  reasons.push(...reviewedCaseViolations(cases.cases));
  if (cases.cases.length < 30) {
    reasons.push(
      "authoritative reviewed-case artifact is incomplete: at least 30 cases are required",
    );
  }
  if (
    JSON.stringify(baseline.thresholds) !== JSON.stringify(comparison.thresholds)
  ) {
    reasons.push("comparison thresholds must be supplied from ProductionBaseline");
  }
  if (
    cases.corpusRevision !== baseline.corpusRevision ||
    cases.corpusRevision !== comparison.paired[0]?.corpusRevision
  ) {
    reasons.push("authoritative artifacts and comparison must use the same CorpusRevision");
  }
  const reviewedCaseIds = new Set(cases.cases.map((evaluationCase) => evaluationCase.id));
  const comparedCaseIds = new Set(comparison.paired.map((item) => item.caseId));
  for (const evaluationCase of cases.cases) {
    const paired = comparison.paired.find((item) => item.caseId === evaluationCase.id);
    if (!paired) {
      reasons.push(`reviewed case ${evaluationCase.id} was not executed`);
      continue;
    }
    const normalized = canonicalInput(evaluationCaseInput(evaluationCase));
    if (paired.inputDigest !== inputDigest(normalized)) {
      reasons.push(`reviewed case ${evaluationCase.id} input identity mismatch`);
    }
    if (paired.accessScopeDigest !== scopeDigest(normalized.accessScope ?? {})) {
      reasons.push(`reviewed case ${evaluationCase.id} AccessScope identity mismatch`);
    }
  }
  for (const caseId of comparedCaseIds) {
    if (!reviewedCaseIds.has(caseId)) reasons.push(`unexpected compared case ${caseId}`);
  }
  if (!comparison.gates.local.pass) {
    reasons.push(...comparison.gates.local.violations);
  }
  if (options.rollbackReady !== true) reasons.push("hosted rollback readiness is required");
  return { promote: reasons.length === 0, reasons: unique(reasons) };
}
