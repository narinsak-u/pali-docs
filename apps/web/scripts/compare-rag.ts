import "dotenv/config";
import { mkdir, open, readFile } from "node:fs/promises";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createAiSdkAgentTurnRunner, type Retriever } from "@/lib/agent/ai-sdk-runner";
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
import type { Citation } from "@/lib/rag/types";
import type { SafeQuestionRequest } from "@/lib/schemas/question-request";
import { runEvaluationCase } from "@/scripts/evaluate-rag";

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

function messageContent(message: SafeQuestionRequest["messages"][number]): string {
  return message.parts.map(({ text }) => text).join("");
}

export function createFastApiRunner(options: {
  baseUrl: string;
  internalToken: string;
  corpusRevision: string;
  fetchImpl?: typeof fetch;
}): FastApiRunner {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
  const internalToken = options.internalToken.trim();
  const corpusRevision = options.corpusRevision.trim();
  if (!baseUrl) throw new Error("FastAPI base URL is required");
  if (!internalToken) throw new Error("FastAPI internal token is required");
  if (!corpusRevision) throw new Error("FastAPI corpus revision is required");

  let retrievedSourceIds: string[] = [];

  const runner: FastApiRunner = {
    getRetrievedSourceIds: () => [...retrievedSourceIds],
    async runTurn(
      input: AgentTurnInput,
      sink: AgentEventSink,
      signal?: AbortSignal,
    ): Promise<AgentTurnResult> {
      retrievedSourceIds = [];
      const requestSignal = signal ?? new AbortController().signal;
      const fetchImpl = options.fetchImpl ?? fetch;
      const response = await fetchImpl(`${baseUrl}/v1/question`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${internalToken}`,
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
  return createAiSdkAgentTurnRunner({ retriever: observedRetriever });
}

export async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const manifestPath = resolve(projectRoot, "data/rag-eval-cases.json");
  const manifest = assertComparisonReady(
    JSON.parse(await readFile(manifestPath, "utf8")),
    process.env.PINECONE_CORPUS_REVISION,
  );
  const baseUrl = process.env.FASTAPI_BASE_URL?.trim();
  const internalToken = process.env.FASTAPI_INTERNAL_TOKEN?.trim();
  if (!baseUrl || !internalToken) {
    throw new Error(
      "RAG comparison requires FASTAPI_BASE_URL and FASTAPI_INTERNAL_TOKEN",
    );
  }

  const modelId = configuredModelId();
  let aiSdkRetrievedSourceIds: string[] = [];
  const aiSdkRunner = createObservedAiSdkRunner((sourceIds) => {
    for (const sourceId of sourceIds) {
      if (!aiSdkRetrievedSourceIds.includes(sourceId)) {
        aiSdkRetrievedSourceIds.push(sourceId);
      }
    }
  });
  const langGraphRunner = createFastApiRunner({
    baseUrl,
    internalToken,
    corpusRevision: manifest.corpusRevision,
  });
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const outputDirectory = resolve(
    projectRoot,
    process.env.RAG_COMPARE_OUTPUT_DIR ?? "results/rag-comparison",
  );
  await mkdir(outputDirectory, { recursive: true });
  const resultFile = resolve(outputDirectory, `${timestamp}.jsonl`);
  const file = await open(resultFile, "wx");
  const comparisons: ComparisonRecord[] = [];

  const baselineRetrievalConfig =
    process.env.RAG_BASELINE_RETRIEVAL_CONFIG?.trim() || "dense-baseline";
  const candidateRetrievalConfig =
    process.env.RAG_CANDIDATE_RETRIEVAL_CONFIG?.trim() || "retrieval-quality";

  try {
    for (const evaluationCase of manifest.cases) {
      aiSdkRetrievedSourceIds = [];
      const aiSdk = await runEvaluationCase({
        evaluationCase,
        runner: aiSdkRunner,
        runnerName: "ai-sdk",
        retrievalConfig: baselineRetrievalConfig,
        corpusRevision: manifest.corpusRevision,
        modelId,
        retrievedSourceIds: () => [...aiSdkRetrievedSourceIds],
      });
      const langGraph = await runEvaluationCase({
        evaluationCase,
        runner: langGraphRunner,
        runnerName: "langgraph",
        retrievalConfig: candidateRetrievalConfig,
        corpusRevision: manifest.corpusRevision,
        modelId: "langgraph",
        retrievedSourceIds: () => langGraphRunner.getRetrievedSourceIds(),
      });
      const comparison = compareRecords(aiSdk, langGraph);
      comparisons.push(comparison);
      await file.write(`${JSON.stringify(comparison)}\n`);
    }
  } finally {
    await file.close();
  }

  const aiSdkRecords = comparisons.map(({ aiSdk }) => aiSdk);
  const langGraphRecords = comparisons.map(({ langGraph }) => langGraph);
  const aiSdkAggregate = aggregateEvaluation(aiSdkRecords);
  const langGraphAggregate = aggregateEvaluation(langGraphRecords);
  const pairedComparison = createComparisonSummary(
    {
      runner: "ai-sdk",
      retrievalConfig: baselineRetrievalConfig,
      aggregate: aiSdkAggregate,
    },
    {
      runner: "langgraph",
      retrievalConfig: candidateRetrievalConfig,
      aggregate: langGraphAggregate,
    },
  );
  const violations = {
    "ai-sdk": evaluateGates(
      aiSdkRecords,
      aiSdkAggregate,
      manifest.baseline,
      manifest.corpusRevision,
    ),
    langgraph: evaluateGates(
      langGraphRecords,
      langGraphAggregate,
      manifest.baseline,
      manifest.corpusRevision,
    ),
  };

  console.log(
    JSON.stringify(
      {
        timestamp,
        corpusRevision: manifest.corpusRevision,
        resultFile,
        aggregates: {
          "ai-sdk": aiSdkAggregate,
          langgraph: langGraphAggregate,
        },
        retrievalConfigurations: {
          [baselineRetrievalConfig]: aiSdkAggregate,
          [candidateRetrievalConfig]: langGraphAggregate,
        },
        aggregateDeltas: pairedComparison.deltas,
        pairedComparison,
        violations,
      },
      null,
      2,
    ),
  );
  if (violations["ai-sdk"].length > 0 || violations.langgraph.length > 0) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "RAG comparison failed");
    process.exitCode = 1;
  });
}
