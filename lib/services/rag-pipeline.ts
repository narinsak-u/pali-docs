import {
  queryPinecone,
  formatContext,
  type DocumentMatch,
} from "./vector-store";
import { generateQueryEmbedding } from "./embedding";
import type { UIMessage } from "ai";

export interface RAGOptions {
  topK?: number;
}

export interface RAGResult {
  context: string;
  matches: DocumentMatch[];
}

export function extractTextFromMessages(messages: UIMessage[]): string {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return "";

  if (Array.isArray(lastMessage.parts)) {
    return lastMessage.parts.find((p) => p.type === "text")?.text || "";
  }

  if ("content" in lastMessage && typeof lastMessage.content === "string") {
    return lastMessage.content;
  }

  return "";
}

export async function searchDocuments(
  query: string,
  options: RAGOptions = {},
): Promise<RAGResult> {
  const topK = options.topK ?? 5;
  if (!query) return { context: "", matches: [] };

  const embedding = await generateQueryEmbedding(query);
  const matches = await queryPinecone(embedding, topK);
  const context = formatContext(matches);
  return { context, matches };
}

export async function runRAG(
  messages: UIMessage[],
  options: RAGOptions = {},
): Promise<RAGResult> {
  return searchDocuments(extractTextFromMessages(messages), options);
}
