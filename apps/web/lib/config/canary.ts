import { createHash } from "node:crypto";
import { z } from "zod";
import { decidePromotion, type ProviderComparison, type PromotionDecision } from "@/lib/rag/provider-evaluation";
import type { RagBackend } from "@/lib/config/rollout";

export const CANARY_OBSERVATION_WINDOW_MS = 60 * 60 * 1000;
export const CANARY_ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

type ActiveCanaryState = "hosted" | "canary" | "promoted";

export interface CanaryState {
  schemaVersion: "v1";
  state: ActiveCanaryState;
  target: "langgraph";
  trafficPercent: number;

  cohortSalt: string;
  startedAt?: string;
  observationEndsAt?: string;
  rollbackAvailableUntil?: string;
  promotedAt?: string;
  lastRollbackReason?: string;
  promotionEvidence?: CanaryPromotionEvidence;
}

export type CanaryPromotionInput = {
  comparison: ProviderComparison;
  reviewedCases: unknown;
  productionBaseline: unknown;
  rollbackReady?: boolean;
};

export interface CanaryPromotionEvidence {
  decision: PromotionDecision;
  input: CanaryPromotionInput;
}

export interface CanaryIdentity {
  /** Trusted server-side tenant identity; never read from request JSON or headers. */
  tenantId: string;
  /** Server-generated request identity, retained for correlation but not client targeting. */
  requestId: string;
}

export interface CanaryTransition {
  accepted: boolean;
  state: CanaryState;
  reasons: string[];
  fallback?: RagBackend;
}

const canaryStateSchema = z
  .object({
    schemaVersion: z.literal("v1"),
    state: z.enum(["hosted", "canary", "promoted"]),
    target: z.literal("langgraph"),
    trafficPercent: z.number().int().min(0).max(100),
    cohortSalt: z.string().min(1).max(200),
    startedAt: z.string().datetime({ offset: true }).optional(),
    observationEndsAt: z.string().datetime({ offset: true }).optional(),
    promotionEvidence: z
      .object({
        decision: z
          .object({ promote: z.boolean(), reasons: z.array(z.string()) })
          .strict(),
        input: z
          .object({
            comparison: z.unknown(),
            reviewedCases: z.unknown(),
            productionBaseline: z.unknown(),
            rollbackReady: z.boolean().optional(),
          })
          .strict(),
      })
      .strict()
      .optional(),
    rollbackAvailableUntil: z.string().datetime({ offset: true }).optional(),
    promotedAt: z.string().datetime({ offset: true }).optional(),
    lastRollbackReason: z.string().min(1).max(120).optional(),
  })
  .strict();

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function validateState(value: unknown, requirePromotionEvidence = true): CanaryState {
  const state = canaryStateSchema.parse(value);
  if (state.state === "hosted") return state;
  if (!state.startedAt || !state.observationEndsAt || !state.rollbackAvailableUntil) {
    throw new Error("active canary state requires observation and rollback windows");
  }
  if (
    !validTimestamp(state.startedAt) ||
    !validTimestamp(state.observationEndsAt) ||
    !validTimestamp(state.rollbackAvailableUntil) ||
    Date.parse(state.observationEndsAt) < Date.parse(state.startedAt) ||
    Date.parse(state.rollbackAvailableUntil) < Date.parse(state.observationEndsAt)
  ) {
    throw new Error("active canary state has invalid rollout windows");
  }
  if (state.state === "promoted" && !state.promotedAt) {
    throw new Error("promoted state requires promotion time");
  }
  if (state.promotedAt && !validTimestamp(state.promotedAt)) {
    throw new Error("promoted state has invalid promotion time");
  }
  if (requirePromotionEvidence) {
    const evidence = state.promotionEvidence;
    if (!evidence) throw new Error("active canary state requires Task 6 promotion evidence");
    let verified: PromotionDecision;
    try {
      verified = decidePromotion(evidence.input);
    } catch {
      throw new Error("Task 6 promotion evidence is invalid");
    }
    if (
      !acceptedDecision(verified) ||
      JSON.stringify(verified) !== JSON.stringify(evidence.decision)
    ) {
      throw new Error("Task 6 promotion evidence does not pass all gates");
    }
  }
  return state;
}

function hostedState(reason?: string): CanaryState {
  return {
    schemaVersion: "v1",
    state: "hosted",
    target: "langgraph",
    trafficPercent: 0,
    cohortSalt: "inactive",
    ...(reason ? { lastRollbackReason: reason } : {}),
  };
}

function copyState(state: CanaryState): CanaryState {
  return validateState(JSON.parse(JSON.stringify(state)), false);
}


function acceptedDecision(decision: PromotionDecision): boolean {
  return decision.promote === true && decision.reasons.length === 0;
}

function verifiedPromotionEvidence(evidence: CanaryPromotionEvidence): boolean {
  try {
    const verified = decidePromotion(evidence.input);
    return (
      acceptedDecision(verified) &&
      JSON.stringify(verified) === JSON.stringify(evidence.decision)
    );
  } catch {
    return false;
  }
}


function parseNow(now: string): number {
  const parsed = Date.parse(now);
  if (!Number.isFinite(parsed)) throw new Error("rollout time must be an ISO timestamp");
  return parsed;
}

export class CanaryController {
  private state: CanaryState;

  constructor(initialState?: CanaryState) {
    this.state = initialState === undefined ? hostedState() : copyState(initialState);
  }

  snapshot(): CanaryState {
    return copyState(this.state);
  }

