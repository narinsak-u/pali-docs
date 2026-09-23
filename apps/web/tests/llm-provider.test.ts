import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => {
  const model = { specificationVersion: "v2", modelId: "configured-model" };
  const provider = vi.fn(() => model);
  const createOpenAICompatible = vi.fn(() => provider);
  return { createOpenAICompatible, model, provider };
});

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: providerMocks.createOpenAICompatible,
}));

import { getModelConfig } from "@/lib/config/model";
import { getConfiguredModel } from "@/lib/services/llm-provider";

const MODEL_ENV_NAMES = [
  "PROVIDER_NAME",
  "OPENROUTER_API_KEY",
  "OPENROUTER_LLM_MODEL",
  "OPENCODE_API_KEY",
  "OPENCODE_LLM_MODEL",
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of MODEL_ENV_NAMES) vi.stubEnv(name, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validated LLM provider configuration", () => {
  it("configures OpenRouter from its required environment values", () => {
    vi.stubEnv("PROVIDER_NAME", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
    vi.stubEnv("OPENROUTER_LLM_MODEL", "openrouter/model");

    const configured = getConfiguredModel();

    expect(getModelConfig()).toEqual({
      PROVIDER_NAME: "openrouter",
      OPENROUTER_API_KEY: "openrouter-key",
      OPENROUTER_LLM_MODEL: "openrouter/model",
    });
    expect(providerMocks.createOpenAICompatible).toHaveBeenCalledWith({
      name: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: "openrouter-key",
    });
    expect(providerMocks.provider).toHaveBeenCalledWith("openrouter/model");
    expect(configured).toEqual({
      model: providerMocks.model,
      providerName: "openrouter",
      modelId: "openrouter/model",
    });
  });

  it("configures OpenCode from its required environment values", () => {
    vi.stubEnv("PROVIDER_NAME", "opencode");
    vi.stubEnv("OPENCODE_API_KEY", "opencode-key");
    vi.stubEnv("OPENCODE_LLM_MODEL", "deepseek-v4-flash");

    const configured = getConfiguredModel();

    expect(getModelConfig()).toEqual({
      PROVIDER_NAME: "opencode",
      OPENCODE_API_KEY: "opencode-key",
      OPENCODE_LLM_MODEL: "deepseek-v4-flash",
    });
    expect(providerMocks.createOpenAICompatible).toHaveBeenCalledWith({
      name: "opencode",
      baseURL: "https://opencode.ai/zen/go/v1",
      apiKey: "opencode-key",
    });
    expect(providerMocks.provider).toHaveBeenCalledWith("deepseek-v4-flash");
    expect(configured).toEqual({
      model: providerMocks.model,
      providerName: "opencode",
      modelId: "deepseek-v4-flash",
    });
  });

  it("rejects an unknown provider before provider construction", () => {
    vi.stubEnv("PROVIDER_NAME", "unknown");
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
    vi.stubEnv("OPENROUTER_LLM_MODEL", "openrouter/model");

    expect(() => getConfiguredModel()).toThrow();
    expect(providerMocks.createOpenAICompatible).not.toHaveBeenCalled();
  });

  it.each([
    ["openrouter", "OPENROUTER_API_KEY", "", "OPENROUTER_LLM_MODEL", "model"],
    ["openrouter", "OPENROUTER_API_KEY", "key", "OPENROUTER_LLM_MODEL", ""],
    ["opencode", "OPENCODE_API_KEY", "", "OPENCODE_LLM_MODEL", "model"],
    ["opencode", "OPENCODE_API_KEY", "key", "OPENCODE_LLM_MODEL", ""],
  ] as const)(
    "rejects %s when a provider-specific value is missing",
    (providerName, keyName, key, modelName, model) => {
      vi.stubEnv("PROVIDER_NAME", providerName);
      vi.stubEnv(keyName, key);
      vi.stubEnv(modelName, model);

      expect(() => getConfiguredModel()).toThrow();
      expect(providerMocks.createOpenAICompatible).not.toHaveBeenCalled();
    },
  );
});
