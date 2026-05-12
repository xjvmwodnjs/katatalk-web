// =============================================================
// /api/billing — Toss Payments + Lemon Squeezy (크레딧 팩, webhook 전용 충전)
// =============================================================
//
// - Stripe 미사용. credits 증가는 success URL 이 아니라 provider webhook 에서만.
// - express.json() 보다 앞에 raw body 웹훅 라우트를 등록한다.

import type { Express, Request, Response } from "express";
import express, { Router } from "express";
import { z } from "zod";
import {
  addCreditsFromPaymentWebhook,
  ensureProfileForClerkUser,
  fetchCreditLogIdByIdempotencyKey,
  walletSubjectFromAuthUser,
} from "./creditService";
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

function maskClerkUserId(id: string): string {
  const t = id.trim();
  if (t.length <= 8) return "(masked)";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

/** Lemon verify 실패 시 HTTP 상태 — 무관 이벤트만 200 */
function lemonWebhookVerifyFailureStatus(reason: string): number {
  switch (reason) {
    case "IGNORED_EVENT":
      return 200;
    case "MISSING_SIGNATURE":
    case "INVALID_SIGNATURE":
    case "MISSING_LEMONSQUEEZY_WEBHOOK_SECRET":
      return 401;
    case "MISSING_ORDER_IDENTIFIERS":
      return 500;
    case "MISSING_CUSTOM_DATA":
    case "INVALID_CUSTOM_DATA":
    case "INVALID_CREDIT_AMOUNT":
    case "CREDIT_AMOUNT_MISMATCH":
    case "INVALID_PAYMENT_PROVIDER":
      return 422;
    default:
      return 400;
  }
}

function peekMetaEventNameFromWebhookBody(rawBody: Buffer): string {
  try {
    const j = JSON.parse(rawBody.toString("utf8")) as { meta?: { event_name?: string } };
    return typeof j.meta?.event_name === "string" ? j.meta.event_name : "";
  } catch {
    return "";
  }
}

/** NODE_ENV=production 이 아닐 때만 응답 body 에 디버그 요약 포함 */
function lemonWebhookExposeDebugInBody(): boolean {
  return !ENV.isProduction;
}

/**
 * POST /api/billing/webhook/lemonsqueezy 가 200을 반환하는 경우:
 * - ignored_non_target_event: order_created 가 아닌 Lemon 이벤트
 * - duplicate: 동일 idempotency 키로 이미 refill 처리됨
 * - granted: Supabase RPC 성공·잔액 반영
 *
 * order_created 인데 custom 불충분·지급 실패·프로필 없음 등은 200 금지.
 */
function sendLemonWebhookJson(res: Response, status: number, payload: Record<string, unknown>): void {
  if (lemonWebhookExposeDebugInBody()) {
    res.status(status).json(payload);
    return;
  }
  const received = payload.received;
  const action = payload.action;
  const minimal: Record<string, unknown> = {
    received: typeof received === "boolean" ? received : false,
    action: typeof action === "string" ? action : "system_error",
  };
  if (typeof payload.duplicate === "boolean") {
    minimal.duplicate = payload.duplicate;
  }
  if (typeof payload.reason === "string" && payload.reason.length > 0) {
    minimal.reason = payload.reason;
  }
  res.status(status).json(minimal);
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
        const status = lemonWebhookVerifyFailureStatus(v.reason);
        const eventNamePeek = peekMetaEventNameFromWebhookBody(rawBody);
        if (status === 200) {
          sendLemonWebhookJson(res, 200, {
            received: true,
            action: "ignored_non_target_event",
            eventName: eventNamePeek || "(unknown)",
            paymentProvider: "lemonsqueezy",
            grantOk: false,
            grantDuplicate: false,
          });
          return;
        }
        if (v.debug) {
          console.warn("[billing webhook lemonsqueezy] verify rejected", {
            reason: v.reason,
            ...v.debug,
          });
        } else {
          console.warn("[billing webhook lemonsqueezy] verify rejected", { reason: v.reason });
        }
        const verifyAction =
          v.reason === "MISSING_CUSTOM_DATA" ? "missing_custom_data" : "verify_failed";
        sendLemonWebhookJson(res, status, {
          received: false,
          action: verifyAction,
          reason: v.reason,
          eventName: v.debug?.eventName ?? eventNamePeek,
          paymentProvider: "lemonsqueezy",
          hasCustomData: Boolean(v.debug?.customDataKeys?.length),
          customDataKeys: v.debug?.customDataKeys ?? [],
          hasMetaCustomData: v.debug?.hasMetaCustomData ?? false,
          hasDataAttributesCustomData: v.debug?.hasDataAttributesCustomData ?? false,
          hasAttributesCustomData: v.debug?.hasAttributesCustomData ?? false,
          grantOk: false,
          grantDuplicate: false,
        });
        return;
      }

      const ev = v.event;
      const stable = ev.paymentEventId ?? ev.paymentOrderId;
      if (!stable?.trim()) {
        console.error("[billing webhook lemonsqueezy] missing stable payment id", {
          provider: "lemonsqueezy",
          payment_event_id: ev.paymentEventId,
          payment_order_id: ev.paymentOrderId,
        });
        sendLemonWebhookJson(res, 500, {
          received: false,
          action: "grant_failed",
          reason: "MISSING_STABLE_PAYMENT_ID",
          paymentProvider: "lemonsqueezy",
          grantOk: false,
          grantDuplicate: false,
        });
        return;
      }
      const idem = paymentIdempotencyKey("lemonsqueezy", stable.trim());

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

      console.info("[billing webhook lemonsqueezy] grant result", {
        provider: "lemonsqueezy",
        payment_event_id: ev.paymentEventId,
        payment_order_id: ev.paymentOrderId,
        credit_package_id: ev.creditPackageId,
        credit_amount: ev.creditAmount,
        clerk_user_masked: maskClerkUserId(ev.clerkUserId),
        idempotency_key: idem,
        grant_ok: grant.ok,
        grant_duplicate: grant.duplicate,
        grant_credits: grant.credits,
        grant_error_code: grant.errorCode,
      });

      const commonDevFields = {
        eventName: "order_created",
        paymentProvider: "lemonsqueezy",
        paymentEventIdPresent: Boolean(ev.paymentEventId?.trim()),
        paymentOrderIdPresent: Boolean(ev.paymentOrderId?.trim()),
        idempotencyKeyPreview: idem.length > 56 ? `${idem.slice(0, 28)}…${idem.slice(-14)}` : idem,
        grantOk: grant.ok,
        grantDuplicate: grant.duplicate,
        grantCredits: grant.credits,
        grantErrorCode: grant.errorCode,
      };

      if (grant.duplicate) {
        console.warn("[billing webhook lemonsqueezy] duplicate idempotency", {
          provider: "lemonsqueezy",
          payment_event_id: ev.paymentEventId,
          payment_order_id: ev.paymentOrderId,
          clerk_user_masked: maskClerkUserId(ev.clerkUserId),
          idempotency_key: idem,
        });
        sendLemonWebhookJson(res, 200, {
          received: true,
          action: "duplicate",
          duplicate: true,
          reason: "IDEMPOTENCY_DUPLICATE",
          ...commonDevFields,
        });
        return;
      }

      if (grant.ok === true && grant.credits !== null) {
        if (lemonWebhookExposeDebugInBody()) {
          let logId: string | null = null;
          try {
            logId = await fetchCreditLogIdByIdempotencyKey(idem);
          } catch (e) {
            console.error("[billing webhook lemonsqueezy] credit_logs lookup failed", {
              idempotency_key: idem,
              message: e instanceof Error ? e.message : String(e),
            });
            sendLemonWebhookJson(res, 500, {
              received: false,
              action: "grant_failed",
              reason: "CREDIT_LOG_VERIFY_FAILED",
              ...commonDevFields,
            });
            return;
          }
          if (!logId) {
            console.error("[billing webhook lemonsqueezy] RPC ok but credit_logs row missing", {
              idempotency_key: idem,
            });
            sendLemonWebhookJson(res, 500, {
              received: false,
              action: "grant_failed",
              reason: "CREDIT_LOG_MISSING_AFTER_RPC",
              ...commonDevFields,
            });
            return;
          }
        }
        sendLemonWebhookJson(res, 200, {
          received: true,
          action: "granted",
          ...commonDevFields,
        });
        return;
      }

      if (grant.errorCode === "PROFILE_NOT_FOUND") {
        console.error("[billing webhook lemonsqueezy] profile not found for payment user", {
          clerk_user_masked: maskClerkUserId(ev.clerkUserId),
          payment_order_id: ev.paymentOrderId,
        });
        sendLemonWebhookJson(res, 422, {
          received: false,
          action: "profile_not_found",
          reason: "PROFILE_NOT_FOUND",
          ...commonDevFields,
        });
        return;
      }

      console.error("[billing webhook lemonsqueezy] credit grant not applied", {
        provider: "lemonsqueezy",
        payment_event_id: ev.paymentEventId,
        payment_order_id: ev.paymentOrderId,
        clerk_user_masked: maskClerkUserId(ev.clerkUserId),
        reason: "ADD_CREDITS_NOT_OK",
        grant_error_code: grant.errorCode,
        idempotency_key: idem,
      });
      sendLemonWebhookJson(res, 500, {
        received: false,
        action: "grant_failed",
        reason: grant.errorCode ?? "ADD_CREDITS_NOT_OK",
        ...commonDevFields,
      });
    } catch {
      sendLemonWebhookJson(res, 500, {
        received: false,
        action: "system_error",
        reason: "UNCAUGHT",
        paymentProvider: "lemonsqueezy",
        grantOk: false,
        grantDuplicate: false,
      });
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
        await ensureProfileForClerkUser(user);
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
