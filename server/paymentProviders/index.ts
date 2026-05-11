import type { PaymentProvider, PaymentProviderId } from "./types";
import { lemonsqueezyProvider } from "./lemonsqueezyProvider";
import { tossProvider } from "./tossProvider";

const registry: Record<PaymentProviderId, PaymentProvider> = {
  toss: tossProvider,
  lemonsqueezy: lemonsqueezyProvider,
};

export function getPaymentProvider(id: PaymentProviderId): PaymentProvider {
  return registry[id];
}

export * from "./types";
export * from "./packages";
