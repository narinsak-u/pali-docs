import { describe, expect, it } from "vitest";
import { getRolloutConfig, selectRagBackend } from "@/lib/config/rollout";

describe("getRolloutConfig", () => {
  it("defaults to AI SDK with no rollout traffic", () => {
    expect(getRolloutConfig({})).toEqual({
      backend: "ai-sdk",
      trafficPercent: 0,
      rolloutEnabled: true,
    });
  });

  it("accepts explicit backend modes", () => {
    expect(getRolloutConfig({ RAG_BACKEND: "langgraph" })).toEqual({
      backend: "langgraph",
      trafficPercent: 0,
      rolloutEnabled: true,
    });
    expect(getRolloutConfig({ RAG_BACKEND: "ai-sdk" })).toEqual({
      backend: "ai-sdk",
      trafficPercent: 0,
      rolloutEnabled: false,
    });
  });

  it.each(["", "nope", "-1", "101", "1.5", "Infinity"]) (
    "defaults invalid traffic percentage %j to zero",
    (trafficPercent) => {
      expect(getRolloutConfig({ RAG_LANGGRAPH_TRAFFIC_PERCENT: trafficPercent })).toEqual({
        backend: "ai-sdk",
        trafficPercent: 0,
        rolloutEnabled: true,
      });
    },
  );

  it("accepts integer traffic percentages from zero through one hundred", () => {
    expect(getRolloutConfig({ RAG_LANGGRAPH_TRAFFIC_PERCENT: "0" }).trafficPercent).toBe(0);
    expect(getRolloutConfig({ RAG_LANGGRAPH_TRAFFIC_PERCENT: "100" }).trafficPercent).toBe(100);
  });

  it.each(["custom", "", "LangGraph", "AI-SDK"])(
    "disables rollout for an explicit unknown backend %j",
    (backend) => {
      expect(getRolloutConfig({
        RAG_BACKEND: backend,
        RAG_LANGGRAPH_TRAFFIC_PERCENT: "100",
      })).toEqual({
        backend: "ai-sdk",
        trafficPercent: 100,
        rolloutEnabled: false,
      });
      expect(selectRagBackend("run-1", getRolloutConfig({
        RAG_BACKEND: backend,
        RAG_LANGGRAPH_TRAFFIC_PERCENT: "100",
      }))).toBe("ai-sdk");
    },
  );
});

describe("selectRagBackend", () => {
  it("honors an explicit LangGraph backend", () => {
    expect(selectRagBackend("run-1", { backend: "langgraph", trafficPercent: 0 })).toBe(
      "langgraph",
    );
  });

  it("honors an explicit AI SDK backend even at one hundred percent", () => {
    expect(selectRagBackend("run-1", { backend: "ai-sdk", trafficPercent: 100 })).toBe("ai-sdk");
  });

  it("keeps all traffic on AI SDK at zero percent", () => {
    expect(
      selectRagBackend("run-1", {
        backend: "ai-sdk",
        trafficPercent: 0,
        rolloutEnabled: true,
      }),
    ).toBe("ai-sdk");
  });

  it("sends all traffic to LangGraph at one hundred percent", () => {
    expect(
      selectRagBackend("run-1", {
        backend: "ai-sdk",
        trafficPercent: 100,
        rolloutEnabled: true,
      }),
    ).toBe("langgraph");
  });

  it("assigns the same run ID consistently", () => {
    const config = { backend: "ai-sdk" as const, trafficPercent: 50, rolloutEnabled: true };
    expect(selectRagBackend("stable-run", config)).toBe(selectRagBackend("stable-run", config));
  });
});
