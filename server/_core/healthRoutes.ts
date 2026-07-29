import { timingSafeEqual } from "node:crypto";
import type { Express, Request } from "express";
import {
  getAnalysisWorkerHealth,
  type AnalysisWorkerHealth,
} from "../worker/analysisWorkerStatus";
import {
  getAnalysisFinalizationQuarantineStatus,
  type AnalysisFinalizationQuarantineStatus,
} from "../worker/analysisFinalizationQuarantineStatus";

export type ReadinessCheckStatus = "ok" | "warn" | "fail";

export type ReadinessCheck = {
  name: string;
  status: ReadinessCheckStatus;
  message: string;
  details?: Record<string, unknown>;
};

export type ReadinessReport = {
  ok: boolean;
  status: "ready" | "not_ready";
  nodeEnv: string;
  authProvider: string;
  analysisEngine: "mock" | "katago";
  workerMode: string;
  checks: ReadinessCheck[];
};

function readTrimmed(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? "";
}

function hasValue(env: NodeJS.ProcessEnv, name: string): boolean {
  return readTrimmed(env, name).length > 0;
}

function boolEnv(env: NodeJS.ProcessEnv, name: string): boolean {
  return readTrimmed(env, name).toLowerCase() === "true";
}

function readAnalysisEngine(env: NodeJS.ProcessEnv): "mock" | "katago" {
  return readTrimmed(env, "ANALYSIS_ENGINE").toLowerCase() === "katago" ? "katago" : "mock";
}

function hasValidOpsStatusToken(req: Request, expected: string): boolean {
  const provided = req.get("X-Ops-Status-Token")?.trim() ?? "";
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

function addRequiredEnvCheck(
  checks: ReadinessCheck[],
  env: NodeJS.ProcessEnv,
  name: string,
  required: boolean
): void {
  const configured = hasValue(env, name);
  if (configured) {
    checks.push({ name, status: "ok", message: `${name} is configured.` });
    return;
  }
  checks.push({
    name,
    status: required ? "fail" : "warn",
    message: required ? `${name} is required.` : `${name} is not configured.`,
  });
}

function addProductionBaseUrlCheck(checks: ReadinessCheck[], env: NodeJS.ProcessEnv): void {
  const raw = readTrimmed(env, "APP_BASE_URL");
  if (!raw) {
    checks.push({ name: "APP_BASE_URL", status: "fail", message: "APP_BASE_URL is required." });
    return;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    checks.push({ name: "APP_BASE_URL", status: "fail", message: "APP_BASE_URL must be a valid URL." });
    return;
  }

  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:") {
    checks.push({ name: "APP_BASE_URL", status: "fail", message: "APP_BASE_URL must use https in production." });
    return;
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    checks.push({ name: "APP_BASE_URL", status: "fail", message: "APP_BASE_URL cannot point at localhost in production." });
    return;
  }

  checks.push({ name: "APP_BASE_URL", status: "ok", message: "APP_BASE_URL is production-safe." });
}

function addAuthChecks(checks: ReadinessCheck[], env: NodeJS.ProcessEnv, isProduction: boolean): string {
  const authProvider = readTrimmed(env, "AUTH_PROVIDER") || (isProduction ? "" : "local-dev");
  const viteAuthProvider = readTrimmed(env, "VITE_AUTH_PROVIDER");

  if (isProduction) {
    if (authProvider !== "clerk") {
      checks.push({ name: "AUTH_PROVIDER", status: "fail", message: "Production requires AUTH_PROVIDER=clerk." });
    } else {
      checks.push({ name: "AUTH_PROVIDER", status: "ok", message: "Production auth provider is clerk." });
    }
    if (viteAuthProvider !== "clerk") {
      checks.push({ name: "VITE_AUTH_PROVIDER", status: "fail", message: "Production requires VITE_AUTH_PROVIDER=clerk." });
    } else {
      checks.push({ name: "VITE_AUTH_PROVIDER", status: "ok", message: "Client auth provider is clerk." });
    }
    addRequiredEnvCheck(checks, env, "VITE_CLERK_PUBLISHABLE_KEY", true);
    addRequiredEnvCheck(checks, env, "CLERK_SECRET_KEY", true);
    addRequiredEnvCheck(checks, env, "JWT_SECRET", true);
    return authProvider;
  }

  if (authProvider === "clerk") {
    addRequiredEnvCheck(checks, env, "VITE_CLERK_PUBLISHABLE_KEY", true);
    addRequiredEnvCheck(checks, env, "CLERK_SECRET_KEY", true);
    addRequiredEnvCheck(checks, env, "JWT_SECRET", true);
  } else {
    checks.push({
      name: "AUTH_PROVIDER",
      status: "ok",
      message: `Using ${authProvider || "local-dev"} auth outside production.`,
    });
  }

  return authProvider;
}