  startCanary(
    decision: PromotionDecision,
    options: {
      now: string;
      trafficPercent: number;
      cohortSalt: string;
      promotionEvidence?: CanaryPromotionEvidence;
      observationWindowMs?: number;
      rollbackWindowMs?: number;
    },
  ): CanaryTransition {
    const reasons = [...decision.reasons];
    if (!acceptedDecision(decision)) {
      if (reasons.length === 0) reasons.push("all promotion gates must pass");
      return { accepted: false, state: this.snapshot(), reasons };
    }
    if (
      !options.promotionEvidence ||
      !verifiedPromotionEvidence(options.promotionEvidence)
    ) {
      return {
        accepted: false,
        state: this.snapshot(),
        reasons: ["authoritative Task 6 promotion evidence is required"],
      };
    }
    if (this.state.state !== "hosted") {
      return {
        accepted: false,
        state: this.snapshot(),
        reasons: ["canary can only start from hosted state"],
      };
    }
    const now = parseNow(options.now);
    const observationWindowMs = options.observationWindowMs ?? CANARY_OBSERVATION_WINDOW_MS;
    const rollbackWindowMs = options.rollbackWindowMs ?? CANARY_ROLLBACK_WINDOW_MS;
    if (
      !Number.isInteger(options.trafficPercent) ||
      options.trafficPercent < 1 ||
      options.trafficPercent > 100
    ) {
      reasons.push("canary traffic percentage must be an integer from 1 through 100");
    }
    if (!Number.isInteger(observationWindowMs) || observationWindowMs <= 0) {
      reasons.push("observation window must be a positive integer");
    }
    if (!Number.isInteger(rollbackWindowMs) || rollbackWindowMs < observationWindowMs) {
      reasons.push("rollback window must cover the observation window");
    }
    if (!options.cohortSalt.trim() || options.cohortSalt.length > 200) {
      reasons.push("canary cohort salt is required");
    }
    if (reasons.length > 0) {
      return { accepted: false, state: this.snapshot(), reasons: [...new Set(reasons)] };
    }
    this.state = {
      schemaVersion: "v1",
      state: "canary",
      target: "langgraph",
      trafficPercent: options.trafficPercent,
      cohortSalt: options.cohortSalt,
      startedAt: new Date(now).toISOString(),
      observationEndsAt: new Date(now + observationWindowMs).toISOString(),
      rollbackAvailableUntil: new Date(now + rollbackWindowMs).toISOString(),
      promotionEvidence: options.promotionEvidence,
    };
    return { accepted: true, state: this.snapshot(), reasons: [] };
  }

  promote(decision: PromotionDecision, now: string): CanaryTransition {
    const reasons = [...decision.reasons];
    if (!acceptedDecision(decision)) {
      if (reasons.length === 0) reasons.push("all promotion gates must pass");
      return { accepted: false, state: this.snapshot(), reasons };
    }
    if (this.state.state !== "canary") {
      return {
        accepted: false,
        state: this.snapshot(),
        reasons: ["promotion requires an active canary"],
      };
    }
    const current = parseNow(now);
    const observationEnds = Date.parse(this.state.observationEndsAt ?? "");
    const rollbackDeadline = Date.parse(this.state.rollbackAvailableUntil ?? "");
    if (current < observationEnds) {
      return {
        accepted: false,
        state: this.snapshot(),
        reasons: ["observation window has not elapsed"],
      };
    }
    if (current >= rollbackDeadline) {
      return {
        accepted: false,
        state: this.snapshot(),
        reasons: ["rollback window has expired; revalidation is required"],
      };
    }
    this.state = { ...this.state, state: "promoted", promotedAt: new Date(current).toISOString() };
    return { accepted: true, state: this.snapshot(), reasons: [] };
  }

  rollback(reason: string, now: string): CanaryTransition {
    parseNow(now);
    const normalizedReason = reason.trim();
    if (!normalizedReason || normalizedReason.length > 120) {
      return {
        accepted: false,
        state: this.snapshot(),
        reasons: ["rollback reason is required"],
      };
    }
    if (this.state.state === "hosted") {
      return {
        accepted: false,
        state: this.snapshot(),
        reasons: ["hosted state is already active"],
      };
    }
    this.state = hostedState(normalizedReason);
    return {
      accepted: true,
      state: this.snapshot(),
      reasons: [],
      fallback: "ai-sdk",
    };
  }
}

/**
 * Assign only trusted server identities. Missing identity or inactive state always uses hosted.
 * The tenant bucket is stable across requests and isolated by the server-owned cohort salt.
 */
export function selectInternalCanaryBackend(
  identity: CanaryIdentity | undefined,
  state: CanaryState,
): RagBackend {
  if (state.state === "hosted" || !identity?.tenantId.trim() || !identity.requestId.trim()) {
    return "ai-sdk";
  }
  if (state.state === "promoted" || state.trafficPercent >= 100) return "langgraph";
  if (state.trafficPercent <= 0) return "ai-sdk";
  const digest = createHash("sha256")
    .update(`${state.cohortSalt}\u0000${identity.tenantId}`)
    .digest();
  const bucket = digest.readUInt32BE(0) % 100;
  return bucket < state.trafficPercent ? "langgraph" : "ai-sdk";
}

export function serializeCanaryState(state: CanaryState): string {
  return JSON.stringify(validateState(state));
}

export function deserializeCanaryState(serialized: string): CanaryState {
  return validateState(JSON.parse(serialized));
}

/** undefined means no canary state was configured; null means configured but invalid. */
export function readCanaryState(
  env: NodeJS.ProcessEnv = process.env,
): CanaryState | null | undefined {
  const raw = env.RAG_CANARY_STATE?.trim();
  if (!raw) return undefined;
  try {
    return deserializeCanaryState(raw);
  } catch {
    return null;
  }
}
