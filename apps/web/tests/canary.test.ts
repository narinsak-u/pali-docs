import { describe, expect, it, vi } from "vitest";
import * as ProviderEvaluation from "@/lib/rag/provider-evaluation";
import type { PromotionDecision } from "@/lib/rag/provider-evaluation";
import {
  CanaryController,
  deserializeCanaryState,
  selectInternalCanaryBackend,
  serializeCanaryState,
  type CanaryPromotionEvidence,
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

function passingEvidence(): CanaryPromotionEvidence {
  return {
    decision: passingDecision,
    input: {
      comparison: null as unknown as CanaryPromotionEvidence["input"]["comparison"],
      reviewedCases: null,
      productionBaseline: null,
      rollbackReady: true,
    },
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

  it("rejects a passing-looking decision without enforceable Task 6 evidence", () => {
    const controller = new CanaryController();

    const result = controller.startCanary(passingDecision, {
      now: "2026-09-26T00:00:00.000Z",
      trafficPercent: 10,
      cohortSalt: "test-salt",
    });

    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain("authoritative Task 6 promotion evidence is required");
    expect(controller.snapshot().state).toBe("hosted");
  });
  it("rejects promotion at the rollback-window boundary", () => {
    const gate = vi
      .spyOn(ProviderEvaluation, "decidePromotion")
      .mockReturnValue(passingDecision);
    try {
      const controller = new CanaryController();
      expect(
        controller.startCanary(passingDecision, {
          now: "2026-09-26T00:00:00.000Z",
          trafficPercent: 10,
          cohortSalt: "test-salt",
          rollbackWindowMs: 24 * 60 * 60 * 1000,
          promotionEvidence: passingEvidence(),
        }).accepted,
      ).toBe(true);

      const result = controller.promote(passingDecision, "2026-09-27T00:00:00.000Z");

      expect(result.accepted).toBe(false);
      expect(result.reasons).toContain("rollback window has expired; revalidation is required");
      expect(controller.snapshot().state).toBe("canary");
    } finally {
      gate.mockRestore();
    }
  });

  it("rolls back to hosted and targets no canary traffic", () => {
    const gate = vi
      .spyOn(ProviderEvaluation, "decidePromotion")
      .mockReturnValue(passingDecision);
    try {
      const controller = new CanaryController();
      expect(
        controller.startCanary(passingDecision, {
          now: "2026-09-26T00:00:00.000Z",
          trafficPercent: 10,
          cohortSalt: "test-salt",
          promotionEvidence: passingEvidence(),
        }).accepted,
      ).toBe(true);

      const result = controller.rollback("local_provider_unavailable", "2026-09-26T02:00:00.000Z");

      expect(result.accepted).toBe(true);
      expect(controller.snapshot().state).toBe("hosted");
      expect(selectInternalCanaryBackend({ tenantId: "tenant-a", requestId: "request" }, controller.snapshot())).toBe(
        "ai-sdk",
      );
      expect(result.fallback).toBe("ai-sdk");
    } finally {
      gate.mockRestore();
    }
  });

  it("serializes hosted state and rejects a schema-valid active-state bypass", () => {
    const state: CanaryState = {
      schemaVersion: "v1",
      state: "hosted",
      target: "langgraph",
      trafficPercent: 0,
      cohortSalt: "inactive",
    };

    expect(deserializeCanaryState(serializeCanaryState(state))).toEqual(state);
    expect(() =>
      deserializeCanaryState(JSON.stringify({ ...canaryState(), promotionEvidence: undefined })),
    ).toThrow("Task 6 promotion evidence");
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

  it("rejects an evidence-less active state before any transition", () => {
    expect(() => new CanaryController(canaryState())).toThrow(
      "active canary state requires Task 6 promotion evidence",
    );
  });

  it("revalidates stored Task 6 evidence before promotion", () => {
    const gate = vi
      .spyOn(ProviderEvaluation, "decidePromotion")
      .mockReturnValue(passingDecision);
    try {
      const controller = new CanaryController();
      expect(
        controller.startCanary(passingDecision, {
          now: "2026-09-26T00:00:00.000Z",
          trafficPercent: 10,
          cohortSalt: "test-salt",
          promotionEvidence: passingEvidence(),
        }).accepted,
      ).toBe(true);
      gate.mockReturnValue(blockedDecision);

      const result = controller.promote(passingDecision, "2026-09-26T01:00:00.000Z");

      expect(result.accepted).toBe(false);
      expect(result.reasons).toContain("authoritative Task 6 promotion evidence must be revalidated");
    } finally {
      gate.mockRestore();
    }
  });
});
