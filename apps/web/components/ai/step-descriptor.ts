export type StepKind = "reasoning" | "task" | "response" | "suggestions";
export type StepStatus = "pending" | "running" | "done" | "error";

export interface StepDescriptor {
  id: string;
  kind: StepKind;
  status: StepStatus;
  label: string;
}
