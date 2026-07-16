type SmokeStatus = "pass" | "fail" | "warn";

type SmokeCheck = {
  name: string;
  status: SmokeStatus;
  detail: string;
  latencyMs: number;
};

type JsonObject = Record<string, unknown>;

const DEFAULT_TIMEOUT_MS = 10_000;

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function envBool(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Missing base URL. Use --base-url=https://... or SMOKE_BASE_URL.");
  }
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported base URL protocol: ${url.protocol}`);
  }
  return url.toString().replace(/\/+$/, "");
}

function readBaseUrl(): string {
  const raw = readArg("base-url") ?? process.env.SMOKE_BASE_URL ?? "";
  return normalizeBaseUrl(raw);
}

function readTimeoutMs(): number {
  const raw = readArg("timeout-ms") ?? process.env.SMOKE_TIMEOUT_MS ?? "";
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(n, 60_000);
}

function describeJson(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return typeof value;
  }
  const obj = value as JsonObject;
  const keys = Object.keys(obj).slice(0, 8);
  return keys.length ? `keys=${keys.join(",")}` : "empty object";
}

async function readJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 160);
  }
}

async function requestJson(
  baseUrl: string,
  path: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<{ response: Response; json: unknown; latencyMs: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
    });
    const json = await readJsonSafe(response);
    return { response, json, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timeout);
  }
}

async function runCheck(
  name: string,
  fn: () => Promise<Omit<SmokeCheck, "name">>
): Promise<SmokeCheck> {
  const started = Date.now();
  try {
    return { name, ...(await fn()) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name,
      status: "fail",
      detail: message,
      latencyMs: Date.now() - started,
    };
  }
}

function pass(detail: string, latencyMs: number): Omit<SmokeCheck, "name"> {
  return { status: "pass", detail, latencyMs };
}

function fail(detail: string, latencyMs: number): Omit<SmokeCheck, "name"> {
  return { status: "fail", detail, latencyMs };
}

function warn(detail: string, latencyMs: number): Omit<SmokeCheck, "name"> {
  return { status: "warn", detail, latencyMs };
}

function jsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

async function checkHealthz(baseUrl: string, timeoutMs: number): Promise<Omit<SmokeCheck, "name">> {
  const { response, json, latencyMs } = await requestJson(baseUrl, "/healthz", timeoutMs);
  const body = jsonObject(json);
  if (response.status !== 200 || body.ok !== true || body.status !== "ok") {
    return fail(`expected 200 ok health, got ${response.status} ${describeJson(json)}`, latencyMs);
  }
  return pass("service is alive", latencyMs);
}

async function checkReadyz(baseUrl: string, timeoutMs: number): Promise<Omit<SmokeCheck, "name">> {
  const { response, json, latencyMs } = await requestJson(baseUrl, "/readyz", timeoutMs);
  const body = jsonObject(json);
  const checks = Array.isArray(body.checks) ? body.checks : [];
  const failing = checks
    .filter(item => jsonObject(item).status === "fail")
    .map(item => String(jsonObject(item).name ?? "unknown"));
  if (response.status !== 200 || body.ok !== true || body.status !== "ok") {
    return fail(
      failing.length
        ? `readiness failed: ${failing.join(", ")}`
        : `expected ready 200, got ${response.status} ${describeJson(json)}`,
      latencyMs
    );
  }
  return pass(`ready checks=${checks.length}`, latencyMs);
}

async function checkAnalysisWorkerHealth(
  baseUrl: string,
  timeoutMs: number,
  token: string
): Promise<Omit<SmokeCheck, "name">> {
  const { response, json, latencyMs } = await requestJson(baseUrl, "/ops/analysis-worker-health", timeoutMs, {
    headers: { "X-Ops-Status-Token": token },
  });
  const body = jsonObject(json);
  if (response.status !== 200 || body.ok !== true || body.status !== "live") {
    return fail(`expected live external Worker, got ${response.status} ${describeJson(json)}`, latencyMs);
  }
  return pass("external Worker is live", latencyMs);
}

async function checkUnauthCreditsMe(
  baseUrl: string,
  timeoutMs: number
): Promise<Omit<SmokeCheck, "name">> {
  const { response, latencyMs } = await requestJson(baseUrl, "/api/credits/me", timeoutMs);
  if (response.status !== 401) {
    return fail(`expected unauthenticated credits request to return 401, got ${response.status}`, latencyMs);
  }
  return pass("credits endpoint rejects anonymous access", latencyMs);
}

async function checkUnauthBillingCheckout(
  baseUrl: string,
  timeoutMs: number
): Promise<Omit<SmokeCheck, "name">> {
  const { response, latencyMs } = await requestJson(baseUrl, "/api/billing/create-checkout", timeoutMs, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packageId: "starter", locale: "en" }),
  });
  if (response.status !== 401) {
    return fail(`expected anonymous checkout creation to return 401, got ${response.status}`, latencyMs);
  }
  return pass("checkout creation rejects anonymous access", latencyMs);
}

async function checkUnauthAnalyze(
  baseUrl: string,
  timeoutMs: number
): Promise<Omit<SmokeCheck, "name">> {
  const { response, latencyMs } = await requestJson(
    baseUrl,
    "/api/analyze/katatalk-smoke-missing-job",
    timeoutMs
  );
  if (response.status !== 401) {
    return fail(`expected anonymous analysis read to return 401, got ${response.status}`, latencyMs);
  }
  return pass("analysis results reject anonymous access", latencyMs);
}

async function checkAuthenticatedCredits(
  baseUrl: string,
  timeoutMs: number,
  token: string
): Promise<Omit<SmokeCheck, "name">> {
  const { response, json, latencyMs } = await requestJson(baseUrl, "/api/credits/me", timeoutMs, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = jsonObject(json);
  if (response.status !== 200 || typeof body.credits !== "number") {
    return fail(`expected authenticated credits JSON, got ${response.status} ${describeJson(json)}`, latencyMs);
  }
  return pass(`credits balance returned (${body.credits})`, latencyMs);
}

async function checkAuthenticatedCheckout(
  baseUrl: string,
  timeoutMs: number,
  token: string
): Promise<Omit<SmokeCheck, "name">> {
  const { response, json, latencyMs } = await requestJson(baseUrl, "/api/billing/create-checkout", timeoutMs, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ packageId: "starter", provider: "lemonsqueezy", locale: "en" }),
  });
  const body = jsonObject(json);
  if (response.status !== 200 || body.success !== true || typeof body.url !== "string") {
    return fail(`expected checkout URL JSON, got ${response.status} ${describeJson(json)}`, latencyMs);
  }
  return pass("Lemon Squeezy checkout URL created", latencyMs);
}

function printResults(baseUrl: string, checks: SmokeCheck[]): void {
  console.log(`Deploy smoke target: ${baseUrl}`);
  for (const check of checks) {
    const mark = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`[${mark}] ${check.name} (${check.latencyMs}ms) - ${check.detail}`);
  }
  const failed = checks.filter(check => check.status === "fail");
  const warned = checks.filter(check => check.status === "warn");
  console.log(`Summary: ${checks.length - failed.length - warned.length} passed, ${warned.length} warned, ${failed.length} failed`);
}

async function main(): Promise<void> {
  const baseUrl = readBaseUrl();
  const timeoutMs = readTimeoutMs();
  const token = process.env.SMOKE_AUTH_TOKEN?.trim() ?? "";
  const opsToken = process.env.SMOKE_OPS_TOKEN?.trim() ?? "";
  const createCheckout = envBool("SMOKE_CREATE_CHECKOUT");

  const checks: Promise<SmokeCheck>[] = [
    runCheck("GET /healthz", () => checkHealthz(baseUrl, timeoutMs)),
    runCheck("GET /readyz", () => checkReadyz(baseUrl, timeoutMs)),
    runCheck("GET /api/credits/me rejects anonymous", () => checkUnauthCreditsMe(baseUrl, timeoutMs)),
    runCheck("POST /api/billing/create-checkout rejects anonymous", () =>
      checkUnauthBillingCheckout(baseUrl, timeoutMs)
    ),
    runCheck("GET /api/analyze/:jobId rejects anonymous", () => checkUnauthAnalyze(baseUrl, timeoutMs)),
  ];

  if (opsToken) {
    checks.push(
      runCheck("GET /ops/analysis-worker-health with SMOKE_OPS_TOKEN", () =>
        checkAnalysisWorkerHealth(baseUrl, timeoutMs, opsToken)
      )
    );
  } else {
    checks.push(Promise.resolve({
      name: "GET /ops/analysis-worker-health with SMOKE_OPS_TOKEN",
      status: "warn",
      detail: "skipped; set SMOKE_OPS_TOKEN to verify the external Worker",
      latencyMs: 0,
    }));
  }

  if (token) {
    checks.push(
      runCheck("GET /api/credits/me with SMOKE_AUTH_TOKEN", () =>
        checkAuthenticatedCredits(baseUrl, timeoutMs, token)
      )
    );
    if (createCheckout) {
      checks.push(
        runCheck("POST /api/billing/create-checkout with SMOKE_AUTH_TOKEN", () =>
          checkAuthenticatedCheckout(baseUrl, timeoutMs, token)
        )
      );
    } else {
      checks.push(
        Promise.resolve({
          name: "POST /api/billing/create-checkout with SMOKE_AUTH_TOKEN",
          status: "warn",
          detail: "skipped; set SMOKE_CREATE_CHECKOUT=true to create a real checkout session",
          latencyMs: 0,
        })
      );
    }
  } else {
    checks.push(
      Promise.resolve({
        name: "authenticated credit smoke",
        status: "warn",
        detail: "skipped; set SMOKE_AUTH_TOKEN to verify an authenticated test account balance",
        latencyMs: 0,
      })
    );
  }

  const results = await Promise.all(checks);
  printResults(baseUrl, results);
  if (results.some(check => check.status === "fail")) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