function addSupabaseChecks(checks: ReadinessCheck[], env: NodeJS.ProcessEnv, isProduction: boolean): void {
  addRequiredEnvCheck(checks, env, "SUPABASE_URL", isProduction);
  addRequiredEnvCheck(checks, env, "SUPABASE_SERVICE_ROLE_KEY", isProduction);
}

function addBillingChecks(checks: ReadinessCheck[], env: NodeJS.ProcessEnv, isProduction: boolean): void {
  addRequiredEnvCheck(checks, env, "LEMONSQUEEZY_API_KEY", isProduction);
  addRequiredEnvCheck(checks, env, "LEMONSQUEEZY_STORE_ID", isProduction);
  addRequiredEnvCheck(checks, env, "LEMONSQUEEZY_WEBHOOK_SECRET", isProduction);
  addRequiredEnvCheck(checks, env, "LEMONSQUEEZY_CREDIT_PACK_STARTER_VARIANT_ID", isProduction);
  addRequiredEnvCheck(checks, env, "LEMONSQUEEZY_CREDIT_PACK_STANDARD_VARIANT_ID", isProduction);
  addRequiredEnvCheck(checks, env, "LEMONSQUEEZY_CREDIT_PACK_PRO_VARIANT_ID", isProduction);
}

function addAnalysisChecks(
  checks: ReadinessCheck[],
  env: NodeJS.ProcessEnv,
  isProduction: boolean,
  analysisEngine: "mock" | "katago",
  workerMode: string
): void {
  const mockAllowed = boolEnv(env, "KATATALK_ALLOW_MOCK_ANALYSIS");

  if (isProduction && analysisEngine === "mock" && !mockAllowed) {
    checks.push({
      name: "ANALYSIS_ENGINE",
      status: "fail",
      message: "Production mock analysis is disabled; set ANALYSIS_ENGINE=katago or explicitly allow mock.",
    });
  } else if (analysisEngine === "mock") {
    checks.push({
      name: "ANALYSIS_ENGINE",
      status: isProduction ? "warn" : "ok",
      message: "Analysis engine is mock.",
      details: { mockAllowed },
    });
  } else {
    checks.push({ name: "ANALYSIS_ENGINE", status: "ok", message: "Analysis engine is katago." });
  }

  if (isProduction && analysisEngine === "katago" && workerMode !== "external") {
    checks.push({
      name: "ANALYSIS_WORKER_MODE",
      status: "fail",
      message: "Production katago analysis requires ANALYSIS_WORKER_MODE=external.",
    });
  } else {
    checks.push({
      name: "ANALYSIS_WORKER_MODE",
      status: "ok",
      message: `Analysis worker mode is ${workerMode}.`,
    });
  }

  if (analysisEngine === "katago" && workerMode !== "external") {
    addRequiredEnvCheck(checks, env, "KATAGO_BINARY_PATH", true);
    addRequiredEnvCheck(checks, env, "KATAGO_CONFIG_PATH", true);
    addRequiredEnvCheck(checks, env, "KATAGO_MODEL_PATH", true);
  }
}

