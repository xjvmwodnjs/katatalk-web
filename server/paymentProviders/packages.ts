import type { CreditPackId, PaymentProviderId, UiLocale } from "./types";

export const CREDIT_PACK_CREDITS: Record<CreditPackId, number> = {
  starter: 20,
  standard: 50,
  pro: 200,
};

export function getCreditAmountForPackage(packageId: CreditPackId): number {
  return CREDIT_PACK_CREDITS[packageId];
}

/** UI locale 기준 기본 결제사: 한국어 → Toss, 그 외 → Lemon Squeezy */
export function defaultPaymentProviderForLocale(locale?: UiLocale): PaymentProviderId {
  if (locale === "ko") {
    return "toss";
  }
  return "lemonsqueezy";
}

export function resolveCheckoutProvider(
  requested: PaymentProviderId | undefined,
  locale: UiLocale | undefined
): PaymentProviderId {
  return requested ?? defaultPaymentProviderForLocale(locale);
}
