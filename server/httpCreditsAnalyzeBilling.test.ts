import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import * as resolve from "./_core/resolveRequestUser";

vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_12345678901234567890123456789012";
  process.env.STRIPE_CREDIT_PACK_STARTER_PRICE_ID = "price_test_starter";
  process.env.STRIPE_CREDIT_PACK_STANDARD_PRICE_ID = "price_test_standard";
  process.env.STRIPE_CREDIT_PACK_PRO_PRICE_ID = "price_test_pro";
});

vi.mock("./_core/resolveRequestUser", () => ({
  tryResolveUserFromRequest: vi.fn(),
}));

import { attachBillingWebhook, billingRouter } from "./billingRoute";
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

  it("POST /api/billing/create-checkout-session returns 401 when unauthenticated", async () => {
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(null);
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/create-checkout-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId: "starter" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/billing/create-checkout-session returns 400 for invalid packageId", async () => {
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/create-checkout-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer fake" },
      body: JSON.stringify({ packageId: "enterprise" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Stripe webhook raw route", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const app = express();
    attachBillingWebhook(app);
    const r = await listen(app);
    server = r.server;
    port = r.port;
  });

  afterAll(async () => {
    await new Promise<void>((res, rej) => {
      server.close(err => (err ? rej(err) : res()));
    });
  });

  it("returns 400 when Stripe-Signature header missing", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });
});
