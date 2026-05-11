import type { AuthenticatedUser } from "../_core/sdk";

export type PaymentProviderId = "toss" | "lemonsqueezy";

export type CreditPackId = "starter" | "standard" | "pro";

export type UiLocale = "ko" | "en" | "zh" | "ja";

export type CreateCreditCheckoutInput = {
  user: AuthenticatedUser;
  packageId: CreditPackId;
  /** 명시 없을 때 서버가 locale 로 기본 결제사를 고름 */
  provider?: PaymentProviderId;
  locale?: UiLocale;
  baseUrl: string;
};

/** 웹훅/confirm 단계에서 공통 처리로 넘길 최소 이벤트 */
export type PaymentSucceededEvent = {
  provider: PaymentProviderId;
  /** idempotency_key 조합에 사용 (웹훅 고유 이벤트 id 등) */
  paymentEventId: string | null;
  paymentOrderId: string | null;
  paymentCheckoutId: string | null;
  clerkUserId: string;
  creditAmount: number;
  creditPackageId: CreditPackId;
  description: string | null;
};

export type CreateCreditCheckoutResult = {
  provider: PaymentProviderId;
  /** Lemon Squeezy 등 리다이렉트 결제 */
  url?: string;
  /** Toss 등 프론트 SDK 결제용 페이로드 */
  checkoutPayload?: unknown;
  /** 서버 확정 크레딧 수 (클라이언트가 보낸 값과 무관) */
  creditAmount: number;
  creditPackageId: CreditPackId;
};

export type PaymentWebhookVerifyResult =
  | { ok: true; rawBody: string; event: PaymentSucceededEvent }
  | { ok: false; reason: string };

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  createCreditCheckout(input: CreateCreditCheckoutInput): Promise<CreateCreditCheckoutResult>;
  verifyWebhookAndExtractEvent(req: {
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<PaymentWebhookVerifyResult>;
}
