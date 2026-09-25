import type { TaskPart } from "@/lib/schemas/ai-data-parts";

export type DataTaskPart = { type: "data-task"; data: TaskPart };

/**
 * Reduce a stream of `data-task` parts to the latest entry per logical step.
 * Dedup key is `id` when present, otherwise `label` — so repeated tool calls
 * with distinct `toolCallId`s but the same label collapse to one entry.
 * Status and other fields are merged from the latest occurrence.
 */
export function reduceTaskParts(parts: DataTaskPart[]): DataTaskPart[] {
  const latest: DataTaskPart[] = [];
  const indexByKey = new Map<string, number>();

  for (const p of parts) {
    const key = p.data.id ?? p.data.label;
    const existingIdx = indexByKey.get(key);
    if (existingIdx !== undefined) {
      latest[existingIdx] = {
        type: "data-task",
        data: { ...latest[existingIdx].data, ...p.data },
      };
    } else {
      indexByKey.set(key, latest.length);
      latest.push(p);
    }
  }

  return latest;
}