export function buildReadinessReport(env: NodeJS.ProcessEnv = process.env): ReadinessReport {
  const nodeEnv = readTrimmed(env, "NODE_ENV") || "development";
  const isProduction = nodeEnv === "production";
  const checks: ReadinessCheck[] = [];
  const authProvider = addAuthChecks(checks, env, isProduction);
  const analysisEngine = readAnalysisEngine(env);
  const workerMode = readTrimmed(env, "ANALYSIS_WORKER_MODE") || "inline";

  if (isProduction) {
    addProductionBaseUrlCheck(checks, env);
  } else {
    addRequiredEnvCheck(checks, env, "APP_BASE_URL", false);
  }
  addSupabaseChecks(checks, env, isProduction);
  addBillingChecks(checks, env, isProduction);
  addAnalysisChecks(checks, env, isProduction, analysisEngine, workerMode);
  if (workerMode === "external") {
    addRequiredEnvCheck(checks, env, "OPS_STATUS_TOKEN", isProduction);
  }

  const ok = checks.every(check => check.status !== "fail");
  return {
    ok,
    status: ok ? "ready" : "not_ready",
    nodeEnv,
    authProvider,
    analysisEngine,
    workerMode,
    checks,
  };
}

export function registerHealthRoutes(
  app: Express,
  opts?: {
    getWorkerHealth?: (args: {
      expectedEngine: "mock" | "katago";
    }) => Promise<AnalysisWorkerHealth>;
    getFinalizationQuarantineStatus?: () => Promise<AnalysisFinalizationQuarantineStatus>;
  }
): void {
  app.get("/healthz", (_req, res) => {
    res.set("Cache-Control", "no-store").json({
      ok: true,
      status: "ok",
      service: "katatalk-web",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/readyz", (_req, res) => {
    const report = buildReadinessReport();
    res.set("Cache-Control", "no-store").status(report.ok ? 200 : 503).json(report);
  });

  app.get("/ops/analysis-worker-health", async (req, res) => {
    const opsStatusToken = readTrimmed(process.env, "OPS_STATUS_TOKEN");
    if (!opsStatusToken || !hasValidOpsStatusToken(req, opsStatusToken)) {
      res.status(404).set("Cache-Control", "no-store").end();
      return;
    }
    const expectedEngine = readAnalysisEngine(process.env);
    const getWorkerHealth = opts?.getWorkerHealth ?? getAnalysisWorkerHealth;
    try {
      const report = await getWorkerHealth({ expectedEngine });
      res
        .set("Cache-Control", "no-store")
        .status(report.status === "live" ? 200 : 503)
        .json({ ok: report.status === "live", ...report });
    } catch {
      res.status(503).set("Cache-Control", "no-store").json({
        ok: false,
        status: "unknown",
        expectedEngine,
      });
    }
  });

  app.get("/ops/analysis-finalization-quarantine", async (req, res) => {
    const opsStatusToken = readTrimmed(process.env, "OPS_STATUS_TOKEN");
    if (!opsStatusToken || !hasValidOpsStatusToken(req, opsStatusToken)) {
      res.status(404).set("Cache-Control", "no-store").end();
      return;
    }

    const readStatus =
      opts?.getFinalizationQuarantineStatus ??
      getAnalysisFinalizationQuarantineStatus;
    try {
      const report = await readStatus();
      if (report.status === "clear") {
        res.status(200).set("Cache-Control", "no-store").json({
          ok: true,
          status: "clear",
          unresolvedCount: 0,
          oldestFirstFailedAt: null,
        });
        return;
      }
      if (report.status === "attention_required") {
        res.status(503).set("Cache-Control", "no-store").json({
          ok: false,
          status: "attention_required",
          unresolvedCount: report.unresolvedCount,
          oldestFirstFailedAt: report.oldestFirstFailedAt,
        });
        return;
      }
    } catch {
      // The response below intentionally omits database and row details.
    }

    res.status(503).set("Cache-Control", "no-store").json({
      ok: false,
      status: "unknown",
    });
  });
}
