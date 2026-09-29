import "dotenv/config";
import { mkdir, open, readFile } from "node:fs/promises";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createAiSdkAgentTurnRunner, type Retriever } from "@/lib/agent/ai-sdk-runner";
import { createPrincipalToken } from "@/lib/config/canary-context";
import type {
  AgentEvent,
  AgentEventSink,
  AgentTurnInput,
  AgentTurnResult,
  AgentTurnRunner,
} from "@/lib/agent/types";
import { consumeLangGraphSse } from "@/lib/agent/langgraph-event-adapter";
import { getConfiguredModel } from "@/lib/services/llm-provider";
import { retrieve } from "@/lib/rag/retriever";
import {
  aggregateEvaluation,
  assertEvaluationManifestReady,
  citationCompleteness,
  citationPrecision,
  evaluateGates,
  parseEvaluationManifest,
  type RagEvaluationAggregate,
  type RagEvaluationRecord,
  type ReadyRagEvaluationManifest,
} from "@/lib/rag/evaluation";
import { z } from "zod";
import type { SafeQuestionRequest } from "@/lib/schemas/question-request";
import {
  assertReviewedCasesArtifactReady,
  compareProviderEvaluations,
  decidePromotion,
  parseProductionBaselineArtifact,
  type PairedEvaluation,
  runPairedEvaluationCase,
  type ServingMetadata,
} from "@/lib/rag/provider-evaluation";
import type { Citation } from "@/lib/rag/types";

export interface ComparisonRecord {
  caseId: string;
  aiSdk: RagEvaluationRecord;
  langGraph: RagEvaluationRecord;
  deltas: {
    candidateCount: number | null;
    acceptedCount: number | null;
    sourceRecall: number;
    latencyMs: number;
    outcomeChanged: boolean;
    citationPrecision: number;
    citationCompleteness: number;
    tokenUse: number | null;
    cost: number | null;
  };
}

function optionalDelta(
  candidate: number | undefined,
  baseline: number | undefined,
): number | null {
  return candidate === undefined || baseline === undefined
    ? null
    : candidate - baseline;
}

function nullableDelta(
  candidate: number | null,
  baseline: number | null,
): number | null {
  return candidate === null || baseline === null ? null : candidate - baseline;
}

export interface AggregateComparison {
  candidateCount: number | null;
  acceptedCount: number | null;
  sourceRecall: number;
  citationPrecision: number;
  citationCompleteness: number;
  latencyMs: number;
  tokenUse: number | null;
  cost: number | null;
}

export function compareAggregates(
  baseline: RagEvaluationAggregate,
  candidate: RagEvaluationAggregate,
): AggregateComparison {
  return {
    candidateCount: nullableDelta(
      candidate.averageCandidateCount,
      baseline.averageCandidateCount,
    ),
    acceptedCount: nullableDelta(
      candidate.averageAcceptedCount,
      baseline.averageAcceptedCount,
    ),
    sourceRecall: candidate.sourceRecall - baseline.sourceRecall,
    citationPrecision: candidate.citationPrecision - baseline.citationPrecision,
    citationCompleteness:
      candidate.citationCompleteness - baseline.citationCompleteness,
    latencyMs:
      candidate.latencyMs.total.p95 - baseline.latencyMs.total.p95,
    tokenUse: nullableDelta(candidate.averageTokenUse, baseline.averageTokenUse),
    cost: nullableDelta(candidate.averageCost, baseline.averageCost),
  };
}
export interface ComparisonAggregateSnapshot {
  runner: string;
  retrievalConfig: string;
  aggregate: RagEvaluationAggregate;
}

export interface ComparisonSummary {
  baseline: ComparisonAggregateSnapshot;
  candidate: ComparisonAggregateSnapshot;
  deltas: AggregateComparison;
}

export function createComparisonSummary(
  baseline: ComparisonAggregateSnapshot,
  candidate: ComparisonAggregateSnapshot,
): ComparisonSummary {
  return {
    baseline,
    candidate,
    deltas: compareAggregates(baseline.aggregate, candidate.aggregate),
  };
}

