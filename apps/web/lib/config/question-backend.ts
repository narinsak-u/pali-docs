import { getAuthenticatedTenantId } from "@/lib/config/canary-context";
import { readCanaryState, selectInternalCanaryBackend } from "@/lib/config/canary";
import { getRolloutConfig, selectRagBackend, type RagBackend } from "@/lib/config/rollout";

export function selectQuestionBackend(request: Request, runId: string): RagBackend {
  const canaryState = readCanaryState();
  const tenantId = getAuthenticatedTenantId(request);
  if (canaryState === null || (canaryState !== undefined && tenantId === undefined)) {
    return "ai-sdk";
  }
  if (canaryState === undefined) return selectRagBackend(runId, getRolloutConfig());
  return selectInternalCanaryBackend({ tenantId: tenantId ?? "", requestId: runId }, canaryState);
}
