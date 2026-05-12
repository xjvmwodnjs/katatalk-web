import type { CreditPackId, PaymentProviderId, UiLocale } from "./types";
import { CREDIT_PACK_CREDITS } from "@shared/creditPackCatalog";

export { CREDIT_PACK_CREDITS };

export function getCreditAmountForPackage(packageId: CreditPackId): number {
  return CREDIT_PACK_CREDITS[packageId];
}

/** 현재 단계에서는 모든 locale 에 대해 Lemon Squeezy 만 사용합니다. */
export function defaultPaymentProviderForLocale(_locale?: UiLocale): PaymentProviderId {
  return "lemonsqueezy";
}

export function resolveCheckoutProvider(
  requested: PaymentProviderId | undefined,
  locale: UiLocale | undefined
): PaymentProviderId {
  return requested ?? defaultPaymentProviderForLocale(locale);
}