export function compareRecords(
  aiSdk: RagEvaluationRecord,
  langGraph: RagEvaluationRecord,
): ComparisonRecord {
  return {
    caseId: aiSdk.caseId,
    aiSdk,
    langGraph,
    deltas: {
      candidateCount: optionalDelta(
        langGraph.candidateCount,
        aiSdk.candidateCount,
      ),
      acceptedCount: optionalDelta(
        langGraph.acceptedCount,
        aiSdk.acceptedCount,
      ),
      sourceRecall: langGraph.sourceRecall - aiSdk.sourceRecall,
      latencyMs: langGraph.latencyMs.total - aiSdk.latencyMs.total,
      outcomeChanged: aiSdk.actualOutcome !== langGraph.actualOutcome,
      citationPrecision:
        citationPrecision(
          langGraph.expectedSourceIds,
          langGraph.citationSourceIds,
        ) -
        citationPrecision(aiSdk.expectedSourceIds, aiSdk.citationSourceIds),
      citationCompleteness:
        citationCompleteness(
          langGraph.expectedSourceIds,
          langGraph.citationSourceIds,
        ) -
        citationCompleteness(aiSdk.expectedSourceIds, aiSdk.citationSourceIds),
      tokenUse: optionalDelta(langGraph.tokenUse, aiSdk.tokenUse),
      cost: optionalDelta(langGraph.cost, aiSdk.cost),
    },
  };
}

export function assertComparisonReady(
  manifest: unknown,
  configuredRevision: string | undefined,
): ReadyRagEvaluationManifest {
  const parsedManifest = parseEvaluationManifest(manifest);
  assertEvaluationManifestReady(parsedManifest);

  const revision = configuredRevision?.trim();
  if (!revision) {
    throw new Error(
      "RAG comparison requires PINECONE_CORPUS_REVISION to be configured",
    );
  }
  if (revision !== parsedManifest.corpusRevision) {
    throw new Error(
      `RAG comparison corpus revision mismatch: manifest=${parsedManifest.corpusRevision}, environment=${revision}`,
    );
  }
  return parsedManifest;
}

type FastApiRunner = AgentTurnRunner & {
  getRetrievedSourceIds(): string[];
};

type ObservedServingMetadata = NonNullable<AgentTurnRunner["observedServingMetadata"]>;
const fastApiReadyIdentitySchema = z
  .object({
    status: z.literal("ready"),
    service: z.literal("api"),
    model: z.string().trim().min(1),
    servingRevision: z.string().trim().min(1),
    imageDigest: z.string().trim().min(1),
    tokenizer: z.string().trim().min(1),
    tokenizerRevision: z.string().trim().min(1),
    parser: z.string().trim().min(1),
    chatTemplate: z.string().trim().min(1),
    precision: z.string().trim().min(1),
    servingLimits: z
      .object({
        maxModelLen: z.number().finite().nonnegative(),
        maxNumSeqs: z.number().finite().nonnegative(),
        maxNumBatchedTokens: z.number().finite().nonnegative(),
        gpuMemoryUtilization: z.number().finite().nonnegative(),
        maxOutputTokens: z.number().finite().nonnegative(),
      })
      .strict(),
  })
  .strict();

