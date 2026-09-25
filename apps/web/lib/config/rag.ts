import { z } from "zod";

const ragEnvSchema = z.object({
  PINECONE_API_KEY: z.string().min(1),
  PINECONE_INDEX_NAME: z.string().min(1),
  PINECONE_NAMESPACE: z.string().default(""),
  PINECONE_CORPUS_REVISION: z.string().min(1),
  RAG_CANDIDATE_TOP_K: z.coerce.number().int().min(1).max(50).default(20),
  RAG_ACCEPTED_TOP_K: z.coerce.number().int().min(1).max(12).default(8),
  RAG_MIN_SCORE: z.coerce.number().min(0).max(1).default(0),
  RAG_HIERARCHY_EXPANSION: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  RAG_MAX_CONTEXT_CHARS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(50000)
    .default(12000),
});

export type RagConfig = z.infer<typeof ragEnvSchema>;

export function getRagConfig(): RagConfig {
  return ragEnvSchema.parse(process.env);
}
