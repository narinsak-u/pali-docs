import "dotenv/config";

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createAiSdkAgentTurnRunner, type Retriever } from "@/lib/agent/ai-sdk-runner";
import type {
  AgentEvent,
  AgentEventSink,
  AgentTurnResult,
  AgentTurnRunner,
} from "@/lib/agent/types";
import { getModelConfig } from "@/lib/config/model";
import { getRagConfig } from "@/lib/config/rag";
import {
  aggregateEvaluation,
  assertEvaluationManifestReady,
  citationCompleteness,
  citationPrecision,
  evaluateGates,
  parseEvaluationManifest,
  sourceRecall,
  type RagEvaluationCase,
  type RagEvaluationRecord,
} from "@/lib/rag/evaluation";
import { retrieve } from "@/lib/rag/retriever";

interface RunEvaluationCaseOptions {
  evaluationCase: RagEvaluationCase;
  runner: AgentTurnRunner;
  runnerName: string;
  retrievalConfig?: string;
  corpusRevision: string;
  modelId: string;
  retrievedSourceIds(): string[];
  now?: () => number;
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function toEvaluationOutcome(
  result: AgentTurnResult,
  citationSourceIds: readonly string[],
  retrievedSourceIds: readonly string[],
): RagEvaluationRecord["actualOutcome"] {
  if (result.outcome !== "answered") return result.outcome;
  const acceptedEvidence = new Set(retrievedSourceIds);
  return citationSourceIds.length > 0 &&
    citationSourceIds.every((sourceId) => acceptedEvidence.has(sourceId))
    ? "grounded"
    : "unsupported-answer";
}

export async function runEvaluationCase({
  evaluationCase,
  runner,
  runnerName,
  retrievalConfig = runnerName,
  corpusRevision,
  modelId,
  retrievedSourceIds,
  now = performance.now.bind(performance),
}: RunEvaluationCaseOptions): Promise<RagEvaluationRecord> {
  const startedAt = now();
  const retrievalStartedAt = new Map<number, number>();
  let retrievalAttempts = 0;
  let retrievalLatency = 0;
  let generationStartedAt: number | null = null;
  let candidateCount: number | undefined;
  let acceptedCount: number | undefined;
  let hierarchyExpansion: boolean | undefined;
  let rerankerUsed: boolean | undefined;
  let failure: string | undefined;

  const sink: AgentEventSink = {
    emit(event: AgentEvent): void {
      if (event.type === "retrieval.started") {
        retrievalAttempts = Math.max(retrievalAttempts, event.attempt);
        retrievalStartedAt.set(event.attempt, now());
        return;
      }
      if (event.type === "retrieval.completed") {
        const attemptStartedAt = retrievalStartedAt.get(event.attempt);
        if (attemptStartedAt !== undefined) {
          retrievalLatency += now() - attemptStartedAt;
          retrievalStartedAt.delete(event.attempt);
        }
        candidateCount = event.candidateCount ?? event.matchCount;
        acceptedCount = event.acceptedCount ?? event.acceptedSourceIds?.length;
        hierarchyExpansion = event.hierarchyExpansion;
        rerankerUsed = event.rerankerUsed;
        return;
      }
      if (event.type === "retrieval.failed" || event.type === "run.failed") {
        failure = event.code;
        return;
      }
      if (event.type === "generation.started") {
        generationStartedAt = now();
      }
    },
  };

  const result = await runner.runTurn(
    {
      runId: `rag-eval-${evaluationCase.id}-${randomUUID()}`,
      messages: [
        {
          id: `rag-eval-question-${evaluationCase.id}`,
          role: "user",
          parts: [{ type: "text", text: evaluationCase.question }],
        },
      ],
    },
    sink,
  );
  const completedAt = now();
  for (const attemptStartedAt of retrievalStartedAt.values()) {
    retrievalLatency += completedAt - attemptStartedAt;
  }
  const citationSourceIds =
    result.outcome === "answered"
      ? result.citations.map(({ source }) => source)
      : [];
  const observedSourceIds = retrievedSourceIds();

  const actualOutcome = toEvaluationOutcome(
    result,
    citationSourceIds,
    observedSourceIds,
  );
  const failureCode =
    failure ?? ("code" in result ? result.code : undefined);
  return {
    caseId: evaluationCase.id,
    category: evaluationCase.category,
    language: evaluationCase.language,
    runner: runnerName,
    retrievalConfig,
    corpusRevision,
    modelId,
    expectedOutcome: evaluationCase.expectedOutcome,
    actualOutcome,
    expectedSourceIds: [...evaluationCase.expectedSourceIds],
    forbiddenSourceIds: [...(evaluationCase.forbiddenSourceIds ?? [])],
    retrievedSourceIds: observedSourceIds,
    citationSourceIds,
    retrievalAttempts,
    latencyMs: {
      total: roundMilliseconds(completedAt - startedAt),
      retrieval: roundMilliseconds(retrievalLatency),
      generation: roundMilliseconds(
        generationStartedAt === null ? 0 : completedAt - generationStartedAt,
      ),
    },
    ...(candidateCount === undefined ? {} : { candidateCount }),
    ...(acceptedCount === undefined ? {} : { acceptedCount }),
    ...(hierarchyExpansion === undefined ? {} : { hierarchyExpansion }),
    ...(rerankerUsed === undefined ? {} : { rerankerUsed }),
    sourceRecall: sourceRecall(
      evaluationCase.expectedSourceIds,
      observedSourceIds,
    ),
    citationPrecision: citationPrecision(
      evaluationCase.expectedSourceIds,
      citationSourceIds,
    ),
    citationCompleteness: citationCompleteness(
      evaluationCase.expectedSourceIds,
      citationSourceIds,
    ),
    ...(failureCode === undefined ? {} : { failure: failureCode }),
    ...(failureCode === "aborted" || failureCode === "cancelled"
      ? { cancelled: true }
      : {}),
  };
}

function configuredModelId(): string {
  const config = getModelConfig();
  return config.PROVIDER_NAME === "opencode"
    ? config.OPENCODE_LLM_MODEL
    : config.OPENROUTER_LLM_MODEL;
}

export async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const manifestPath = resolve(projectRoot, "data/rag-eval-cases.json");
  const manifest = parseEvaluationManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  assertEvaluationManifestReady(manifest);

