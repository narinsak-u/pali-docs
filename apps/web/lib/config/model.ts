import { z } from "zod";

const modelEnvSchema = z.discriminatedUnion("PROVIDER_NAME", [
  z.object({
    PROVIDER_NAME: z.literal("openrouter"),
    OPENROUTER_API_KEY: z.string().min(1),
    OPENROUTER_LLM_MODEL: z.string().min(1),
  }),
  z.object({
    PROVIDER_NAME: z.literal("opencode"),
    OPENCODE_API_KEY: z.string().min(1),
    OPENCODE_LLM_MODEL: z.string().min(1),
  }),
]);

export type ModelConfig = z.infer<typeof modelEnvSchema>;

export function getModelConfig(): ModelConfig {
  return modelEnvSchema.parse({
    ...process.env,
    PROVIDER_NAME: process.env.PROVIDER_NAME ?? "openrouter",
  });
}
