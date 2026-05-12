import { describe, expect, it } from "vitest";
import { isCreditChargeCheckoutDisabled } from "@shared/billingUiRules";

describe("isCreditChargeCheckoutDisabled", () => {
  it("disables when not authenticated even if policy accepted", () => {
    expect(isCreditChargeCheckoutDisabled(true, false, false)).toBe(true);
  });

  it("disables checkout when refund policy not accepted", () => {
    expect(isCreditChargeCheckoutDisabled(false, false, true)).toBe(true);
  });

  it("disables checkout while loading", () => {
    expect(isCreditChargeCheckoutDisabled(true, true, true)).toBe(true);
  });

  it("enables checkout when authenticated, policy accepted and not loading", () => {
    expect(isCreditChargeCheckoutDisabled(true, false, true)).toBe(false);
  });
});
