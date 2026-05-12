// =============================================================
// /api/billing — Toss Payments + Lemon Squeezy (크레딧 팩, webhook 전용 충전)
// =============================================================
//
// - Stripe 미사용. credits 증가는 success URL 이 아니라 provider webhook 에서만.
// - express.json() 보다 앞에 raw body 웹훅 라우트를 등록한다.

import type { Express, Request, Response } from "express";
import express, { Router } from "express";
import { z } from "zod";
import { addCreditsFromPaymentWebhook, walletSubjectFromAuthUser } from "./creditService";
import {
  ANALYZE_AUTH_REQUIRED_MESSAGE,
  requireAnalyzeAuth,
} from "./middleware/requireAnalyzeAuth";
import { ENV } from "./_core/env";
import {
  getPaymentProvider,
  resolveCheckoutProvider,
  type PaymentProviderId,
  type UiLocale,
} from "./paymentProviders";

export const createCheckoutBodySchema = z
  .object({
    packageId: z.enum(["starter", "standard", "pro"]),
    provider: z.enum(["toss", "lemonsqueezy"]).optional(),
    locale: z.enum(["ko", "en", "zh", "ja"]).optional(),
  })
  .strict();

export type CreateCheckoutBody = z.infer<typeof createCheckoutBodySchema>;

function paymentIdempotencyKey(provider: PaymentProviderId, stableId: string): string {
  return `payment:${provider}:${stableId}`;
}

function sendBillingError(res: Response, status: number, message: string, code?: string): void {
  const body: { success: false; message: string; code?: string } = { success: false, message };
  if (code) body.code = code;
  res.status(status).json(body);
}

/** Lemon Squeezy / Toss 웹훅 — raw body 로 서명 검증 */
export function attachPaymentWebhooks(app: Express): void {
  app.post("/api/billing/webhook/toss", express.raw({ type: "*/*" }), tossWebhookHandler);
  app.post(
    "/api/billing/webhook/lemonsqueezy",
    express.raw({ type: "*/*" }),
    lemonsqueezyWebhookHandler
  );
}

function tossWebhookHandler(req: Request, res: Response): void {
  void (async () => {
    try {
      const secret = ENV.tossWebhookSecret.trim();
      if (!secret && ENV.isProduction) {
        res.status(503).json({ received: false });
        return;
      }
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? ""));
      const v = await getPaymentProvider("toss").verifyWebhookAndExtractEvent({
        rawBody,
        headers: req.headers as Record<string, string | string[] | undefined>,
      });
      if (!v.ok) {
        if (
          v.reason === "TOSS_WEBHOOK_NOT_IMPLEMENTED" ||
          (!ENV.isProduction && v.reason === "MISSING_TOSS_WEBHOOK_SECRET")
        ) {
          res.status(200).json({ received: true, skipped: true });
          return;
        }
        if (v.reason === "TOSS_WEBHOOK_NOT_CONFIGURED") {
          res.status(503).json({ received: false });
          return;
        }
        res.status(400).json({ received: false });
        return;
      }
      // TODO: Toss 검증 성공 시 addCreditsFromPaymentWebhook 호출
      res.status(200).json({ received: true });
    } catch {
      res.status(500).json({ received: false });
    }
  })();
}

function lemonsqueezyWebhookHandler(req: Request, res: Response): void {
  void (async () => {
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? ""));
      const v = await getPaymentProvider("lemonsqueezy").verifyWebhookAndExtractEvent({
        rawBody,
        headers: req.headers as Record<string, string | string[] | undefined>,
      });
      if (!v.ok) {
        const unauthorized =
          v.reason === "MISSING_SIGNATURE" ||
          v.reason === "INVALID_SIGNATURE" ||
          v.reason === "MISSING_LEMONSQUEEZY_WEBHOOK_SECRET";
        const status = unauthorized ? 401 : v.reason === "IGNORED_EVENT" ? 200 : 400;
        if (status === 200) {
          res.status(200).json({ received: true, ignored: true });
          return;
        }
        res.status(status).json({ received: false });
        return;
      }

      const ev = v.event;
      const stable = ev.paymentEventId ?? ev.paymentOrderId ?? "unknown";
      const idem = paymentIdempotencyKey("lemonsqueezy", stable);

      const grant = await addCreditsFromPaymentWebhook({
        clerkUserId: ev.clerkUserId,
        amount: ev.creditAmount,
        idempotencyKey: idem,
        paymentProvider: "lemonsqueezy",
        paymentEventId: ev.paymentEventId,
        paymentOrderId: ev.paymentOrderId,
        paymentCheckoutId: ev.paymentCheckoutId,
        description: ev.description,
      });

      if (grant.duplicate) {
        res.status(200).json({ received: true, duplicate: true });
        return;
      }

      if (grant.ok === true && grant.credits !== null) {
        res.status(200).json({ received: true });
        return;
      }

      console.error("[billing webhook lemonsqueezy] credit grant not applied", {
        provider: "lemonsqueezy",
        payment_event_id: ev.paymentEventId,
        payment_order_id: ev.paymentOrderId,
        clerk_user_id: ev.clerkUserId,
        reason: "ADD_CREDITS_NOT_OK",
      });
      res.status(500).json({ received: false });
    } catch {
      res.status(500).json({ received: false });
    }
  })();
}

