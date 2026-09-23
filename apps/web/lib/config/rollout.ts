export type RagBackend = "ai-sdk" | "langgraph";

export interface RolloutConfig {
  backend: RagBackend;
  trafficPercent: number;
}

function parseTrafficPercent(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 0;

  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0 && parsed <= 100
    ? parsed
    : 0;
}

export function getRolloutConfig(env: NodeJS.ProcessEnv = process.env): RolloutConfig {
  const backend = env.RAG_BACKEND === "langgraph" ? "langgraph" : "ai-sdk";

  return {
    backend,
    trafficPercent: parseTrafficPercent(env.RAG_LANGGRAPH_TRAFFIC_PERCENT),
  };
}

function hashRunId(runId: string): number {
  let hash = 2166136261;

  for (let index = 0; index < runId.length; index += 1) {
    hash ^= runId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function selectRagBackend(runId: string, config: RolloutConfig): RagBackend {
  if (config.backend === "langgraph") return "langgraph";
  if (config.trafficPercent <= 0) return "ai-sdk";
  if (config.trafficPercent >= 100) return "langgraph";

  return hashRunId(runId) % 100 < config.trafficPercent ? "langgraph" : "ai-sdk";
}
