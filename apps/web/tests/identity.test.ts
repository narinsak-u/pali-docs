import { describe, expect, it } from "vitest";
import { createPrincipalToken } from "@/lib/config/canary-context";

describe("signed FastAPI Principal identity", () => {
  it("creates a short-lived token from server-authenticated scope", () => {
    const token = createPrincipalToken(
      { tenant: "tenant-1" },
      "identity-secret",
      1_700_000_000_000,
    );

    expect(token.split(".")).toHaveLength(3);
    expect(token.startsWith("v1.")).toBe(true);
  });

  it("rejects malformed typed scope claims before signing", () => {
    expect(() =>
      createPrincipalToken({ tenant: "tenant-1", roles: ["admin", 7] }, "identity-secret"),
    ).toThrow("roles claim is invalid");
  });
});
