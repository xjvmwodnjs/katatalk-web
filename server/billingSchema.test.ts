import { describe, expect, it } from "vitest";
import { checkoutPackageBodySchema } from "./billingRoute";

describe("checkoutPackageBodySchema", () => {
  it("rejects invalid packageId", () => {
    const r = checkoutPackageBodySchema.safeParse({ packageId: "gold" });
    expect(r.success).toBe(false);
  });

  it("accepts starter", () => {
    const r = checkoutPackageBodySchema.safeParse({ packageId: "starter" });
    expect(r.success).toBe(true);
  });
});
