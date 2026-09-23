import { describe, expect, it } from "vitest";
import { getRolloutConfig, selectRagBackend } from "@/lib/config/rollout";

describe("getRolloutConfig", () => {
  it("defaults to AI SDK with no rollout traffic", () => {
    expect(getRolloutConfig({})).toEqual({ backend: "ai-sdk", trafficPercent: 0 });
  });

  it("accepts explicit backend modes", () => {
    expect(getRolloutConfig({ RAG_BACKEND: "langgraph" })).toEqual({
      backend: "langgraph",
      trafficPercent: 0,
    });
    expect(getRolloutConfig({ RAG_BACKEND: "ai-sdk" })).toEqual({
      backend: "ai-sdk",
      trafficPercent: 0,
    });
  });

  it.each(["", "nope", "-1", "101", "1.5", "Infinity"]) (
    "defaults invalid traffic percentage %j to zero",
    (trafficPercent) => {
      expect(getRolloutConfig({ RAG_LANGGRAPH_TRAFFIC_PERCENT: trafficPercent })).toEqual({
        backend: "ai-sdk",
        trafficPercent: 0,
      });
    },
  );

  it("accepts integer traffic percentages from zero through one hundred", () => {
    expect(getRolloutConfig({ RAG_LANGGRAPH_TRAFFIC_PERCENT: "0" }).trafficPercent).toBe(0);
    expect(getRolloutConfig({ RAG_LANGGRAPH_TRAFFIC_PERCENT: "100" }).trafficPercent).toBe(100);
  });

  it("falls back to AI SDK for an unknown backend", () => {
    expect(getRolloutConfig({ RAG_BACKEND: "custom" })).toEqual({
      backend: "ai-sdk",
      trafficPercent: 0,
    });
  });
});

describe("selectRagBackend", () => {
  it("honors an explicit LangGraph backend", () => {
    expect(selectRagBackend("run-1", { backend: "langgraph", trafficPercent: 0 })).toBe(
      "langgraph",
    );
  });

  it("keeps all traffic on AI SDK at zero percent", () => {
    expect(selectRagBackend("run-1", { backend: "ai-sdk", trafficPercent: 0 })).toBe("ai-sdk");
  });

  it("sends all traffic to LangGraph at one hundred percent", () => {
    expect(selectRagBackend("run-1", { backend: "ai-sdk", trafficPercent: 100 })).toBe(
      "langgraph",
    );
  });

  it("assigns the same run ID consistently", () => {
    const config = { backend: "ai-sdk" as const, trafficPercent: 50 };
    expect(selectRagBackend("stable-run", config)).toBe(selectRagBackend("stable-run", config));
  });
});
