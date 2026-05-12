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
  LemonWebhookDebugSummary,
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

/** Lemon checkout 전 필수 env 누락 시 billingRoute 가 한국어 메시지로 매핑 */
function assertLemonCheckoutEnv(packageId: CreditPackId): void {
  const missing: string[] = [];
  if (!ENV.lemonsqueezyApiKey.trim()) missing.push("LEMONSQUEEZY_API_KEY");
  if (!ENV.lemonsqueezyStoreId.trim()) missing.push("LEMONSQUEEZY_STORE_ID");
  const vid = variantIdForPackage(packageId);
  if (!vid) {
    const key =
      packageId === "starter"
        ? "LEMONSQUEEZY_CREDIT_PACK_STARTER_VARIANT_ID"
        : packageId === "standard"
          ? "LEMONSQUEEZY_CREDIT_PACK_STANDARD_VARIANT_ID"
          : "LEMONSQUEEZY_CREDIT_PACK_PRO_VARIANT_ID";
    missing.push(key);
  }
  if (!ENV.appBaseUrl.trim()) missing.push("APP_BASE_URL");
  if (missing.length) {
    throw new Error(`LEMON_ENV_MISSING:${missing.join(",")}`);
  }
}

function eventNameFromWebhook(
  headers: Record<string, string | string[] | undefined>,
  meta: Record<string, unknown> | undefined
): string {
  const rawHeader = headers["x-event-name"] ?? headers["X-Event-Name"];
  const headerEv = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof headerEv === "string" && headerEv.trim()) {
    return headerEv.trim();
  }
  return typeof meta?.event_name === "string" ? meta.event_name : "";
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

function jsonRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v) as unknown;
      if (p && typeof p === "object" && !Array.isArray(p)) {
        return p as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Lemon 문서: 주로 meta.custom_data, 일부 페이로드는 data.attributes.custom_data */
function mergeOrderCustomData(body: Record<string, unknown>): Record<string, unknown> {
  const meta = jsonRecord(body.meta) ?? {};
  const metaCd = meta.custom_data;
  const fromMeta = jsonRecord(metaCd) ?? {};
  const fromNested =
    metaCd && typeof metaCd === "object" && metaCd !== null && !Array.isArray(metaCd) && "data" in metaCd
      ? jsonRecord((metaCd as { data?: unknown }).data) ?? {}
      : {};

  const data = jsonRecord(body.data);
  const attrs = data ? (jsonRecord(data.attributes) ?? {}) : {};
  const fromAttrs = jsonRecord(attrs.custom_data) ?? {};

  const topData = jsonRecord(body.attributes) ?? {};
  const fromTop = jsonRecord(topData.custom_data) ?? {};

  return { ...fromMeta, ...fromNested, ...fromAttrs, ...fromTop };
}

function pickCustomString(custom: Record<string, unknown>, camel: string, snake: string): string | null {
  const v = custom[camel] ?? custom[snake];
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function buildWebhookDebugSummary(args: {
  eventName: string;
  body: Record<string, unknown>;
  custom: Record<string, unknown>;
}): LemonWebhookDebugSummary {
  const meta = jsonRecord(args.body.meta);
  const data = jsonRecord(args.body.data);
  const attrs = data ? (jsonRecord(data.attributes) ?? {}) : {};
  const topAttr = jsonRecord(args.body.attributes);
  const metaCd = meta?.custom_data;
  return {
    eventName: args.eventName,
    hasMetaCustomData:
      metaCd != null && metaCd !== "" && (typeof metaCd === "object" || typeof metaCd === "string"),
    hasDataAttributesCustomData: attrs.custom_data != null && attrs.custom_data !== "",
    hasAttributesCustomData: topAttr?.custom_data != null && topAttr.custom_data !== "",
    customDataKeys: Object.keys(args.custom),
    hasClerkUserId: !!(args.custom.clerkUserId ?? args.custom.clerk_user_id),
    hasCreditAmount: args.custom.creditAmount != null || args.custom.credit_amount != null,
    hasCreditPackageId: args.custom.creditPackageId != null || args.custom.credit_package_id != null,
    hasPaymentProvider: args.custom.paymentProvider != null || args.custom.payment_provider != null,
  };
}

export const lemonsqueezyProvider: PaymentProvider = {
  id: "lemonsqueezy",

  async createCreditCheckout(input: CreateCreditCheckoutInput): Promise<CreateCreditCheckoutResult> {
    assertLemonCheckoutEnv(input.packageId);

    const apiKey = ENV.lemonsqueezyApiKey.trim();
    const storeId = ENV.lemonsqueezyStoreId.trim();
    const variantId = variantIdForPackage(input.packageId);

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
              redirect_url: redirectUrl,
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
      throw new Error(`LEMONSQUEEZY_CHECKOUT_FAILED:${res.status}`);
    }

    const json = (await res.json()) as {
      data?: { attributes?: { url?: string } };
    };
    const url = json?.data?.attributes?.url;
    if (typeof url !== "string" || !url) {
      throw new Error("LEMONSQUEEZY_CHECKOUT_NO_URL");
    }

    console.info("[billing checkout lemonsqueezy]", {
      packageId: input.packageId,
      creditAmount,
      hasClerkUserId: Boolean(clerkUserId?.trim()),
      provider: "lemonsqueezy",
      hasCheckoutUrl: true,
    });

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

    const meta = jsonRecord(body.meta);
    const eventName = eventNameFromWebhook(req.headers, meta ?? undefined);
    const normalizedEvent = eventName.trim().toLowerCase();
    if (normalizedEvent !== "order_created") {
      return { ok: false, reason: "IGNORED_EVENT" };
    }

    const data = jsonRecord(body.data);
    const attrs = data ? (jsonRecord(data.attributes) ?? {}) : {};

    const custom = mergeOrderCustomData(body);

    if (Object.keys(custom).length === 0) {
      return {
        ok: false,
        reason: "MISSING_CUSTOM_DATA",
        debug: buildWebhookDebugSummary({ eventName, body, custom }),
      };
    }

    const ppRaw = pickCustomString(custom, "paymentProvider", "payment_provider");
    if (ppRaw && ppRaw.toLowerCase() !== "lemonsqueezy") {
      return {
        ok: false,
        reason: "INVALID_PAYMENT_PROVIDER",
        debug: buildWebhookDebugSummary({ eventName, body, custom }),
      };
    }

    const clerkUserId = pickCustomString(custom, "clerkUserId", "clerk_user_id");
    const creditPackageIdRaw = pickCustomString(custom, "creditPackageId", "credit_package_id");
    const creditPackageId = creditPackageIdRaw as CreditPackId | null;
    const creditAmountRaw = custom.creditAmount ?? custom.credit_amount;
    const creditAmount =
      typeof creditAmountRaw === "string"
        ? parseInt(creditAmountRaw, 10)
        : typeof creditAmountRaw === "number"
          ? creditAmountRaw
          : NaN;

    const packOk =
      creditPackageId === "starter" || creditPackageId === "standard" || creditPackageId === "pro";
    if (!clerkUserId?.trim() || !packOk) {
      return {
        ok: false,
        reason: "INVALID_CUSTOM_DATA",
        debug: buildWebhookDebugSummary({ eventName, body, custom }),
      };
    }
    if (!Number.isFinite(creditAmount) || creditAmount < 1) {
      return {
        ok: false,
        reason: "INVALID_CREDIT_AMOUNT",
        debug: buildWebhookDebugSummary({ eventName, body, custom }),
      };
    }

    const serverExpected = getCreditAmountForPackage(creditPackageId as CreditPackId);
    if (creditAmount !== serverExpected) {
      return {
        ok: false,
        reason: "CREDIT_AMOUNT_MISMATCH",
        debug: buildWebhookDebugSummary({ eventName, body, custom }),
      };
    }

    const webhookId = typeof meta?.webhook_id === "string" ? meta.webhook_id.trim() : null;
    const orderIdStr =
      data?.id !== undefined && data?.id !== null && String(data.id).trim() !== ""
        ? String(data.id).trim()
        : null;
    const identifierStr =
      attrs.identifier !== undefined && attrs.identifier !== null && String(attrs.identifier).trim() !== ""
        ? String(attrs.identifier).trim()
        : null;
    const checkoutIdStr =
      attrs.checkout_id !== undefined && attrs.checkout_id !== null && String(attrs.checkout_id).trim() !== ""
        ? String(attrs.checkout_id).trim()
        : null;

    /**
     * Idempotency / RPC 안정 키 (add_credits_from_payment 의 payment:<provider>:<stable>).
     * 우선순위: meta.webhook_id → data.id(주문 id) → attributes.identifier → attributes.checkout_id.
     * 실제 order_created 페이로드에서 webhook_id 가 주문마다 고유·안정적인지는 Lemon 대시보드/ngrok
     * Inspector 로 redaction 후 fixture 를 추가해 검증할 것 (README·docs/TODO 참고).
     */
    const stableOrderKey = orderIdStr ?? identifierStr ?? checkoutIdStr ?? null;
    const paymentEventId = webhookId ?? stableOrderKey;
    const paymentOrderId = stableOrderKey ?? webhookId;

    if (!paymentEventId?.trim() && !paymentOrderId?.trim()) {
      return {
        ok: false,
        reason: "MISSING_ORDER_IDENTIFIERS",
        debug: buildWebhookDebugSummary({ eventName, body, custom }),
      };
    }

    const event: PaymentSucceededEvent = {
      provider: "lemonsqueezy",
      paymentEventId: paymentEventId ?? paymentOrderId ?? null,
      paymentOrderId: paymentOrderId ?? paymentEventId ?? null,
      paymentCheckoutId: checkoutIdStr,
      clerkUserId: clerkUserId.trim(),
      creditAmount: serverExpected,
      creditPackageId: creditPackageId as CreditPackId,
      description: `Lemon Squeezy 크레딧 팩 (${creditPackageId})`,
    };

    return { ok: true, rawBody: raw, event };
  },
};
