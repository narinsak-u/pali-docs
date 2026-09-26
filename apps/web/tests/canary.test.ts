import { describe, expect, it } from "vitest";
import type { PromotionDecision } from "@/lib/rag/provider-evaluation";
import {
  CanaryController,
  deserializeCanaryState,
  selectInternalCanaryBackend,
  serializeCanaryState,
  type CanaryState,
} from "@/lib/config/canary";

const passingDecision: PromotionDecision = { promote: true, reasons: [] };
const blockedDecision: PromotionDecision = {
  promote: false,
  reasons: ["authoritative ProductionBaseline artifact is required"],
};

function canaryState(): CanaryState {
  return {
    schemaVersion: "v1",
    state: "canary",
    target: "langgraph",
    trafficPercent: 50,
    cohortSalt: "test-salt",
    startedAt: "2026-09-26T00:00:00.000Z",
    observationEndsAt: "2026-09-26T01:00:00.000Z",
    rollbackAvailableUntil: "2026-09-27T00:00:00.000Z",
  };
}

describe("server-owned canary targeting", () => {
  it("fails closed when Task 6 gates lack an authoritative baseline", () => {
    const controller = new CanaryController();

    const result = controller.startCanary(blockedDecision, {
      now: "2026-09-26T00:00:00.000Z",
      trafficPercent: 10,
      cohortSalt: "test-salt",
    });

    expect(result.accepted).toBe(false);
    expect(controller.snapshot().state).toBe("hosted");
    expect(result.reasons).toContain("authoritative ProductionBaseline artifact is required");
  });

  it("assigns a tenant deterministically without using client targeting", () => {
    const state = canaryState();
    const identity = { tenantId: "tenant-a", requestId: "server-request-1" };

    expect(selectInternalCanaryBackend(identity, state)).toBe(
      selectInternalCanaryBackend(identity, state),
    );
    expect(selectInternalCanaryBackend(identity, { ...state, trafficPercent: 0 })).toBe("ai-sdk");
    expect(selectInternalCanaryBackend(identity, { ...state, trafficPercent: 100 })).toBe("langgraph");
    expect(selectInternalCanaryBackend(undefined, state)).toBe("ai-sdk");
  });

  it("does not carry one tenant's cohort assignment into another tenant", () => {
    const state = canaryState();
    const tenantA = { tenantId: "tenant-a", requestId: "request-a" };
    const tenantB = { tenantId: "tenant-b", requestId: "request-b" };
    const before = selectInternalCanaryBackend(tenantB, state);

    void selectInternalCanaryBackend(tenantA, state);

    expect(selectInternalCanaryBackend(tenantB, state)).toBe(before);
  });

  it("promotes only after a passing gate and the observation window", () => {
    const controller = new CanaryController();
    expect(
      controller.startCanary(passingDecision, {
        now: "2026-09-26T00:00:00.000Z",
        trafficPercent: 10,
        cohortSalt: "test-salt",
        observationWindowMs: 60 * 60 * 1000,
        rollbackWindowMs: 24 * 60 * 60 * 1000,
      }),
    ).toMatchObject({ accepted: true });

    expect(
      controller.promote(blockedDecision, "2026-09-26T00:30:00.000Z").accepted,
    ).toBe(false);
    expect(controller.snapshot().state).toBe("canary");
    expect(
      controller.promote(passingDecision, "2026-09-26T01:00:00.000Z").accepted,
    ).toBe(true);
    expect(controller.snapshot().state).toBe("promoted");
  });

  it("rolls back to hosted and targets no canary traffic", () => {
    const controller = new CanaryController(canaryState());

    const result = controller.rollback("local_provider_unavailable", "2026-09-26T02:00:00.000Z");

    expect(result.accepted).toBe(true);
    expect(controller.snapshot().state).toBe("hosted");
    expect(selectInternalCanaryBackend({ tenantId: "tenant-a", requestId: "request" }, controller.snapshot())).toBe(
      "ai-sdk",
    );
    expect(result.fallback).toBe("ai-sdk");
  });

  it("serializes and restores state without changing targeting", () => {
    const state = canaryState();

    const restored = deserializeCanaryState(serializeCanaryState(state));

    expect(restored).toEqual(state);
    expect(selectInternalCanaryBackend({ tenantId: "tenant-a", requestId: "request" }, restored)).toBe(
      selectInternalCanaryBackend({ tenantId: "tenant-a", requestId: "other-request" }, state),
    );
  });

  it("sends all trusted traffic to the target after explicit promotion", () => {
    const promoted = {
      ...canaryState(),
      state: "promoted" as const,
      trafficPercent: 10,
      promotedAt: "2026-09-26T01:00:00.000Z",
    };

    expect(
      selectInternalCanaryBackend(
        { tenantId: "tenant-a", requestId: "request" },
        promoted,
      ),
    ).toBe("langgraph");
  });
});