  const ragConfig = getRagConfig();
  if (ragConfig.PINECONE_CORPUS_REVISION !== manifest.corpusRevision) {
    throw new Error(
      `RAG evaluation corpus revision mismatch: manifest=${manifest.corpusRevision}, environment=${ragConfig.PINECONE_CORPUS_REVISION}`,
    );
  }

  const runnerName = process.env.RAG_EVAL_RUNNER ?? "ai-sdk";
  if (runnerName !== "ai-sdk") {
    throw new Error(`Unsupported RAG evaluation runner: ${runnerName}`);
  }

  const modelId = configuredModelId();
  let activeRetrievedSourceIds: string[] = [];
  const observedRetriever: Retriever = {
    async retrieve(request, signal) {
      const bundle = await retrieve(request, signal);
      if (bundle.status === "grounded") {
        for (const passage of bundle.passages) {
          if (!activeRetrievedSourceIds.includes(passage.source)) {
            activeRetrievedSourceIds.push(passage.source);
          }
        }
      }
      return bundle;
    },
  };
  const runner = createAiSdkAgentTurnRunner({ retriever: observedRetriever });

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const outputDirectory = resolve(
    projectRoot,
    process.env.RAG_EVAL_OUTPUT_DIR ?? "results/rag-evaluation",
  );
  await mkdir(outputDirectory, { recursive: true });
  const resultFile = resolve(outputDirectory, `${timestamp}.jsonl`);
  const file = await open(resultFile, "wx");
  const records: RagEvaluationRecord[] = [];

  try {
    for (const evaluationCase of manifest.cases) {
      activeRetrievedSourceIds = [];
      const record = await runEvaluationCase({
        evaluationCase,
        runner,
        runnerName,
        corpusRevision: manifest.corpusRevision,
        modelId,
        retrievedSourceIds: () => [...activeRetrievedSourceIds],
      });
      records.push(record);
      await file.write(`${JSON.stringify(record)}\n`);
    }
  } finally {
    await file.close();
  }

  const aggregate = aggregateEvaluation(records);
  const violations = evaluateGates(
    records,
    aggregate,
    manifest.baseline,
    manifest.corpusRevision,
  );
  console.log(
    JSON.stringify(
      {
        timestamp,
        runner: runnerName,
        corpusRevision: manifest.corpusRevision,
        modelId,
        resultFile,
        aggregate,
        violations,
      },
      null,
      2,
    ),
  );

  if (violations.length > 0) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "RAG evaluation failed");
    process.exitCode = 1;
  });
}
