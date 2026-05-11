// =============================================================
// /api/billing — Stripe Checkout 구독 골격 (test mode 기준)
// =============================================================
//
// - create-checkout-session: Clerk(등) 인증 필수, plan만 받고 서버가 Price ID 선택
// - webhook: raw body + Stripe-Signature 검증 필수
// - quota·DB 영구 반영은 TODO (스키마 변경 없이 주석만)

import type { Express, Request, Response } from "express";
import express, { Router } from "express";
import Stripe from "stripe";
import { z } from "zod";
import { ENV } from "./_core/env";
import {
  ANALYZE_AUTH_REQUIRED_MESSAGE,
  requireAnalyzeAuth,
} from "./middleware/requireAnalyzeAuth";

const checkoutBodySchema = z.object({
  plan: z.enum(["basic", "premium"]),
});

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
      switch (event.type) {
        case "checkout.session.completed":
          // TODO: users 테이블(또는 별도 subscriptions 테이블)에 plan·stripeCustomerId·stripeSubscriptionId 저장 후 quota 연동
          break;
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          // TODO: Stripe subscription status → 앱 구독 상태 동기화 (DB 스키마 확정 후)
          break;
        default:
          break;
      }
      res.json({ received: true });
    } catch (e) {
      console.error("[billing/webhook]", e);
      res.status(500).json({ received: false });
    }
  })();
}

function createCheckoutSession(req: Request, res: Response): void {
  void (async () => {
    try {
      const stripe = getStripe();
      if (!stripe) {
        res.status(503).json({
          success: false,
          message: "결제 서비스가 아직 설정되지 않았습니다.",
        });
        return;
      }

      const user = req.katatalkUser;
      if (!user) {
        res.status(401).json({ success: false, message: ANALYZE_AUTH_REQUIRED_MESSAGE });
        return;
      }

      const parsed = checkoutBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          message: "plan은 basic 또는 premium 이어야 합니다.",
        });
        return;
      }

      const { plan } = parsed.data;
      const priceId =
        plan === "basic"
          ? ENV.stripeBasicPriceId.trim()
          : ENV.stripePremiumPriceId.trim();
      if (!priceId) {
        res.status(503).json({
          success: false,
          message: "요금제 가격이 서버에 설정되지 않았습니다.",
        });
        return;
      }

      const base = ENV.appBaseUrl.replace(/\/$/, "");
      const clerkUserId = user.openId.startsWith("clerk:")
        ? user.openId.slice("clerk:".length)
        : user.openId;

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${base}/?billing=success`,
        cancel_url: `${base}/?billing=cancel`,
        customer_email: user.email ?? undefined,
        metadata: {
          clerk_user_id: clerkUserId,
          app_user_id: String(user.id),
          plan,
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
      console.error("[billing/create-checkout-session]", e);
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
  // TODO: Stripe/DB 기반 실제 구독 상태 조회로 교체
  res.json({
    success: true,
    mock: true,
    message: "결제 골격 단계입니다. 구독·quota는 webhook·DB 연동 후 반영됩니다.",
    userId: user.id,
  });
}

export const billingRouter = Router();
billingRouter.post("/api/billing/create-checkout-session", requireAnalyzeAuth, createCheckoutSession);
billingRouter.get("/api/billing/status", requireAnalyzeAuth, getBillingStatus);
