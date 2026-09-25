import { z } from "zod";

export const taskStatusSchema = z.enum(["pending", "running", "done", "error"]);

export const reasoningPartSchema = z.object({
  summary: z.string().min(1),
  excerpts: z.array(z.string()).optional(),
});

export const taskPartSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1),
  status: taskStatusSchema,
  query: z.string().optional(),
  matchCount: z.number().int().nonnegative().optional(),
  message: z.string().optional(),
});

export const suggestionsPartSchema = z.object({
  suggestions: z.array(z.string().min(1)).min(1).max(3),
});

export const citationSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    title: z.string().min(1),
    section: z.string().min(1).optional(),
  })
  .strict();

export const citationsPartSchema = z.object({
  citations: z.array(citationSchema),
});

export const agentTurnOutcomeSchema = z.enum([
  "answered",
  "insufficient-evidence",
  "retrieval-unavailable",
  "failed",
]);

export const outcomePartSchema = z.object({
  outcome: agentTurnOutcomeSchema,
  code: z.string().min(1).optional(),
});

export const questionPartSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
  option1: z.string().min(1),
  option2: z.string().min(1),
  option3: z.string().min(1),
});

export const statusPartSchema = z.object({
  phase: z.enum(["thinking", "searching", "answering"]),
  message: z.string().optional(),
});

export type ReasoningPart = z.infer<typeof reasoningPartSchema>;
export type TaskPart = z.infer<typeof taskPartSchema>;
export type SuggestionsPart = z.infer<typeof suggestionsPartSchema>;
export type CitationsPart = z.infer<typeof citationsPartSchema>;
export type OutcomePart = z.infer<typeof outcomePartSchema>;
export type QuestionPart = z.infer<typeof questionPartSchema>;
export type StatusPart = z.infer<typeof statusPartSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