function createCheckoutHandler(req: Request, res: Response): void {
  void (async () => {
    try {
      const user = req.katatalkUser;
      if (!user) {
        res.status(401).json({ success: false, message: ANALYZE_AUTH_REQUIRED_MESSAGE });
        return;
      }

      const parsed = createCheckoutBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendBillingError(
          res,
          400,
          "packageId·provider·locale 형식이 올바르지 않습니다. 임의의 금액·variant 필드는 전송할 수 없습니다.",
          "CHECKOUT_VALIDATION"
        );
        return;
      }

      const { packageId, provider: bodyProvider, locale } = parsed.data;
      const uiLocale: UiLocale = locale ?? "en";

      if (bodyProvider === "toss") {
        sendBillingError(
          res,
          400,
          "Toss 결제는 아직 준비 중입니다. Lemon Squeezy 로 결제해 주세요.",
          "CHECKOUT_TOSS_DISABLED"
        );
        return;
      }

      const providerId = resolveCheckoutProvider(bodyProvider, uiLocale);

      const baseUrl = ENV.appBaseUrl.replace(/\/$/, "");
      const impl = getPaymentProvider(providerId);

      try {
        const out = await impl.createCreditCheckout({
          user,
          packageId,
          provider: providerId,
          locale: uiLocale,
          baseUrl,
        });
        res.json({
          success: true,
          provider: out.provider,
          creditAmount: out.creditAmount,
          creditPackageId: out.creditPackageId,
          url: out.url,
          checkoutPayload: out.checkoutPayload,
        });
      } catch (e) {
        const code = e instanceof Error ? e.message : "";
        if (code.startsWith("LEMON_ENV_MISSING:")) {
          sendBillingError(
            res,
            503,
            "Lemon Squeezy 결제에 필요한 서버 설정이 누락되었습니다. APP_BASE_URL·API 키·스토어 ID·variant ID를 확인하거나 관리자에게 문의해 주세요.",
            "CHECKOUT_LEMON_CONFIG"
          );
          return;
        }
        if (
          code === "LEMONSQUEEZY_CHECKOUT_NO_URL" ||
          code.startsWith("LEMONSQUEEZY_CHECKOUT_FAILED:")
        ) {
          sendBillingError(
            res,
            503,
            "Lemon Squeezy 결제 세션을 만들 수 없습니다. 상품·variant 설정을 확인하거나 잠시 후 다시 시도해 주세요.",
            "CHECKOUT_LEMON_API"
          );
          return;
        }
        sendBillingError(res, 503, "결제를 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.", "CHECKOUT_GENERIC");
      }
    } catch {
      sendBillingError(res, 500, "결제를 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.", "CHECKOUT_INTERNAL");
    }
  })();
}

function getBillingStatus(req: Request, res: Response): void {
  const user = req.katatalkUser;
  if (!user) {
    res.status(401).json({ success: false, message: ANALYZE_AUTH_REQUIRED_MESSAGE });
    return;
  }
  res.json({
    success: true,
    message: "크레딧은 Supabase profiles + webhook 충전을 사용합니다. (GET /api/credits/me)",
    userId: walletSubjectFromAuthUser(user),
  });
}

export const billingRouter = Router();
billingRouter.post("/api/billing/create-checkout", requireAnalyzeAuth, createCheckoutHandler);
billingRouter.get("/api/billing/status", requireAnalyzeAuth, getBillingStatus);
