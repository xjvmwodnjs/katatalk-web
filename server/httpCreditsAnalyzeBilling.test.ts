import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { createHmac } from "crypto";
import * as resolve from "./_core/resolveRequestUser";
import * as creditService from "./creditService";

vi.mock("./_core/resolveRequestUser", () => ({
  tryResolveUserFromRequest: vi.fn(),
}));

import { attachPaymentWebhooks, billingRouter } from "./billingRoute";
import { analyzeRouter } from "./analyzeRoute";
import { creditsRouter } from "./creditsRoute";
import { analysisJobStore } from "./inMemoryAnalysisJobStore";
import type { AuthenticatedUser } from "./_core/sdk";

function listen(app: express.Express): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolvePromise, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolvePromise({ server, port });
    });
    server.on("error", reject);
  });
}

const userA = {
  id: 1,
  openId: "clerk:user_a",
  email: "a@test.com",
  name: "User A",
  loginMethod: "clerk",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
} as AuthenticatedUser;

const userB = {
  id: 2,
  openId: "clerk:user_b",
  email: "b@test.com",
  name: "User B",
  loginMethod: "clerk",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
} as AuthenticatedUser;

describe("HTTP credits / analyze ownership / billing", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(creditsRouter);
    app.use(analyzeRouter);
    app.use(billingRouter);
    const r = await listen(app);
    server = r.server;
    port = r.port;
  });

  afterAll(async () => {
    await new Promise<void>((res, rej) => {
      server.close(err => (err ? rej(err) : res()));
    });
  });

  beforeEach(() => {
    vi.mocked(resolve.tryResolveUserFromRequest).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("GET /api/credits/me returns 401 when unauthenticated", async () => {
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(null);
    const res = await fetch(`http://127.0.0.1:${port}/api/credits/me`);
    expect(res.status).toBe(401);
  });

  it("GET /api/credits/me returns credits when authenticated", async () => {
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const res = await fetch(`http://127.0.0.1:${port}/api/credits/me`, {
      headers: { Authorization: "Bearer fake" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { credits: number; userId: string };
    expect(body.credits).toBe(2);
    expect(body.userId).toBe("user_a");
  });

  it("GET /api/analyze/:jobId returns 403 for another user's job", async () => {
    vi.useFakeTimers();
    const jobId = "job-ownership-http-test";
    analysisJobStore.createAndEnqueueMock({
      jobId,
      payload: { fileName: "x.sgf", language: "ko" },
      ownerClerkSubject: "user_a",
      ownerAppUserId: 1,
      creditLedgerId: "00000000-0000-0000-0000-00000000cc01",
    });
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userB);
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: "Bearer fake" },
    });
    expect(res.status).toBe(403);
  });

  it("POST /api/billing/create-checkout returns 401 when unauthenticated", async () => {
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(null);
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/create-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId: "starter", locale: "ko" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/billing/create-checkout returns 400 for invalid packageId", async () => {
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/create-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer fake" },
      body: JSON.stringify({ packageId: "enterprise", locale: "en" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/billing/create-checkout returns 400 for invalid provider", async () => {
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/create-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer fake" },
      body: JSON.stringify({ packageId: "starter", provider: "paddle", locale: "en" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/billing/create-checkout ignores client creditAmount (strict body)", async () => {
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/create-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer fake" },
      body: JSON.stringify({ packageId: "starter", provider: "lemonsqueezy", locale: "ko", creditAmount: 9999 }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/billing/create-checkout returns 400 for provider toss", async () => {
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/create-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer fake" },
      body: JSON.stringify({ packageId: "starter", provider: "toss", locale: "ko" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toMatch(/Toss/);
  });

  it("POST /api/billing/create-checkout defaults to lemon and returns checkout url", async () => {
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const originalFetch = global.fetch.bind(global);
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.lemonsqueezy.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              jsonapi: { version: "1.0" },
              data: {
                type: "checkouts",
                attributes: {
                  url: "https://example.lemonsqueezy.com/checkout/test-checkout-id",
                },
              },
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return originalFetch(input as RequestInfo, init);
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/create-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer fake" },
      body: JSON.stringify({ packageId: "starter", locale: "ko" }),
    });
    fetchSpy.mockRestore();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success?: boolean; url?: string; creditAmount?: number };
    expect(body.success).toBe(true);
    expect(body.url).toBe("https://example.lemonsqueezy.com/checkout/test-checkout-id");
    expect(body.creditAmount).toBe(20);
  });

  it("POST /api/billing/create-checkout sends Lemon checkout_data.custom fields", async () => {
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const originalFetch = global.fetch.bind(global);
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.lemonsqueezy.com")) {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as {
          data?: { attributes?: { checkout_data?: { custom?: Record<string, string> } } };
        };
        const custom = parsed?.data?.attributes?.checkout_data?.custom;
        expect(custom?.clerkUserId).toBe("user_a");
        expect(custom?.creditPackageId).toBe("starter");
        expect(custom?.creditAmount).toBe("20");
        expect(custom?.paymentProvider).toBe("lemonsqueezy");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: { attributes: { url: "https://example.lemonsqueezy.com/checkout/custom-fields" } },
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return originalFetch(input as RequestInfo, init);
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/create-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer fake" },
      body: JSON.stringify({ packageId: "starter", locale: "ko" }),
    });
    fetchSpy.mockRestore();
    expect(res.status).toBe(200);
  });

  it("POST /api/billing/create-checkout with lemonsqueezy returns checkout url", async () => {
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const originalFetch = global.fetch.bind(global);
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.lemonsqueezy.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                attributes: {
                  url: "https://example.lemonsqueezy.com/checkout/explicit",
                },
              },
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return originalFetch(input as RequestInfo, init);
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/create-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer fake" },
      body: JSON.stringify({ packageId: "starter", provider: "lemonsqueezy", locale: "ko" }),
    });
    fetchSpy.mockRestore();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url?: string };
    expect(body.url).toBe("https://example.lemonsqueezy.com/checkout/explicit");
  });
});

