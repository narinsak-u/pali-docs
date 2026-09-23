export type RagBackend = "ai-sdk" | "langgraph";

export interface RolloutConfig {
  backend: RagBackend;
  trafficPercent: number;
  rolloutEnabled?: boolean;
}

function parseTrafficPercent(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 0;

  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0 && parsed <= 100
    ? parsed
    : 0;
}

export function getRolloutConfig(env: NodeJS.ProcessEnv = process.env): RolloutConfig {
  const explicitBackend = env.RAG_BACKEND;
  const backend = explicitBackend === "langgraph" ? "langgraph" : "ai-sdk";

  return {
    backend,
    trafficPercent: parseTrafficPercent(env.RAG_LANGGRAPH_TRAFFIC_PERCENT),
    rolloutEnabled: explicitBackend !== "ai-sdk",
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
  if (config.rolloutEnabled !== true) return "ai-sdk";
  if (config.trafficPercent <= 0) return "ai-sdk";
  if (config.trafficPercent >= 100) return "langgraph";

  return hashRunId(runId) % 100 < config.trafficPercent ? "langgraph" : "ai-sdk";
}
