import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lemonsqueezyProvider } from "./paymentProviders/lemonsqueezyProvider";

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
      expect(v.event.clerkUserId).toBe("user_test_sub");
      expect(v.event.creditAmount).toBe(50);
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
});
