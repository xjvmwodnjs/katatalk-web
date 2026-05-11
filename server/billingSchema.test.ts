import { describe, expect, it } from "vitest";
import { createCheckoutBodySchema } from "./billingRoute";

describe("createCheckoutBodySchema", () => {
  it("rejects invalid packageId", () => {
    const r = createCheckoutBodySchema.safeParse({ packageId: "gold" });
    expect(r.success).toBe(false);
  });

  it("rejects unknown fields (e.g. client creditAmount)", () => {
    const r = createCheckoutBodySchema.safeParse({
      packageId: "starter",
      creditAmount: 9999,
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid provider", () => {
    const r = createCheckoutBodySchema.safeParse({
      packageId: "starter",
      provider: "paddle",
    });
    expect(r.success).toBe(false);
  });

  it("accepts starter + lemonsqueezy", () => {
    const r = createCheckoutBodySchema.safeParse({
      packageId: "starter",
      provider: "lemonsqueezy",
      locale: "en",
    });
    expect(r.success).toBe(true);
  });
});
