import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { getModelConfig } from "@/lib/config/model";

export interface ConfiguredModel {
  model: LanguageModel;
  providerName: "openrouter" | "opencode";
  modelId: string;
}

export function getConfiguredModel(): ConfiguredModel {
  const config = getModelConfig();

  if (config.PROVIDER_NAME === "opencode") {
    const provider = createOpenAICompatible({
      name: "opencode",
      baseURL: "https://opencode.ai/zen/go/v1",
      apiKey: config.OPENCODE_API_KEY,
    });
    return {
      model: provider(config.OPENCODE_LLM_MODEL),
      providerName: "opencode",
      modelId: config.OPENCODE_LLM_MODEL,
    };
  }

  const provider = createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: config.OPENROUTER_API_KEY,
  });
  return {
    model: provider(config.OPENROUTER_LLM_MODEL),
    providerName: "openrouter",
    modelId: config.OPENROUTER_LLM_MODEL,
  };
}
