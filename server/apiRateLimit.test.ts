/**
 * Rate limit 미들웨어 검증 — Vitest 기본의 VITEST_RATE_LIMIT_OFF 를 이 파일에서만 해제합니다.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import { analyzePostIpLimit, isRateLimitVitestBypassActive, RATE_LIMIT_JSON } from "./middleware/apiRateLimit";

function listen(app: express.Express): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolvePromise, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : 0;
      resolvePromise({ server, port: p });
    });
    server.on("error", reject);
  });
}

describe("apiRateLimit", () => {
  beforeAll(() => {
    process.env.VITEST_RATE_LIMIT_OFF = "false";
  });

  afterAll(() => {
    process.env.VITEST_RATE_LIMIT_OFF = "true";
  });

  it("returns 429 with RATE_LIMITED after exceeding IP limit", async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.get("/hit", analyzePostIpLimit, (_req, res) => {
      res.json({ ok: true });
    });

    const { server, port } = await listen(app);
    try {
      const url = `http://127.0.0.1:${port}/hit`;
      for (let i = 0; i < 10; i++) {
        const r = await fetch(url);
        expect(r.status).toBe(200);
      }
      const blocked = await fetch(url);
      expect(blocked.status).toBe(429);
      const body = (await blocked.json()) as { code?: string };
      expect(body).toEqual(RATE_LIMIT_JSON);
      expect(body.code).toBe("RATE_LIMITED");
    } finally {
      await new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res())));
    }
  });

  it("webhook-style route without rate limit middleware is not limited by analyzePostIpLimit", async () => {
    const app = express();
    app.post("/api/billing/webhook/lemonsqueezy", express.raw({ type: "*/*" }), (_req, res) => {
      res.status(401).json({ received: false });
    });

    const { server, port } = await listen(app);
    try {
      const url = `http://127.0.0.1:${port}/api/billing/webhook/lemonsqueezy`;
      for (let i = 0; i < 25; i++) {
        const r = await fetch(url, { method: "POST", body: "{}" });
        expect(r.status).toBe(401);
      }
    } finally {
      await new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res())));
    }
  });
});

describe("isRateLimitVitestBypassActive", () => {
  afterEach(() => {
    process.env.NODE_ENV = "test";
    process.env.VITEST_RATE_LIMIT_OFF = "true";
  });

  it("is true only when NODE_ENV=test and VITEST_RATE_LIMIT_OFF=true", () => {
    process.env.NODE_ENV = "test";
    process.env.VITEST_RATE_LIMIT_OFF = "true";
    expect(isRateLimitVitestBypassActive()).toBe(true);
    process.env.VITEST_RATE_LIMIT_OFF = "false";
    expect(isRateLimitVitestBypassActive()).toBe(false);
  });

  it("is false in production even when VITEST_RATE_LIMIT_OFF=true", () => {
    process.env.NODE_ENV = "production";
    process.env.VITEST_RATE_LIMIT_OFF = "true";
    expect(isRateLimitVitestBypassActive()).toBe(false);
  });
});
