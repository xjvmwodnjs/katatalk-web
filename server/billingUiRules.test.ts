import { describe, expect, it } from "vitest";
import { isCreditChargeCheckoutDisabled } from "@shared/billingUiRules";

describe("isCreditChargeCheckoutDisabled", () => {
  it("does not disable only because logged out (click leads to login)", () => {
    expect(isCreditChargeCheckoutDisabled(false, false, false)).toBe(false);
  });

  it("disables checkout when refund policy not accepted (logged in)", () => {
    expect(isCreditChargeCheckoutDisabled(false, false, true)).toBe(true);
  });

  it("disables checkout while loading", () => {
    expect(isCreditChargeCheckoutDisabled(true, true, true)).toBe(true);
  });

  it("enables checkout when authenticated, policy accepted and not loading", () => {
    expect(isCreditChargeCheckoutDisabled(true, false, true)).toBe(false);
  });
});
