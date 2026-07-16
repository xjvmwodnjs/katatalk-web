import express from "express";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildReadinessReport, registerHealthRoutes } from "./_core/healthRoutes";

function minimalProductionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    AUTH_PROVIDER: "clerk",
    VITE_AUTH_PROVIDER: "clerk",
    VITE_CLERK_PUBLISHABLE_KEY: "pk_test_placeholder_not_real",
    CLERK_SECRET_KEY: "sk_test_placeholder_not_real",
    JWT_SECRET: "vitest-jwt-secret-minimum-32-characters-long-x",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service_role_placeholder",
    LEMONSQUEEZY_API_KEY: "lemon_key",
    LEMONSQUEEZY_STORE_ID: "123",
    LEMONSQUEEZY_WEBHOOK_SECRET: "whsec_placeholder_32chars______",
    LEMONSQUEEZY_CREDIT_PACK_STARTER_VARIANT_ID: "v1",
    LEMONSQUEEZY_CREDIT_PACK_STANDARD_VARIANT_ID: "v2",
    LEMONSQUEEZY_CREDIT_PACK_PRO_VARIANT_ID: "v3",
    APP_BASE_URL: "https://app.example.com",
    ANALYSIS_ENGINE: "katago",
    ANALYSIS_WORKER_MODE: "external",
    KATATALK_ALLOW_MOCK_ANALYSIS: "false",
    OPS_STATUS_TOKEN: "ops-status-token-for-vitest",
    KATAGO_BINARY_PATH: "PRIVATE_BINARY_PLACEHOLDER",
    KATAGO_CONFIG_PATH: "PRIVATE_CONFIG_PLACEHOLDER",
    KATAGO_MODEL_PATH: "PRIVATE_MODEL_PLACEHOLDER",
    ...overrides,
  };
}

function listen(app: express.Express): Promise<{ server: http.Server; port: number }> {
  return new Promise(resolve => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address.");
      }
      resolve({ server, port: address.port });
    });
  });
}

describe("buildReadinessReport", () => {
  it("passes with minimal production env for external KataGo workers", () => {
    const report = buildReadinessReport(minimalProductionEnv());
    expect(report.ok).toBe(true);
    expect(report.status).toBe("ready");
    expect(report.analysisEngine).toBe("katago");
    expect(report.workerMode).toBe("external");
  });

  it("fails production readiness when Clerk publishable key is missing", () => {
    const env = minimalProductionEnv({ VITE_CLERK_PUBLISHABLE_KEY: "" });
    const report = buildReadinessReport(env);
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "VITE_CLERK_PUBLISHABLE_KEY",
        status: "fail",
      })
    );
  });

  it("fails production readiness when public mock analysis is not explicitly allowed", () => {
    const env = minimalProductionEnv({ ANALYSIS_ENGINE: "mock", KATATALK_ALLOW_MOCK_ANALYSIS: "false" });
    const report = buildReadinessReport(env);
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "ANALYSIS_ENGINE",
        status: "fail",
      })
    );
  });

  it("fails production readiness when inline KataGo is configured", () => {
    const env = minimalProductionEnv({ ANALYSIS_WORKER_MODE: "inline" });
    const report = buildReadinessReport(env);
    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "ANALYSIS_WORKER_MODE",
        status: "fail",
      })
    );
  });
});

describe("health routes", () => {
  let backup: NodeJS.ProcessEnv;

  beforeEach(() => {
    backup = { ...process.env };
  });

  afterEach(() => {
    process.env = backup;
  });

  it("GET /healthz returns liveness payload", async () => {
    const app = express();
    registerHealthRoutes(app);
    const { server, port } = await listen(app);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      await expect(res.json()).resolves.toMatchObject({
        ok: true,
        status: "ok",
        service: "katatalk-web",
      });
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("GET /readyz returns 503 when production config is incomplete", async () => {
    process.env = minimalProductionEnv({ VITE_CLERK_PUBLISHABLE_KEY: "" });
    const app = express();
    registerHealthRoutes(app);
    const { server, port } = await listen(app);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/readyz`);
      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toMatchObject({
        ok: false,
        status: "not_ready",
      });
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("reports external Worker status separately without changing Web readiness", async () => {
    process.env = minimalProductionEnv();
    const app = express();
    registerHealthRoutes(app, {
      getWorkerHealth: async () => ({
        status: "stale",
        expectedEngine: "katago",
        liveInstances: 0,
        lastHeartbeatAt: "2026-07-15T00:00:00.000Z",
        lastSuccessAt: null,
        staleAfterSeconds: 60,
      }),
    });
    const { server, port } = await listen(app);
    try {
      const hidden = await fetch(`http://127.0.0.1:${port}/ops/analysis-worker-health`);
      expect(hidden.status).toBe(404);

      const worker = await fetch(`http://127.0.0.1:${port}/ops/analysis-worker-health`, {
        headers: { "X-Ops-Status-Token": "ops-status-token-for-vitest" },
      });
      expect(worker.status).toBe(503);
      expect(worker.headers.get("cache-control")).toBe("no-store");
      await expect(worker.json()).resolves.toMatchObject({ ok: false, status: "stale" });

      const readiness = await fetch(`http://127.0.0.1:${port}/readyz`);
      expect(readiness.status).toBe(200);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
