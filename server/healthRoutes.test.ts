import express from "express";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("hides quarantine status without the exact operations token", async () => {
    process.env = minimalProductionEnv();
    const getFinalizationQuarantineStatus = vi.fn(async () => ({
      status: "clear" as const,
      unresolvedCount: 0 as const,
      oldestFirstFailedAt: null,
    }));
    const app = express();
    registerHealthRoutes(app, { getFinalizationQuarantineStatus });
    const { server, port } = await listen(app);
    const endpoint = `http://127.0.0.1:${port}/ops/analysis-finalization-quarantine`;
    try {
      const missing = await fetch(endpoint);
      const wrongLength = await fetch(endpoint, {
        headers: { "X-Ops-Status-Token": "wrong" },
      });
      const wrongSameLength = await fetch(endpoint, {
        headers: {
          "X-Ops-Status-Token": "x".repeat("ops-status-token-for-vitest".length),
        },
      });
      process.env.OPS_STATUS_TOKEN = "";
      const unset = await fetch(endpoint, {
        headers: { "X-Ops-Status-Token": "ops-status-token-for-vitest" },
      });

      expect(missing.status).toBe(404);
      expect(wrongLength.status).toBe(404);
      expect(wrongSameLength.status).toBe(404);
      expect(unset.status).toBe(404);
      expect(getFinalizationQuarantineStatus).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("reports clear and attention-required quarantine states without changing readiness", async () => {
    process.env = minimalProductionEnv();
    const getFinalizationQuarantineStatus = vi
      .fn()
      .mockResolvedValueOnce({
        status: "clear",
        unresolvedCount: 0,
        oldestFirstFailedAt: null,
      })
      .mockResolvedValueOnce({
        status: "attention_required",
        unresolvedCount: 2,
        oldestFirstFailedAt: "2026-07-20T00:00:00.000Z",
        analysis_job_id: "private-job-id",
        lease_worker_id: "private-worker-id",
        failure_code: "LEDGER_INVARIANT",
        ops_status_token: "ops-status-token-for-vitest",
      });
    const app = express();
    registerHealthRoutes(app, { getFinalizationQuarantineStatus });
    const { server, port } = await listen(app);
    const endpoint = `http://127.0.0.1:${port}/ops/analysis-finalization-quarantine`;
    const headers = { "X-Ops-Status-Token": "ops-status-token-for-vitest" };
    try {
      const clear = await fetch(endpoint, { headers });
      expect(clear.status).toBe(200);
      expect(clear.headers.get("cache-control")).toBe("no-store");
      await expect(clear.json()).resolves.toEqual({
        ok: true,
        status: "clear",
        unresolvedCount: 0,
        oldestFirstFailedAt: null,
      });

      const attention = await fetch(endpoint, { headers });
      expect(attention.status).toBe(503);
      const rawAttention = await attention.text();
      expect(JSON.parse(rawAttention)).toEqual({
        ok: false,
        status: "attention_required",
        unresolvedCount: 2,
        oldestFirstFailedAt: "2026-07-20T00:00:00.000Z",
      });
      expect(rawAttention).not.toMatch(
        /private-job-id|private-worker-id|LEDGER_INVARIANT|ops-status-token-for-vitest/
      );

      const readiness = await fetch(`http://127.0.0.1:${port}/readyz`);
      expect(readiness.status).toBe(200);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("redacts quarantine backend failures", async () => {
    process.env = minimalProductionEnv();
    const getFinalizationQuarantineStatus = vi.fn(async () => {
      throw new Error("database-host private-job-id service-role-key");
    });
    const app = express();
    registerHealthRoutes(app, { getFinalizationQuarantineStatus });
    const { server, port } = await listen(app);
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/ops/analysis-finalization-quarantine`,
        { headers: { "X-Ops-Status-Token": "ops-status-token-for-vitest" } }
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const raw = await response.text();
      expect(JSON.parse(raw)).toEqual({ ok: false, status: "unknown" });
      expect(raw).not.toMatch(/database-host|private-job-id|service-role-key/);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
