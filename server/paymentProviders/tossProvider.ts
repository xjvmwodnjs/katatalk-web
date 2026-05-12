/**
 * Toss Payments — 한국 유저용 결제 골격.
 *
 * IMPORTANT: success URL 만으로 credits 를 올리면 안 됩니다. 반드시 웹훅 또는 서버 confirm 후
 * `addCreditsFromPaymentWebhook` 으로만 잔액을 반영하세요.
 *
 * TODO: Toss 결제 승인 API·SDK 연동, 웹훅 서명 검증 완성, 실제 금액(KRW) 매핑.
 */

import { randomUUID } from "crypto";
import { ENV } from "../_core/env";
import { walletSubjectFromAuthUser } from "../creditService";
import type {
  CreateCreditCheckoutInput,
  CreateCreditCheckoutResult,
  PaymentProvider,
  PaymentWebhookVerifyResult,
} from "./types";
import { getCreditAmountForPackage } from "./packages";

export const tossProvider: PaymentProvider = {
  id: "toss",

  async createCreditCheckout(input: CreateCreditCheckoutInput): Promise<CreateCreditCheckoutResult> {
    const clerkUserId = walletSubjectFromAuthUser(input.user);
    const creditAmount = getCreditAmountForPackage(input.packageId);
    const orderId = `kt-${input.packageId}-${randomUUID().slice(0, 8)}`;
    const successUrl = (ENV.tossSuccessUrl || `${input.baseUrl.replace(/\/$/, "")}/?billing=success`).trim();
    const failUrl = (ENV.tossFailUrl || `${input.baseUrl.replace(/\/$/, "")}/?billing=cancel`).trim();

    // TODO: 상품별 KRW 금액을 서버 설정으로 매핑 (현재는 프론트 결제창 연동 전 스켈레톤)
    const amountKrw = 100;

    return {
      provider: "toss",
      creditAmount,
      creditPackageId: input.packageId,
      checkoutPayload: {
        orderId,
        amount: amountKrw,
        orderName: `KataTalk 크레딧 ${creditAmount}`,
        customerEmail: input.user.email ?? undefined,
        successUrl,
        failUrl,
        metadata: {
          clerkUserId,
          creditPackageId: input.packageId,
          creditAmount: String(creditAmount),
          paymentProvider: "toss",
        },
      },
    };
  },

  async verifyWebhookAndExtractEvent(_req: {
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<PaymentWebhookVerifyResult> {
    const secret = ENV.tossWebhookSecret.trim();
    if (!secret) {
      if (ENV.isProduction) {
        return { ok: false, reason: "TOSS_WEBHOOK_NOT_CONFIGURED" };
      }
      return { ok: false, reason: "MISSING_TOSS_WEBHOOK_SECRET" };
    }
    // TODO: Toss 웹훅 서명 검증 + 본문 파싱 후 PaymentSucceededEvent 생성
    return { ok: false, reason: "TOSS_WEBHOOK_NOT_IMPLEMENTED" };
  },
};
