import { z } from "zod";

export type RagExpectedOutcome = "grounded" | "insufficient-evidence";
export type RagEvaluationCategory =
  | "thai-single-source"
  | "english-single-source"
  | "multi-source"
  | "paraphrase-terminology"
  | "insufficient-evidence"
  | "retrieved-prompt-injection";
export type RagActualOutcome =
  | RagExpectedOutcome
  | "retrieval-unavailable"
  | "unsupported-answer"
  | "failed";

export interface RagEvaluationCase {
  category: RagEvaluationCategory;
  id: string;
  language: "th" | "en";
  question: string;
  expectedOutcome: RagExpectedOutcome;
  expectedSourceIds: string[];
  forbiddenSourceIds?: string[];
}

export interface RagStageLatencies {
  total: number;
  retrieval: number;
  generation: number;
}

export interface RagEvaluationRecord {
  caseId: string;
  category: RagEvaluationCategory;
  language: RagEvaluationCase["language"];
  runner: string;
  retrievalConfig?: string;
  corpusRevision: string;
  modelId: string;
  expectedOutcome: RagExpectedOutcome;
  actualOutcome: RagActualOutcome;
  expectedSourceIds: string[];
  forbiddenSourceIds: string[];
  retrievedSourceIds: string[];
  citationSourceIds: string[];
  retrievalAttempts: number;
  latencyMs: RagStageLatencies;
  candidateCount?: number;
  acceptedCount?: number;
  hierarchyExpansion?: boolean;
  rerankerUsed?: boolean;
  sourceRecall: number;
  citationPrecision: number;
  citationCompleteness: number;
  tokenUse?: number;
  cost?: number;
  failure?: string;
  cancelled?: boolean;
}

export interface PercentileSummary {
  p50: number;
  p95: number;
}

export interface RagLatencySummary {
  total: PercentileSummary;
  retrieval: PercentileSummary;
  generation: PercentileSummary;
}
export interface RagEvaluationAggregate {
  caseCount: number;
  sourceRecall: number;
  meanFirstAcceptedSourceRank: number | null;
  outcomeAccuracy: number;
  citationPrecision: number;
  citationCompleteness: number;
  averageRetrievalAttempts: number;
  averageCandidateCount: number | null;
  averageAcceptedCount: number | null;
  rerankerUsageRate: number | null;
  hierarchyExpansionRate: number | null;
  averageTokenUse: number | null;
  averageCost: number | null;
  failureCount: number;
  cancellationCount: number;
  latencyMs: RagLatencySummary;
}

export interface RagEvaluationBaseline {
  outcomeAccuracy: number;
  sourceRecall?: number;
  citationPrecision?: number;
  citationCompleteness?: number;
  maxLatencyP95?: number;
}

const evaluationCaseSchema = z
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

const evaluationManifestSchema = z.discriminatedUnion("status", [
  z
    .object({
      schemaVersion: z.literal(1),
      status: z.literal("incomplete"),
      blocker: z.string().min(1),
      corpusRevision: z.null(),
      baseline: z.null(),
      cases: z.array(evaluationCaseSchema),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      status: z.literal("ready"),
      corpusRevision: z.string().min(1),
      baseline: z
        .object({
          outcomeAccuracy: z.number().min(0).max(1),
          sourceRecall: z.number().min(0).max(1),
          citationPrecision: z.number().min(0).max(1),
          citationCompleteness: z.number().min(0).max(1),
          maxLatencyP95: z.number().nonnegative(),
        })
        .strict(),
      cases: z.array(evaluationCaseSchema),
    })
    .strict(),
]);

export type RagEvaluationManifest = z.infer<typeof evaluationManifestSchema>;
export type ReadyRagEvaluationManifest = Extract<
  RagEvaluationManifest,
  { status: "ready" }
>;

export function parseEvaluationManifest(value: unknown): RagEvaluationManifest {
  return evaluationManifestSchema.parse(value);
}

const REQUIRED_CATEGORY_COUNTS: Record<RagEvaluationCategory, number> = {
  "thai-single-source": 10,
  "english-single-source": 5,
  "multi-source": 5,
  "paraphrase-terminology": 5,
  "insufficient-evidence": 3,
  "retrieved-prompt-injection": 2,
};

