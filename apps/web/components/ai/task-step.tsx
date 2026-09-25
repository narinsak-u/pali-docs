import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/lib/schemas/ai-data-parts";

export interface TaskStepProps {
  label: string;
  status: TaskStatus;
  query?: string;
  matchCount?: number;
  message?: string;
}

export function TaskStep({ label, status, query, matchCount, message }: TaskStepProps) {
  return (
    <div
      data-testid="task-step"
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        status === "error"
          ? "border-red-300 bg-red-50 text-red-800 dark:bg-red-950/40 dark:border-red-800 dark:text-red-200"
          : "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200",
      )}
    >
      <span className="font-semibold mr-2">{label}:</span>
      {status === "running" && (query ? `กำลังค้นหา "${query}"...` : "กำลังทำงาน...")}
      {status === "done" && (typeof matchCount === "number" ? `เสร็จสิ้น · พบ ${matchCount} รายการ` : "เสร็จสิ้น")}
      {status === "error" && (message ?? "เกิดข้อผิดพลาด")}
      {status === "pending" && "รอดำเนินการ"}
    </div>
  );
}
