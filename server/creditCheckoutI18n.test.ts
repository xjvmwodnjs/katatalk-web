import { describe, expect, it } from "vitest";
import { TRANSLATIONS } from "@/lib/mockData";

const LANGS = ["ko", "en", "ja", "zh"] as const;

describe("credit checkout i18n (mockData)", () => {
  it("defines checkout UI strings for ko/en/ja/zh", () => {
    for (const lang of LANGS) {
      const t = TRANSLATIONS[lang];
      expect(t.pricingTitle.length).toBeGreaterThan(0);
      expect(t.pricingSubtitle.length).toBeGreaterThan(0);
      expect(t.pricingCheckoutButton.length).toBeGreaterThan(0);
      expect(t.creditRefundPolicyAck.length).toBeGreaterThan(0);
      expect(t.creditRefundMustAgree.length).toBeGreaterThan(0);
      expect(t.creditPackStarter.length).toBeGreaterThan(0);
      expect(t.creditsUnit.length).toBeGreaterThan(0);
      expect(t.pricingCheckoutUrlError.length).toBeGreaterThan(0);
      expect(t.billingCreditsAppliedNotice.length).toBeGreaterThan(0);
      expect(t.billingCreditDelayedMessage.length).toBeGreaterThan(0);
    }
  });

  it("keeps lemon-only checkout button label distinct per locale", () => {
    expect(TRANSLATIONS.ko.pricingCheckoutButton).toContain("결제");
    expect(TRANSLATIONS.en.pricingCheckoutButton.toLowerCase()).toContain("checkout");
    expect(TRANSLATIONS.ja.pricingCheckoutButton).toContain("決済");
    expect(TRANSLATIONS.zh.pricingCheckoutButton.length).toBeGreaterThan(0);
  });

  it("does not expose legal TODO lines on user-facing refund copy", () => {
    for (const lang of LANGS) {
      const t = TRANSLATIONS[lang];
      expect(t.creditRefundPolicyAck.toUpperCase()).not.toContain("TODO");
      expect(t.creditBulletBalancePersistent.toUpperCase()).not.toContain("법무");
    }
  });
});