async function fetchFastApiServingMetadata(
  baseUrl: string,
  internalToken: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<ObservedServingMetadata> {
  const response = await fetchImpl(`${baseUrl}/internal/readyz`, {
    headers: { Authorization: `Bearer ${internalToken}` },
    signal,
  });
  if (!response.ok) {
    throw new Error(`FastAPI readiness failed with status ${response.status}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("FastAPI readiness response was not JSON");
  }
  const identity = fastApiReadyIdentitySchema.safeParse(payload);
  if (!identity.success) {
    throw new Error("FastAPI readiness identity is incomplete");
  }
  return {
    model: identity.data.model,
    servingRevision: identity.data.servingRevision,
    imageDigest: identity.data.imageDigest,
    tokenizer: identity.data.tokenizer,
    tokenizerRevision: identity.data.tokenizerRevision,
    parser: identity.data.parser,
    chatTemplate: identity.data.chatTemplate,
    precision: identity.data.precision,
    servingLimits: identity.data.servingLimits,
  };
}
function messageContent(message: SafeQuestionRequest["messages"][number]): string {
  return message.parts.map(({ text }) => text).join("");
}

export function createFastApiRunner(options: {
  baseUrl: string;
  internalToken: string;
  identitySecret: string;
  corpusRevision: string;
  fetchImpl?: typeof fetch;
}): FastApiRunner {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
  const internalToken = options.internalToken.trim();
  const identitySecret = options.identitySecret.trim();
  const corpusRevision = options.corpusRevision.trim();
  if (!baseUrl) throw new Error("FastAPI base URL is required");
  if (!internalToken) throw new Error("FastAPI internal token is required");
  if (!identitySecret) throw new Error("FastAPI identity secret is required");
  if (!corpusRevision) throw new Error("FastAPI corpus revision is required");
  let retrievedSourceIds: string[] = [];
  let observedCorpusRevision: string | undefined;
  let observedServingMetadata: ObservedServingMetadata | undefined;

  const runner: FastApiRunner = {
    supportsAccessScope: true,
    get observedCorpusRevision() {
      return observedCorpusRevision;
    },
    get observedServingMetadata() {
      return observedServingMetadata;
    },
    getRetrievedSourceIds: () => [...retrievedSourceIds],
    async runTurn(
      input: AgentTurnInput,
      sink: AgentEventSink,
      signal?: AbortSignal,
    ): Promise<AgentTurnResult> {
      retrievedSourceIds = [];
      observedCorpusRevision = undefined;
      observedServingMetadata = undefined;
      const requestSignal = signal ?? new AbortController().signal;
      const fetchImpl = options.fetchImpl ?? fetch;
      observedServingMetadata = await fetchFastApiServingMetadata(
        baseUrl,
        internalToken,
        fetchImpl,
        requestSignal,
      );

      const principal =
        input.accessScope === undefined
          ? undefined
          : createPrincipalToken(input.accessScope, identitySecret);
      const response = await fetchImpl(`${baseUrl}/v1/question`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${internalToken}`,
          ...(principal === undefined ? {} : { "X-Principal": principal }),
        },
        body: JSON.stringify({
          runId: input.runId,
          corpusRevision,
          messages: input.messages.map((message) => ({
            role: message.role,
            content: messageContent(message),
          })),
        }),
        signal: requestSignal,
      });

      if (!response.ok) {
        throw new Error(`FastAPI question request failed with status ${response.status}`);
      }
      if (
        !response.headers
          .get("content-type")
          ?.toLowerCase()
          .startsWith("text/event-stream")
      ) {
        throw new Error("FastAPI question response was not an SSE stream");
      }

      let answer: string | undefined;
      let citations: Citation[] = [];
      let suggestions: string[] = [];
      let terminalResult: AgentTurnResult | undefined;
      const eventSink: AgentEventSink = {
        emit(event: AgentEvent): void {
          sink.emit(event);
          if (event.type === "answer.completed") answer = event.text;
          if (event.type === "retrieval.completed") {
            if (
              event.corpusRevision !== undefined &&
              observedCorpusRevision !== undefined &&
              event.corpusRevision !== observedCorpusRevision
            ) {
              observedCorpusRevision = "__conflicting_runtime_revision__";
            } else if (event.corpusRevision !== undefined) {
              observedCorpusRevision = event.corpusRevision;
            }
            for (const sourceId of event.acceptedSourceIds ?? []) {
              if (!retrievedSourceIds.includes(sourceId)) {
                retrievedSourceIds.push(sourceId);
              }
            }
          }
          if (event.type === "citations.completed") {
            citations = event.citations;
          }
          if (event.type === "suggestions.completed") {
            suggestions = event.suggestions;
          }
          if (event.type === "run.failed") {
            terminalResult ??= { outcome: "failed", code: event.code };
          }
          if (event.type === "run.completed") {
            if (event.outcome === "answered") {
              if (answer === undefined) {
                throw new Error("FastAPI stream completed without an answer");
              }
              terminalResult ??= { outcome: "answered", answer, citations, suggestions };
            } else {
              terminalResult ??= { outcome: event.outcome };
            }
          }
        },
      };

      await consumeLangGraphSse(
        response,
        eventSink,
        requestSignal,
        input.runId,
      );
      if (!terminalResult) {
        throw new Error("FastAPI stream ended without a terminal result");
      }
      return terminalResult;
    },
  };

  return runner;
}

function configuredModelId(): string {
  return getConfiguredModel().modelId;
}

function createObservedAiSdkRunner(
  onRetrieved: (sourceIds: readonly string[]) => void,
  observedServingMetadata?: ServingMetadata,
): AgentTurnRunner {
  const observedRetriever: Retriever = {
    async retrieve(request, signal) {
      const bundle = await retrieve(request, signal);
      if (bundle.status === "grounded") {
        onRetrieved(bundle.passages.map(({ source }) => source));
      }
      return bundle;
    },
  };
  const runner = createAiSdkAgentTurnRunner({ retriever: observedRetriever });
  return observedServingMetadata === undefined
    ? runner
    : { ...runner, observedServingMetadata };
}

