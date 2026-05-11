/**
 * Lemon Squeezy — 해외 카드 결제 (글로벌).
 * @see https://docs.lemonsqueezy.com/api/checkouts#create-a-checkout
 */

import { createHmac, timingSafeEqual } from "crypto";
import { ENV } from "../_core/env";
import { walletSubjectFromAuthUser } from "../creditService";
import type {
  CreateCreditCheckoutInput,
  CreateCreditCheckoutResult,
  CreditPackId,
  PaymentProvider,
  PaymentSucceededEvent,
  PaymentWebhookVerifyResult,
} from "./types";
import { getCreditAmountForPackage } from "./packages";

const LEMON_API = "https://api.lemonsqueezy.com/v1";

function variantIdForPackage(packageId: CreditPackId): string {
  const map: Record<CreditPackId, string> = {
    starter: ENV.lemonsqueezyCreditPackStarterVariantId.trim(),
    standard: ENV.lemonsqueezyCreditPackStandardVariantId.trim(),
    pro: ENV.lemonsqueezyCreditPackProVariantId.trim(),
  };
  return map[packageId];
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export const lemonsqueezyProvider: PaymentProvider = {
  id: "lemonsqueezy",

  async createCreditCheckout(input: CreateCreditCheckoutInput): Promise<CreateCreditCheckoutResult> {
    const apiKey = ENV.lemonsqueezyApiKey.trim();
    const storeId = ENV.lemonsqueezyStoreId.trim();
    const variantId = variantIdForPackage(input.packageId);
    if (!apiKey || !storeId || !variantId) {
      throw new Error("LEMONSQUEEZY_NOT_CONFIGURED");
    }

    const clerkUserId = walletSubjectFromAuthUser(input.user);
    const creditAmount = getCreditAmountForPackage(input.packageId);
    const redirectUrl = `${input.baseUrl.replace(/\/$/, "")}/?billing=success`;

    const res = await fetch(`${LEMON_API}/checkouts`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        data: {
          type: "checkouts",
          attributes: {
            checkout_data: {
              email: input.user.email ?? undefined,
              custom: {
                clerkUserId,
                creditPackageId: input.packageId,
                creditAmount: String(creditAmount),
                paymentProvider: "lemonsqueezy",
              },
            },
            product_options: {
              name: `KataTalk credits (${input.packageId})`,
            },
          },
          relationships: {
            store: {
              data: { type: "stores", id: storeId },
            },
            variant: {
              data: { type: "variants", id: variantId },
            },
          },
        },
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`LEMONSQUEEZY_CHECKOUT_FAILED:${res.status}:${t.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      data?: { attributes?: { url?: string } };
    };
    const url = json?.data?.attributes?.url;
    if (typeof url !== "string" || !url) {
      throw new Error("LEMONSQUEEZY_CHECKOUT_NO_URL");
    }

    return {
      provider: "lemonsqueezy",
      url,
      creditAmount,
      creditPackageId: input.packageId,
    };
  },

  async verifyWebhookAndExtractEvent(req: {
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<PaymentWebhookVerifyResult> {
    const secret = ENV.lemonsqueezyWebhookSecret.trim();
    if (!secret) {
      if (ENV.isProduction) {
        return { ok: false, reason: "LEMONSQUEEZY_WEBHOOK_NOT_CONFIGURED" };
      }
      return { ok: false, reason: "MISSING_LEMONSQUEEZY_WEBHOOK_SECRET" };
    }

    const raw = req.rawBody.toString("utf8");
    const sigHeader = req.headers["x-signature"] ?? req.headers["X-Signature"];
    const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    if (typeof sig !== "string" || !sig) {
      return { ok: false, reason: "MISSING_SIGNATURE" };
    }

    const expected = createHmac("sha256", secret).update(req.rawBody).digest("hex");
    if (!safeEqualHex(expected, sig)) {
      return { ok: false, reason: "INVALID_SIGNATURE" };
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ok: false, reason: "INVALID_JSON" };
    }

    const meta = body.meta as Record<string, unknown> | undefined;
    const eventName = typeof meta?.event_name === "string" ? meta.event_name : "";
    if (eventName !== "order_created") {
      return { ok: false, reason: "IGNORED_EVENT" };
    }

    const data = body.data as Record<string, unknown> | undefined;
    const attrs = (data?.attributes as Record<string, unknown> | undefined) ?? {};
    const orderId = typeof data?.id === "string" ? data.id : null;

    const custom = attrs.custom_data as Record<string, unknown> | undefined;

    const clerkUserId =
      typeof custom?.clerkUserId === "string"
        ? custom.clerkUserId
        : typeof custom?.clerk_user_id === "string"
          ? (custom.clerk_user_id as string)
          : null;
    const creditPackageId =
      typeof custom?.creditPackageId === "string"
        ? custom.creditPackageId
        : typeof custom?.credit_package_id === "string"
          ? (custom.credit_package_id as string)
          : null;
    const creditAmountRaw = custom?.creditAmount ?? custom?.credit_amount;
    const creditAmount =
      typeof creditAmountRaw === "string"
        ? parseInt(creditAmountRaw, 10)
        : typeof creditAmountRaw === "number"
          ? creditAmountRaw
          : NaN;

    const packOk =
      creditPackageId === "starter" || creditPackageId === "standard" || creditPackageId === "pro";
    if (!clerkUserId?.trim() || !packOk) {
      return { ok: false, reason: "INVALID_CUSTOM_DATA" };
    }
    if (!Number.isFinite(creditAmount) || creditAmount < 1) {
      return { ok: false, reason: "INVALID_CREDIT_AMOUNT" };
    }

    const serverExpected = getCreditAmountForPackage(creditPackageId as CreditPackId);
    if (creditAmount !== serverExpected) {
      return { ok: false, reason: "CREDIT_AMOUNT_MISMATCH" };
    }

    const webhookId = typeof meta?.webhook_id === "string" ? meta.webhook_id : null;
    const event: PaymentSucceededEvent = {
      provider: "lemonsqueezy",
      paymentEventId: webhookId ?? orderId,
      paymentOrderId: orderId,
      paymentCheckoutId: typeof attrs.checkout_id === "string" ? (attrs.checkout_id as string) : null,
      clerkUserId: clerkUserId.trim(),
      creditAmount: serverExpected,
      creditPackageId: creditPackageId as CreditPackId,
      description: `Lemon Squeezy 크레딧 팩 (${creditPackageId})`,
    };

    return { ok: true, rawBody: raw, event };
  },
};