export function assertEvaluationManifestReady(
  manifest: RagEvaluationManifest,
): asserts manifest is ReadyRagEvaluationManifest {
  if (manifest.status === "incomplete") {
    throw new Error(`RAG evaluation prerequisite unavailable: ${manifest.blocker}`);
  }
  if (manifest.cases.length < 30) {
    throw new Error("RAG evaluation manifest must contain at least 30 reviewed cases");
  }

  const categoryCounts: Record<RagEvaluationCategory, number> = {
    "thai-single-source": 0,
    "english-single-source": 0,
    "multi-source": 0,
    "paraphrase-terminology": 0,
    "insufficient-evidence": 0,
    "retrieved-prompt-injection": 0,
  };
  const caseIds = new Set<string>();
  for (const evaluationCase of manifest.cases) {
    if (caseIds.has(evaluationCase.id)) {
      throw new Error(`RAG evaluation case ID is duplicated: ${evaluationCase.id}`);
    }
    caseIds.add(evaluationCase.id);
    categoryCounts[evaluationCase.category] += 1;

    if (
      evaluationCase.expectedOutcome === "grounded" &&
      evaluationCase.expectedSourceIds.length === 0
    ) {
      throw new Error(
        `Grounded evaluation case ${evaluationCase.id} requires an authoritative source ID`,
      );
    }
    if (
      evaluationCase.expectedOutcome === "insufficient-evidence" &&
      evaluationCase.expectedSourceIds.length > 0
    ) {
      throw new Error(
        `Insufficient-evidence case ${evaluationCase.id} cannot declare expected source IDs`,
      );
    }
    if (
      evaluationCase.category === "thai-single-source" &&
      (evaluationCase.language !== "th" ||
        evaluationCase.expectedOutcome !== "grounded" ||
        evaluationCase.expectedSourceIds.length !== 1)
    ) {
      throw new Error(
        `Evaluation case ${evaluationCase.id} does not match thai-single-source`,
      );
    }
    if (
      evaluationCase.category === "english-single-source" &&
      (evaluationCase.language !== "en" ||
        evaluationCase.expectedOutcome !== "grounded" ||
        evaluationCase.expectedSourceIds.length !== 1)
    ) {
      throw new Error(
        `Evaluation case ${evaluationCase.id} does not match english-single-source`,
      );
    }
    if (
      evaluationCase.category === "multi-source" &&
      (evaluationCase.expectedOutcome !== "grounded" ||
        evaluationCase.expectedSourceIds.length < 2)
    ) {
      throw new Error(`Evaluation case ${evaluationCase.id} does not match multi-source`);
    }
    if (
      (evaluationCase.category === "paraphrase-terminology" ||
        evaluationCase.category === "retrieved-prompt-injection") &&
      (evaluationCase.expectedOutcome !== "grounded" ||
        evaluationCase.expectedSourceIds.length === 0)
    ) {
      throw new Error(
        `Evaluation case ${evaluationCase.id} does not match ${evaluationCase.category}`,
      );
    }
    if (
      evaluationCase.category === "insufficient-evidence" &&
      evaluationCase.expectedOutcome !== "insufficient-evidence"
    ) {
      throw new Error(
        `Evaluation case ${evaluationCase.id} does not match insufficient-evidence`,
      );
    }
  }

  const missingCohorts = Object.entries(REQUIRED_CATEGORY_COUNTS)
    .filter(
      ([category, required]) =>
        categoryCounts[category as RagEvaluationCategory] < required,
    )
    .map(
      ([category, required]) =>
        `${category} ${categoryCounts[category as RagEvaluationCategory]}/${required}`,
    );
  if (missingCohorts.length > 0) {
    throw new Error(
      `RAG evaluation manifest is missing required cohorts: ${missingCohorts.join(", ")}`,
    );
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageOptional(values: readonly (number | undefined)[]): number | null {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length === 0 ? null : average(present);
}

export function sourceRecall(
  expectedSourceIds: readonly string[],
  retrievedSourceIds: readonly string[],
): number {
  const expected = unique(expectedSourceIds);
  if (expected.length === 0) return 1;
  const retrieved = new Set(retrievedSourceIds);
  return expected.filter((sourceId) => retrieved.has(sourceId)).length / expected.length;
}

export function firstAcceptedSourceRank(
  retrievedSourceIds: readonly string[],
  expectedSourceIds: readonly string[],
): number | null {
  if (expectedSourceIds.length === 0) return null;
  const expected = new Set(expectedSourceIds);
  const index = retrievedSourceIds.findIndex((sourceId) => expected.has(sourceId));
  return index === -1 ? null : index + 1;
}

export function outcomeAccuracy(
  records: readonly Pick<
    RagEvaluationRecord,
    "actualOutcome" | "expectedOutcome"
  >[],
): number {
  if (records.length === 0) return 0;
  return (
    records.filter(({ actualOutcome, expectedOutcome }) => actualOutcome === expectedOutcome)
      .length / records.length
  );
}

export function citationPrecision(
  expectedSourceIds: readonly string[],
  citationSourceIds: readonly string[],
): number {
  const citations = unique(citationSourceIds);
  if (citations.length === 0) return 1;
  const expected = new Set(expectedSourceIds);
  return citations.filter((sourceId) => expected.has(sourceId)).length / citations.length;
}

export function citationCompleteness(
  expectedSourceIds: readonly string[],
  citationSourceIds: readonly string[],
): number {
  const expected = unique(expectedSourceIds);
  if (expected.length === 0) return 1;
  const citations = new Set(citationSourceIds);
  return expected.filter((sourceId) => citations.has(sourceId)).length / expected.length;
}

function nearestRankPercentile(values: readonly number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[rank - 1];
}

function summarizeStage(values: readonly number[]): PercentileSummary {
  return {
    p50: nearestRankPercentile(values, 0.5),
    p95: nearestRankPercentile(values, 0.95),
  };
}

export function summarizeLatencies(
  latencies: readonly RagStageLatencies[],
): RagLatencySummary {
  return {
    total: summarizeStage(latencies.map(({ total }) => total)),
    retrieval: summarizeStage(latencies.map(({ retrieval }) => retrieval)),
    generation: summarizeStage(latencies.map(({ generation }) => generation)),
  };
}

export function aggregateEvaluation(
  records: readonly RagEvaluationRecord[],
): RagEvaluationAggregate {
  const acceptedRanks = records
    .map(({ retrievedSourceIds, expectedSourceIds }) =>
      firstAcceptedSourceRank(retrievedSourceIds, expectedSourceIds),
    )
    .filter((rank): rank is number => rank !== null);
  const sourceCases = records.filter(
    ({ expectedSourceIds }) => expectedSourceIds.length > 0,
  );
  const citationCases = records.filter(
    ({ expectedSourceIds, citationSourceIds }) =>
      expectedSourceIds.length > 0 || citationSourceIds.length > 0,
  );

  return {
    caseCount: records.length,
    sourceRecall: average(
      sourceCases.map(({ expectedSourceIds, retrievedSourceIds }) =>
        sourceRecall(expectedSourceIds, retrievedSourceIds),
      ),
    ),
    meanFirstAcceptedSourceRank:
      acceptedRanks.length === 0 ? null : average(acceptedRanks),
    outcomeAccuracy: outcomeAccuracy(records),
    citationPrecision: average(
      citationCases.map(({ expectedSourceIds, citationSourceIds }) =>
        citationPrecision(expectedSourceIds, citationSourceIds),
      ),
    ),
    citationCompleteness: average(
      sourceCases.map(({ expectedSourceIds, citationSourceIds }) =>
        citationCompleteness(expectedSourceIds, citationSourceIds),
      ),
    ),
    averageRetrievalAttempts: average(
      records.map(({ retrievalAttempts }) => retrievalAttempts),
    ),
    averageCandidateCount: averageOptional(records.map(({ candidateCount }) => candidateCount)),
    averageAcceptedCount: averageOptional(records.map(({ acceptedCount }) => acceptedCount)),
    rerankerUsageRate: averageOptional(
      records.map(({ rerankerUsed }) =>
        rerankerUsed === undefined ? undefined : rerankerUsed ? 1 : 0,
      ),
    ),
    hierarchyExpansionRate: averageOptional(
      records.map(({ hierarchyExpansion }) =>
        hierarchyExpansion === undefined ? undefined : hierarchyExpansion ? 1 : 0,
      ),
    ),
    averageTokenUse: averageOptional(records.map(({ tokenUse }) => tokenUse)),
    averageCost: averageOptional(records.map(({ cost }) => cost)),
    failureCount: records.filter(({ failure }) => failure !== undefined).length,
    cancellationCount: records.filter(({ cancelled }) => cancelled === true).length,
    latencyMs: summarizeLatencies(records.map(({ latencyMs }) => latencyMs)),
  };
}

export function evaluateGates(
  records: readonly RagEvaluationRecord[],
  aggregate: RagEvaluationAggregate,
  baseline: RagEvaluationBaseline,
  expectedCorpusRevision?: string,
): string[] {
  const violations: string[] = [];

  if (aggregate.outcomeAccuracy < baseline.outcomeAccuracy) {
    violations.push(
      `outcome accuracy ${aggregate.outcomeAccuracy.toFixed(3)} is below baseline ${baseline.outcomeAccuracy.toFixed(3)}`,
    );
  }
  const requiredCitationPrecision = baseline.citationPrecision ?? 1;
  if (aggregate.citationPrecision < requiredCitationPrecision) {
    violations.push(
      `citation precision ${aggregate.citationPrecision.toFixed(3)} is below required ${requiredCitationPrecision.toFixed(3)}`,
    );
  }

  if (
    baseline.sourceRecall !== undefined &&
    aggregate.sourceRecall < baseline.sourceRecall
  ) {
    violations.push(
      `source recall ${aggregate.sourceRecall.toFixed(3)} is below baseline ${baseline.sourceRecall.toFixed(3)}`,
    );
  }
  if (
    baseline.citationCompleteness !== undefined &&
    aggregate.citationCompleteness < baseline.citationCompleteness
  ) {
    violations.push(
      `citation completeness ${aggregate.citationCompleteness.toFixed(3)} is below baseline ${baseline.citationCompleteness.toFixed(3)}`,
    );
  }
  if (
    baseline.maxLatencyP95 !== undefined &&
    aggregate.latencyMs.total.p95 > baseline.maxLatencyP95
  ) {
    violations.push(
      `total latency p95 ${aggregate.latencyMs.total.p95.toFixed(3)} exceeds baseline ${baseline.maxLatencyP95.toFixed(3)}`,
    );
  }

  const supportedOutcomes = new Set<RagActualOutcome>([
    "grounded",
    "insufficient-evidence",
    "retrieval-unavailable",
    "unsupported-answer",
    "failed",
  ]);

  for (const record of records) {
    if (!supportedOutcomes.has(record.actualOutcome)) {
      violations.push(
        `case ${record.caseId} has an unsupported outcome: ${record.actualOutcome}`,
      );
    }
    if (
      expectedCorpusRevision !== undefined &&
      record.corpusRevision !== expectedCorpusRevision
    ) {
      violations.push(
        `case ${record.caseId} uses corpus revision ${record.corpusRevision} instead of ${expectedCorpusRevision}`,
      );
    }
    if (
      record.expectedOutcome === "grounded" &&
      record.expectedSourceIds.length === 0
    ) {
      violations.push(`case ${record.caseId} is missing authoritative source IDs`);
    }
    if (record.actualOutcome === "unsupported-answer") {
      violations.push(
        `case ${record.caseId} returned an answer without accepted citations`,
      );
    }
    if (record.retrievalAttempts > 2) {
      violations.push(
        `case ${record.caseId} exceeded two retrieval attempts (${record.retrievalAttempts})`,
      );
    }

    const acceptedEvidence = new Set(record.retrievedSourceIds);
    const outsideAcceptedEvidence = unique(record.citationSourceIds)
      .filter((sourceId) => !acceptedEvidence.has(sourceId))
      .sort();
    if (outsideAcceptedEvidence.length > 0) {
      violations.push(
        `case ${record.caseId} emitted citations outside accepted evidence: ${outsideAcceptedEvidence.join(", ")}`,
      );
    }

    const forbidden = new Set(record.forbiddenSourceIds);
    const emittedForbidden = unique(record.citationSourceIds)
      .filter((sourceId) => forbidden.has(sourceId))
      .sort();
    if (emittedForbidden.length > 0) {
      violations.push(
        `case ${record.caseId} emitted forbidden citations: ${emittedForbidden.join(", ")}`,
      );
    }
  }

  return violations;
}