export async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const configuredRevision = process.env.PINECONE_CORPUS_REVISION?.trim();
  const reviewedCasesPath = process.env.RAG_REVIEWED_CASES_PATH?.trim();
  const baselinePath = process.env.RAG_PRODUCTION_BASELINE_PATH?.trim();
  if (!configuredRevision || !reviewedCasesPath || !baselinePath) {
    throw new Error(
      "RAG comparison requires PINECONE_CORPUS_REVISION, RAG_REVIEWED_CASES_PATH, and RAG_PRODUCTION_BASELINE_PATH",
    );
  }
  const reviewedCases = assertReviewedCasesArtifactReady(
    JSON.parse(await readFile(resolve(projectRoot, reviewedCasesPath), "utf8")),
  );
  const productionBaseline = parseProductionBaselineArtifact(
    JSON.parse(await readFile(resolve(projectRoot, baselinePath), "utf8")),
  );
  if (
    configuredRevision !== reviewedCases.corpusRevision ||
    configuredRevision !== productionBaseline.corpusRevision
  ) {
    throw new Error("RAG comparison corpus revision does not match authoritative artifacts");
  }

  const baseUrl = process.env.FASTAPI_BASE_URL?.trim();
  const internalToken = process.env.FASTAPI_INTERNAL_TOKEN?.trim();
  const identitySecret = process.env.FASTAPI_IDENTITY_SECRET?.trim();
  const hostedServingRevision = process.env.HOSTED_SERVING_REVISION?.trim();
  if (!baseUrl || !internalToken || !identitySecret || !hostedServingRevision) {
    throw new Error(
      "RAG comparison requires FASTAPI_BASE_URL, FASTAPI_INTERNAL_TOKEN, FASTAPI_IDENTITY_SECRET, and HOSTED_SERVING_REVISION",
    );
  }
  if (
    !process.env.RAG_PROMOTION_ATTESTATION_SECRET?.trim() ||
    !process.env.RAG_BASELINE_ATTESTATION_SECRET?.trim()
  ) {
    throw new Error(
      "RAG comparison requires RAG_PROMOTION_ATTESTATION_SECRET and RAG_BASELINE_ATTESTATION_SECRET",
    );
  }

  const localRunner = createFastApiRunner({
    baseUrl,
    internalToken,
    identitySecret,
    corpusRevision: configuredRevision,
  });
  const localMetadata = await fetchFastApiServingMetadata(
    baseUrl,
    internalToken,
    fetch,
    new AbortController().signal,
  );
  const hostedMetadata: ServingMetadata = {
    model: configuredModelId(),
    servingRevision: hostedServingRevision,
    ...(process.env.HOSTED_IMAGE_DIGEST?.trim()
      ? { imageDigest: process.env.HOSTED_IMAGE_DIGEST.trim() }
      : {}),
    ...(process.env.HOSTED_TOKENIZER?.trim()
      ? { tokenizer: process.env.HOSTED_TOKENIZER.trim() }
      : {}),
  };
  const hostedRunner = createObservedAiSdkRunner(() => {}, hostedMetadata);
  const paired: PairedEvaluation[] = [];
  for (const evaluationCase of reviewedCases.cases) {
    paired.push(
      await runPairedEvaluationCase({
        evaluationCase,
        hosted: hostedRunner,
        local: localRunner,
        hostedMetadata,
        localMetadata,
        corpusRevision: configuredRevision,
      }),
    );
  }
  const comparison = compareProviderEvaluations(
    paired,
    productionBaseline.thresholds,
  );
  const decision = decidePromotion({
    comparison,
    reviewedCases,
    productionBaseline,
    rollbackReady: process.env.RAG_HOSTED_ROLLBACK_READY === "true",
  });
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const outputDirectory = resolve(
    projectRoot,
    process.env.RAG_COMPARE_OUTPUT_DIR ?? "results/rag-comparison",
  );
  await mkdir(outputDirectory, { recursive: true });
  const resultFile = resolve(outputDirectory, `${timestamp}.json`);
  const file = await open(resultFile, "wx");
  try {
    await file.write(
      JSON.stringify(
        {
          schemaVersion: "v1",
          timestamp,
          corpusRevision: configuredRevision,
          paired,
          comparison,
          decision,
        },
        null,
        2,
      ),
    );
  } finally {
    await file.close();
  }
  console.log(JSON.stringify({ resultFile, comparison, decision }, null, 2));
  if (!decision.promote) process.exitCode = 1;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "RAG comparison failed");
    process.exitCode = 1;
  });
}
