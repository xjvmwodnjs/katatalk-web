// =============================================================
// /api/billing — Stripe Checkout mode=payment (크레딧 팩) + webhook
// =============================================================
//
// - subscription mode / Clerk Billing 미사용
// - credits 증가는 checkout.session.completed webhook + Supabase RPC 만

import type { Express, Request, Response } from "express";
import express, { Router } from "express";
import Stripe from "stripe";
import { z } from "zod";
import { ENV } from "./_core/env";
import { addCreditsFromStripeWebhook, walletSubjectFromAuthUser } from "./creditService";
import {
  ANALYZE_AUTH_REQUIRED_MESSAGE,
  requireAnalyzeAuth,
} from "./middleware/requireAnalyzeAuth";

export const checkoutPackageBodySchema = z.object({
  packageId: z.enum(["starter", "standard", "pro"]),
});

export type CreditPackId = z.infer<typeof checkoutPackageBodySchema>["packageId"];

const PACK_TO_PRICE_ENV: Record<
  CreditPackId,
  keyof Pick<
    typeof ENV,
    "stripeCreditPackStarterPriceId" | "stripeCreditPackStandardPriceId" | "stripeCreditPackProPriceId"
  >
> = {
  starter: "stripeCreditPackStarterPriceId",
  standard: "stripeCreditPackStandardPriceId",
  pro: "stripeCreditPackProPriceId",
};

/** 서버 전용 — 클라이언트는 packageId 만 전달 */
export const CREDIT_PACK_CREDITS: Record<CreditPackId, number> = {
  starter: 50,
  standard: 120,
  pro: 300,
};

let stripeClient: Stripe | null | undefined;

function getStripe(): Stripe | null {
  if (stripeClient !== undefined) {
    return stripeClient;
  }
  const key = ENV.stripeSecretKey.trim();
  if (!key) {
    stripeClient = null;
    return null;
  }
  stripeClient = new Stripe(key);
  return stripeClient;
}

/** Stripe webhook 은 JSON raw body 가 필요하므로 전역 express.json() 보다 먼저 등록한다. */
export function attachBillingWebhook(app: Express): void {
  app.post(
    "/api/billing/webhook",
    express.raw({ type: "application/json" }),
    stripeWebhookHandler
  );
}

function stripeWebhookHandler(req: Request, res: Response): void {
  void (async () => {
    const webhookSecret = ENV.stripeWebhookSecret.trim();
    const stripe = getStripe();
    const sig = req.headers["stripe-signature"];

    if (!webhookSecret || !stripe) {
      res.status(400).json({ received: false });
      return;
    }
    if (typeof sig !== "string") {
      res.status(400).json({ received: false });
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
    } catch {
      res.status(400).json({ received: false });
      return;
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "payment") {
          res.json({ received: true });
          return;
        }
        if (session.payment_status !== "paid") {
          res.json({ received: true });
          return;
        }

        const meta = session.metadata ?? {};
        const clerkUserId = meta.clerkUserId ?? meta.clerk_user_id;
        const creditAmountRaw = meta.creditAmount ?? meta.credit_amount;
        const packId = meta.creditPackageId ?? meta.credit_package_id;

        if (typeof clerkUserId !== "string" || !clerkUserId.trim()) {
          console.error("[billing/webhook] missing clerkUserId in session metadata");
          res.status(400).json({ received: false });
          return;
        }
        const creditAmount =
          typeof creditAmountRaw === "string"
            ? parseInt(creditAmountRaw, 10)
            : typeof creditAmountRaw === "number"
              ? creditAmountRaw
              : NaN;
        if (!Number.isFinite(creditAmount) || creditAmount < 1) {
          console.error("[billing/webhook] invalid creditAmount in metadata");
          res.status(400).json({ received: false });
          return;
        }

        await addCreditsFromStripeWebhook({
          clerkUserId: clerkUserId.trim(),
          amount: creditAmount,
          stripeEventId: typeof event.id === "string" ? event.id : null,
          stripeSessionId: typeof session.id === "string" ? session.id : null,
          description:
            typeof packId === "string"
              ? `Stripe 크레딧 팩 충전 (${packId})`
              : "Stripe 크레딧 팩 충전",
        });
      }
      // customer.subscription.* 등 구독 이벤트는 크레딧 모델에서 사용하지 않음
      res.json({ received: true });
    } catch (e) {
      console.error("[billing/webhook] handler error");
      res.status(500).json({ received: false });
    }
  })();
}

function createCheckoutSession(req: Request, res: Response): void {
  void (async () => {
    try {
      const user = req.katatalkUser;
      if (!user) {
        res.status(401).json({ success: false, message: ANALYZE_AUTH_REQUIRED_MESSAGE });
        return;
      }

      const parsed = checkoutPackageBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          message: "packageId는 starter, standard, pro 중 하나여야 합니다.",
        });
        return;
      }

      const stripe = getStripe();
      if (!stripe) {
        res.status(503).json({
          success: false,
          message: "결제 서비스가 아직 설정되지 않았습니다.",
        });
        return;
      }

      const { packageId } = parsed.data;
      const creditAmount = CREDIT_PACK_CREDITS[packageId];
      const envKey = PACK_TO_PRICE_ENV[packageId];
      const priceId = ENV[envKey].trim();
      if (!priceId) {
        res.status(503).json({
          success: false,
          message: "해당 크레딧 팩의 Stripe Price ID가 서버에 설정되지 않았습니다.",
        });
        return;
      }

      const base = ENV.appBaseUrl.replace(/\/$/, "");
      const clerkUserId = walletSubjectFromAuthUser(user);

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${base}/?billing=success`,
        cancel_url: `${base}/?billing=cancel`,
        customer_email: user.email ?? undefined,
        metadata: {
          clerkUserId,
          creditPackageId: packageId,
          creditAmount: String(creditAmount),
        },
      });

      if (!session.url) {
        res.status(500).json({
          success: false,
          message: "결제 세션을 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        });
        return;
      }

      res.json({ success: true, url: session.url });
    } catch (e) {
      console.error("[billing/create-checkout-session] error");
      res.status(500).json({
        success: false,
        message: "결제 세션을 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      });
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
    message: "구독 상태 대신 Supabase profiles.credits 를 사용합니다. (GET /api/credits/me)",
    userId: walletSubjectFromAuthUser(user),
  });
}

export const billingRouter = Router();
billingRouter.post(
  "/api/billing/create-checkout-session",
  requireAnalyzeAuth,
  createCheckoutSession
);
billingRouter.get("/api/billing/status", requireAnalyzeAuth, getBillingStatus);
