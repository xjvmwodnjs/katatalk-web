import { createHmac } from "crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lemonsqueezyProvider } from "./paymentProviders/lemonsqueezyProvider";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lemonOrderCreatedFixturePath = path.join(
  __dirname,
  "fixtures",
  "lemonsqueezy",
  "order_created.redacted.json"
);

describe("Lemon Squeezy webhook verify", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails without X-Signature", async () => {
    const v = await lemonsqueezyProvider.verifyWebhookAndExtractEvent({
      rawBody: Buffer.from("{}"),
      headers: {},
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("MISSING_SIGNATURE");
  });

  it("fails on signature mismatch", async () => {
    const raw = Buffer.from('{"meta":{"event_name":"order_created"}}', "utf8");
    const v = await lemonsqueezyProvider.verifyWebhookAndExtractEvent({
      rawBody: raw,
      headers: { "x-signature": "deadbeef" },
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("INVALID_SIGNATURE");
  });

  it("order_created with valid HMAC and custom_data yields event", async () => {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "";
    const body = {
      meta: { event_name: "order_created", webhook_id: "wh_ls_test_1" },
      data: {
        type: "orders",
        id: "order_ls_test_1",
        attributes: {
          custom_data: {
            clerkUserId: "user_test_sub",
            creditPackageId: "starter",
            creditAmount: "20",
            paymentProvider: "lemonsqueezy",
          },
        },
      },
    };
    const rawStr = JSON.stringify(body);
    const sig = createHmac("sha256", secret).update(rawStr, "utf8").digest("hex");
    const v = await lemonsqueezyProvider.verifyWebhookAndExtractEvent({
      rawBody: Buffer.from(rawStr, "utf8"),
      headers: { "x-signature": sig },
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.event.clerkUserId).toBe("user_test_sub");
      expect(v.event.creditAmount).toBe(20);
      expect(v.event.paymentEventId).toBe("order_ls_test_1");
      expect(v.event.paymentOrderId).toBe("order_ls_test_1");
    }
  });

  it("rejects tampered creditAmount vs server pack config", async () => {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "";
    const body = {
      meta: { event_name: "order_created", webhook_id: "wh_ls_tamper" },
      data: {
        type: "orders",
        id: "order_ls_tamper",
        attributes: {
          custom_data: {
            clerkUserId: "user_test_sub",
            creditPackageId: "starter",
            creditAmount: "9999",
            paymentProvider: "lemonsqueezy",
          },
        },
      },
    };
    const rawStr = JSON.stringify(body);
    const sig = createHmac("sha256", secret).update(rawStr, "utf8").digest("hex");
    const v = await lemonsqueezyProvider.verifyWebhookAndExtractEvent({
      rawBody: Buffer.from(rawStr, "utf8"),
      headers: { "x-signature": sig },
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("CREDIT_AMOUNT_MISMATCH");
  });

  it("order_created with no custom_data yields MISSING_CUSTOM_DATA", async () => {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "";
    const body = {
      meta: { event_name: "order_created", webhook_id: "wh_empty_custom" },
      data: {
        type: "orders",
        id: "order_empty_custom",
        attributes: {},
      },
    };
    const rawStr = JSON.stringify(body);
    const sig = createHmac("sha256", secret).update(rawStr, "utf8").digest("hex");
    const v = await lemonsqueezyProvider.verifyWebhookAndExtractEvent({
      rawBody: Buffer.from(rawStr, "utf8"),
      headers: { "x-signature": sig },
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("MISSING_CUSTOM_DATA");
  });

  it("order_created reads custom_data from meta only (Lemon docs)", async () => {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "";
    const body = {
      meta: {
        event_name: "order_created",
        webhook_id: "wh_meta_custom_only",
        custom_data: {
          clerkUserId: "user_meta_only",
          creditPackageId: "starter",
          creditAmount: "20",
          paymentProvider: "lemonsqueezy",
        },
      },
      data: {
        type: "orders",
        id: "order_meta_custom_only",
        attributes: {},
      },
    };
    const rawStr = JSON.stringify(body);
    const sig = createHmac("sha256", secret).update(rawStr, "utf8").digest("hex");
    const v = await lemonsqueezyProvider.verifyWebhookAndExtractEvent({
      rawBody: Buffer.from(rawStr, "utf8"),
      headers: { "x-signature": sig },
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.event.clerkUserId).toBe("user_meta_only");
  });

  it("order_created coerces numeric order id to string identifiers", async () => {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "";
    const body = {
      meta: { event_name: "order_created", webhook_id: "wh_numeric_id" },
      data: {
        type: "orders",
        id: 424242,
        attributes: {
          custom_data: {
            clerkUserId: "user_numeric",
            creditPackageId: "standard",
            creditAmount: "50",
            paymentProvider: "lemonsqueezy",
          },
        },
      },
    };
    const rawStr = JSON.stringify(body);
    const sig = createHmac("sha256", secret).update(rawStr, "utf8").digest("hex");
    const v = await lemonsqueezyProvider.verifyWebhookAndExtractEvent({
      rawBody: Buffer.from(rawStr, "utf8"),
      headers: { "x-signature": sig },
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.event.paymentOrderId).toBe("424242");
      expect(v.event.paymentEventId).toBe("424242");
      expect(v.event.creditAmount).toBe(50);
    }
  });

  it("order_created event name can come from X-Event-Name header", async () => {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "";
    const body = {
      meta: { webhook_id: "wh_ls_hdr_1" },
      data: {
        type: "orders",
        id: "order_ls_hdr_1",
        attributes: {
          custom_data: {
            clerkUserId: "user_test_sub",
            creditPackageId: "starter",
            creditAmount: "20",
            paymentProvider: "lemonsqueezy",
          },
        },
      },
    };
    const rawStr = JSON.stringify(body);
    const sig = createHmac("sha256", secret).update(rawStr, "utf8").digest("hex");
    const v = await lemonsqueezyProvider.verifyWebhookAndExtractEvent({
      rawBody: Buffer.from(rawStr, "utf8"),
      headers: { "x-signature": sig, "x-event-name": "order_created" },
    });
    expect(v.ok).toBe(true);
  });

  it("redacted order_created fixture parses custom_data and uses order id for idempotency fields", async () => {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "";
    const rawStr = readFileSync(lemonOrderCreatedFixturePath, "utf8");
    const sig = createHmac("sha256", secret).update(rawStr, "utf8").digest("hex");
    const v = await lemonsqueezyProvider.verifyWebhookAndExtractEvent({
      rawBody: Buffer.from(rawStr, "utf8"),
      headers: { "x-signature": sig },
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.event.clerkUserId).toBe("user_a");
    expect(v.event.creditPackageId).toBe("starter");
    expect(v.event.paymentEventId).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    expect(v.event.paymentOrderId).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    expect(v.event.paymentCheckoutId).toBe("cccccccc-cccc-cccc-cccc-cccccccccccc");
  });

  it("same order different webhook_id yields identical paymentEventId for idempotency", async () => {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "";
    const base = JSON.parse(readFileSync(lemonOrderCreatedFixturePath, "utf8")) as Record<string, unknown>;
    const bodyA = {
      ...base,
      meta: { ...(base.meta as Record<string, unknown>), webhook_id: "11111111-1111-1111-1111-111111111111" },
    };
    const bodyB = {
      ...base,
      meta: { ...(base.meta as Record<string, unknown>), webhook_id: "22222222-2222-2222-2222-222222222222" },
    };
    const rawA = JSON.stringify(bodyA);
    const rawB = JSON.stringify(bodyB);
    const sigA = createHmac("sha256", secret).update(rawA, "utf8").digest("hex");
    const sigB = createHmac("sha256", secret).update(rawB, "utf8").digest("hex");
    const vA = await lemonsqueezyProvider.verifyWebhookAndExtractEvent({
      rawBody: Buffer.from(rawA, "utf8"),
      headers: { "x-signature": sigA },
    });
    const vB = await lemonsqueezyProvider.verifyWebhookAndExtractEvent({
      rawBody: Buffer.from(rawB, "utf8"),
      headers: { "x-signature": sigB },
    });
    expect(vA.ok && vB.ok).toBe(true);
    if (!vA.ok || !vB.ok) return;
    expect(vA.event.paymentEventId).toBe(vB.event.paymentEventId);
    expect(vA.event.paymentEventId).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
  });
});
