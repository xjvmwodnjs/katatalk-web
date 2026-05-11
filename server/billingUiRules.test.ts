import { describe, expect, it } from "vitest";
import { isCreditChargeCheckoutDisabled } from "@shared/billingUiRules";

describe("isCreditChargeCheckoutDisabled", () => {
  it("disables checkout when refund policy not accepted", () => {
    expect(isCreditChargeCheckoutDisabled(false, false)).toBe(true);
  });

  it("disables checkout while loading", () => {
    expect(isCreditChargeCheckoutDisabled(true, true)).toBe(true);
  });

  it("enables checkout when policy accepted and not loading", () => {
    expect(isCreditChargeCheckoutDisabled(true, false)).toBe(false);
  });
});