describe("Payment webhooks HTTP", () => {
  let server: http.Server;
  let port: number;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeAll(async () => {
    const app = express();
    attachPaymentWebhooks(app);
    const r = await listen(app);
    server = r.server;
    port = r.port;
  });

  afterAll(async () => {
    await new Promise<void>((res, rej) => {
      server.close(err => (err ? rej(err) : res()));
    });
  });

  it("Toss webhook returns 200 skipped when not implemented (dev)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/webhook/toss`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  it("Lemon webhook 401 without signature", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/webhook/lemonsqueezy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("Lemon webhook order_created calls addCreditsFromPaymentWebhook", async () => {
    const spy = vi.spyOn(creditService, "addCreditsFromPaymentWebhook").mockResolvedValue({
      ok: true,
      duplicate: false,
      credits: 52,
      errorCode: null,
    });
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "";
    const body = {
      meta: { event_name: "order_created", webhook_id: "wh_http_1" },
      data: {
        type: "orders",
        id: "order_http_1",
        attributes: {
          custom_data: {
            clerkUserId: "user_a",
            creditPackageId: "starter",
            creditAmount: "20",
            paymentProvider: "lemonsqueezy",
          },
        },
      },
    };
    const rawStr = JSON.stringify(body);
    const sig = createHmac("sha256", secret).update(rawStr, "utf8").digest("hex");
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/webhook/lemonsqueezy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-signature": sig },
      body: rawStr,
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalled();
  });

  it("Lemon webhook returns 500 when addCredits returns ok false", async () => {
    vi.spyOn(creditService, "addCreditsFromPaymentWebhook").mockResolvedValue({
      ok: false,
      duplicate: false,
      credits: null,
      errorCode: null,
    });
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "";
    const body = {
      meta: { event_name: "order_created", webhook_id: "wh_http_fail" },
      data: {
        type: "orders",
        id: "order_http_fail",
        attributes: {
          custom_data: {
            clerkUserId: "user_a",
            creditPackageId: "starter",
            creditAmount: "20",
            paymentProvider: "lemonsqueezy",
          },
        },
      },
    };
    const rawStr = JSON.stringify(body);
    const sig = createHmac("sha256", secret).update(rawStr, "utf8").digest("hex");
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/webhook/lemonsqueezy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-signature": sig },
      body: rawStr,
    });
    expect(res.status).toBe(500);
  });

  it("Lemon webhook returns 200 with duplicate when addCredits marks duplicate", async () => {
    vi.spyOn(creditService, "addCreditsFromPaymentWebhook").mockResolvedValue({
      ok: true,
      duplicate: true,
      credits: 72,
      errorCode: null,
    });
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "";
    const body = {
      meta: { event_name: "order_created", webhook_id: "wh_http_dup" },
      data: {
        type: "orders",
        id: "order_http_dup",
        attributes: {
          custom_data: {
            clerkUserId: "user_a",
            creditPackageId: "starter",
            creditAmount: "20",
            paymentProvider: "lemonsqueezy",
          },
        },
      },
    };
    const rawStr = JSON.stringify(body);
    const sig = createHmac("sha256", secret).update(rawStr, "utf8").digest("hex");
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/webhook/lemonsqueezy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-signature": sig },
      body: rawStr,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { duplicate?: boolean };
    expect(json.duplicate).toBe(true);
  });

  it("Lemon webhook order_created without custom_data returns 422", async () => {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "";
    const body = {
      meta: { event_name: "order_created", webhook_id: "wh_no_custom" },
      data: {
        type: "orders",
        id: "order_no_custom",
        attributes: {},
      },
    };
    const rawStr = JSON.stringify(body);
    const sig = createHmac("sha256", secret).update(rawStr, "utf8").digest("hex");
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/webhook/lemonsqueezy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-signature": sig },
      body: rawStr,
    });
    expect(res.status).toBe(422);
  });

  it("Lemon webhook order_created without stable order/webhook id returns 500", async () => {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "";
    const body = {
      meta: { event_name: "order_created" },
      data: {
        type: "orders",
        attributes: {
          custom_data: {
            clerkUserId: "user_a",
            creditPackageId: "starter",
            creditAmount: "20",
            paymentProvider: "lemonsqueezy",
          },
        },
      },
    };
    const rawStr = JSON.stringify(body);
    const sig = createHmac("sha256", secret).update(rawStr, "utf8").digest("hex");
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/webhook/lemonsqueezy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-signature": sig },
      body: rawStr,
    });
    expect(res.status).toBe(500);
  });
});
