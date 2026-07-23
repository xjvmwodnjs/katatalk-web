export type SmokeStatus = "pass" | "fail" | "warn";

export type SmokeCheck = {
  name: string;
  status: SmokeStatus;
  detail: string;
  latencyMs: number;
};

type JsonObject = Record<string, unknown>;
type SmokeFetch = typeof fetch;

const MAX_RESPONSE_BODY_BYTES = 64 * 1024;

export type SmokeTargetInput = {
  baseUrl: string;
  expectedOrigin?: string | null;
  authToken?: string | null;
  opsToken?: string | null;
  allowInsecureLoopback?: boolean;
};

export type RunDeploySmokeOptions = SmokeTargetInput & {
  timeoutMs: number;
  createCheckout: boolean;
  fetchImpl?: SmokeFetch;
};

function isLiteralLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]"
  );
}

export function normalizeSmokeOrigin(
  value: string,
  options: { allowInsecureLoopback?: boolean } = {}
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(
      "Missing base URL. Use --base-url=https://... or SMOKE_BASE_URL."
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Invalid smoke target URL.");
  }

  if (url.username || url.password) {
    throw new Error("Smoke target URL must not contain credentials.");
  }
  if (url.pathname !== "/") {
    throw new Error("Smoke target URL must be an origin without a path.");
  }
  if (url.search) {
    throw new Error("Smoke target URL must not contain a query string.");
  }
  if (url.hash) {
    throw new Error("Smoke target URL must not contain a fragment.");
  }

  if (url.protocol === "https:") {
    return url.origin;
  }
  if (
    url.protocol === "http:" &&
    options.allowInsecureLoopback === true &&
    isLiteralLoopbackHostname(url.hostname)
  ) {
    return url.origin;
  }
  throw new Error(
    "Smoke target must use HTTPS. HTTP is allowed only for explicitly enabled literal loopback development."
  );
}

export function resolveSmokeTarget(input: SmokeTargetInput): string {
  const authToken = input.authToken?.trim() ?? "";
  const opsToken = input.opsToken?.trim() ?? "";
  const hasCredentials = authToken.length > 0 || opsToken.length > 0;
  const baseUrl = normalizeSmokeOrigin(input.baseUrl, {
    allowInsecureLoopback:
      input.allowInsecureLoopback === true && !hasCredentials,
  });
  const rawExpectedOrigin = input.expectedOrigin?.trim() ?? "";

  if (hasCredentials && !rawExpectedOrigin) {
    throw new Error(
      "SMOKE_EXPECTED_ORIGIN is required before sending smoke credentials."
    );
  }

  if (rawExpectedOrigin) {
    const expectedOrigin = normalizeSmokeOrigin(rawExpectedOrigin, {
      allowInsecureLoopback:
        input.allowInsecureLoopback === true && !hasCredentials,
    });
    if (baseUrl !== expectedOrigin) {
      throw new Error(
        "Smoke target does not match the pinned expected origin."
      );
    }
  }

  return baseUrl;
}

function describeJson(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return typeof value;
  }
  return "JSON object";
}

async function readJsonSafe(res: Response): Promise<unknown> {
  const rawContentLength = res.headers.get("content-length")?.trim() ?? "";
  if (/^\d+$/.test(rawContentLength)) {
    const contentLength = BigInt(rawContentLength);
    if (contentLength > BigInt(MAX_RESPONSE_BODY_BYTES)) {
      throw new Error("Smoke response body exceeded the safe size limit.");
    }
  }

  if (!res.body) return null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_RESPONSE_BODY_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The size-limit failure below is the only safe diagnostic.
      }
      throw new Error("Smoke response body exceeded the safe size limit.");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return "non-JSON response";
  }
}

function buildSmokeRequestUrl(baseUrl: string, path: string): URL {
  if (!path.startsWith("/")) {
    throw new Error("Smoke request path must be absolute.");
  }
  const url = new URL(path, `${baseUrl}/`);
  if (url.origin !== baseUrl) {
    throw new Error("Smoke request path escaped the pinned target origin.");
  }
  return url;
}

export async function requestJson(
  baseUrl: string,
  path: string,
  timeoutMs: number,
  init?: RequestInit,
  fetchImpl: SmokeFetch = fetch
): Promise<{ response: Response; json: unknown; latencyMs: number }> {
  const requestUrl = buildSmokeRequestUrl(baseUrl, path);
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(requestUrl, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Redirect response ${response.status} rejected.`);
    }
    if (response.url) {
      let responseOrigin: string;
      try {
        responseOrigin = new URL(response.url).origin;
      } catch {
        throw new Error("Smoke response URL is invalid.");
      }
      if (responseOrigin !== baseUrl) {
        throw new Error(
          "Smoke response origin does not match the pinned target."
        );
      }
    }
    const json = await readJsonSafe(response);
    return { response, json, latencyMs: Date.now() - started };
  } catch (error) {
    controller.abort();
    throw error;
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

function jsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

export async function checkHealthz(
  baseUrl: string,
  timeoutMs: number,
  fetchImpl: SmokeFetch = fetch
): Promise<Omit<SmokeCheck, "name">> {
  const { response, json, latencyMs } = await requestJson(
    baseUrl,
    "/healthz",
    timeoutMs,
    undefined,
    fetchImpl
  );
  const body = jsonObject(json);
  if (response.status !== 200 || body.ok !== true || body.status !== "ok") {
    return fail(
      `expected 200 ok health, got ${response.status} ${describeJson(json)}`,
      latencyMs
    );
  }
  return pass("service is alive", latencyMs);
}

export async function checkReadyz(
  baseUrl: string,
  timeoutMs: number,
  fetchImpl: SmokeFetch = fetch
): Promise<Omit<SmokeCheck, "name">> {
  const { response, json, latencyMs } = await requestJson(
    baseUrl,
    "/readyz",
    timeoutMs,
    undefined,
    fetchImpl
  );
  const body = jsonObject(json);
  const checks = Array.isArray(body.checks) ? body.checks : [];
  const failingCount = checks.filter(
    item => jsonObject(item).status === "fail"
  ).length;
  if (response.status !== 200 || body.ok !== true || body.status !== "ready") {
    return fail(
      failingCount > 0
        ? `readiness checks failed (${failingCount})`
        : `expected ready 200, got ${response.status} ${describeJson(json)}`,
      latencyMs
    );
  }
  return pass(`ready checks=${checks.length}`, latencyMs);
}

async function checkAnalysisWorkerHealth(
  baseUrl: string,
  timeoutMs: number,
  token: string,
  fetchImpl: SmokeFetch
): Promise<Omit<SmokeCheck, "name">> {
  const { response, json, latencyMs } = await requestJson(
    baseUrl,
    "/ops/analysis-worker-health",
    timeoutMs,
    {
      headers: { "X-Ops-Status-Token": token },
    },
    fetchImpl
  );
  const body = jsonObject(json);
  if (response.status !== 200 || body.ok !== true || body.status !== "live") {
    return fail(
      `expected live external Worker, got ${response.status} ${describeJson(json)}`,
      latencyMs
    );
  }
  return pass("external Worker is live", latencyMs);
}

async function checkUnauthCreditsMe(
  baseUrl: string,
  timeoutMs: number,
  fetchImpl: SmokeFetch
): Promise<Omit<SmokeCheck, "name">> {
  const { response, latencyMs } = await requestJson(
    baseUrl,
    "/api/credits/me",
    timeoutMs,
    undefined,
    fetchImpl
  );
  if (response.status !== 401) {
    return fail(
      `expected unauthenticated credits request to return 401, got ${response.status}`,
      latencyMs
    );
  }
  return pass("credits endpoint rejects anonymous access", latencyMs);
}

async function checkUnauthBillingCheckout(
  baseUrl: string,
  timeoutMs: number,
  fetchImpl: SmokeFetch
): Promise<Omit<SmokeCheck, "name">> {
  const { response, latencyMs } = await requestJson(
    baseUrl,
    "/api/billing/create-checkout",
    timeoutMs,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId: "starter", locale: "en" }),
    },
    fetchImpl
  );
  if (response.status !== 401) {
    return fail(
      `expected anonymous checkout creation to return 401, got ${response.status}`,
      latencyMs
    );
  }
  return pass("checkout creation rejects anonymous access", latencyMs);
}

async function checkUnauthAnalyze(
  baseUrl: string,
  timeoutMs: number,
  fetchImpl: SmokeFetch
): Promise<Omit<SmokeCheck, "name">> {
  const { response, latencyMs } = await requestJson(
    baseUrl,
    "/api/analyze/katatalk-smoke-missing-job",
    timeoutMs,
    undefined,
    fetchImpl
  );
  if (response.status !== 401) {
    return fail(
      `expected anonymous analysis read to return 401, got ${response.status}`,
      latencyMs
    );
  }
  return pass("analysis results reject anonymous access", latencyMs);
}

async function checkAuthenticatedCredits(
  baseUrl: string,
  timeoutMs: number,
  token: string,
  fetchImpl: SmokeFetch
): Promise<Omit<SmokeCheck, "name">> {
  const { response, json, latencyMs } = await requestJson(
    baseUrl,
    "/api/credits/me",
    timeoutMs,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
    fetchImpl
  );
  const body = jsonObject(json);
  if (response.status !== 200 || typeof body.credits !== "number") {
    return fail(
      `expected authenticated credits JSON, got ${response.status} ${describeJson(json)}`,
      latencyMs
    );
  }
  return pass("credits balance returned", latencyMs);
}

async function checkAuthenticatedCheckout(
  baseUrl: string,
  timeoutMs: number,
  token: string,
  fetchImpl: SmokeFetch
): Promise<Omit<SmokeCheck, "name">> {
  const { response, json, latencyMs } = await requestJson(
    baseUrl,
    "/api/billing/create-checkout",
    timeoutMs,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        packageId: "starter",
        provider: "lemonsqueezy",
        locale: "en",
      }),
    },
    fetchImpl
  );
  const body = jsonObject(json);
  if (
    response.status !== 200 ||
    body.success !== true ||
    typeof body.url !== "string"
  ) {
    return fail(
      `expected checkout URL JSON, got ${response.status} ${describeJson(json)}`,
      latencyMs
    );
  }
  return pass("Lemon Squeezy checkout URL created", latencyMs);
}

export async function runDeploySmoke(
  options: RunDeploySmokeOptions
): Promise<{ baseUrl: string; checks: SmokeCheck[] }> {
  const authToken = options.authToken?.trim() ?? "";
  const opsToken = options.opsToken?.trim() ?? "";
  const baseUrl = resolveSmokeTarget({
    ...options,
    authToken,
    opsToken,
  });
  const fetchImpl = options.fetchImpl ?? fetch;
  const checks: Promise<SmokeCheck>[] = [
    runCheck("GET /healthz", () =>
      checkHealthz(baseUrl, options.timeoutMs, fetchImpl)
    ),
    runCheck("GET /readyz", () =>
      checkReadyz(baseUrl, options.timeoutMs, fetchImpl)
    ),
    runCheck("GET /api/credits/me rejects anonymous", () =>
      checkUnauthCreditsMe(baseUrl, options.timeoutMs, fetchImpl)
    ),
    runCheck("POST /api/billing/create-checkout rejects anonymous", () =>
      checkUnauthBillingCheckout(baseUrl, options.timeoutMs, fetchImpl)
    ),
    runCheck("GET /api/analyze/:jobId rejects anonymous", () =>
      checkUnauthAnalyze(baseUrl, options.timeoutMs, fetchImpl)
    ),
  ];

  if (opsToken) {
    checks.push(
      runCheck("GET /ops/analysis-worker-health with SMOKE_OPS_TOKEN", () =>
        checkAnalysisWorkerHealth(
          baseUrl,
          options.timeoutMs,
          opsToken,
          fetchImpl
        )
      )
    );
  } else {
    checks.push(
      Promise.resolve({
        name: "GET /ops/analysis-worker-health with SMOKE_OPS_TOKEN",
        status: "warn",
        detail: "skipped; set SMOKE_OPS_TOKEN to verify the external Worker",
        latencyMs: 0,
      })
    );
  }

  if (authToken) {
    checks.push(
      runCheck("GET /api/credits/me with SMOKE_AUTH_TOKEN", () =>
        checkAuthenticatedCredits(
          baseUrl,
          options.timeoutMs,
          authToken,
          fetchImpl
        )
      )
    );
    if (options.createCheckout) {
      checks.push(
        runCheck(
          "POST /api/billing/create-checkout with SMOKE_AUTH_TOKEN",
          () =>
            checkAuthenticatedCheckout(
              baseUrl,
              options.timeoutMs,
              authToken,
              fetchImpl
            )
        )
      );
    } else {
      checks.push(
        Promise.resolve({
          name: "POST /api/billing/create-checkout with SMOKE_AUTH_TOKEN",
          status: "warn",
          detail:
            "skipped; set SMOKE_CREATE_CHECKOUT=true to create a real checkout session",
          latencyMs: 0,
        })
      );
    }
  } else {
    checks.push(
      Promise.resolve({
        name: "authenticated credit smoke",
        status: "warn",
        detail:
          "skipped; set SMOKE_AUTH_TOKEN to verify an authenticated test account balance",
        latencyMs: 0,
      })
    );
  }

  return { baseUrl, checks: await Promise.all(checks) };
}

export function printSmokeResults(baseUrl: string, checks: SmokeCheck[]): void {
  console.log(`Deploy smoke target: ${baseUrl}`);
  for (const check of checks) {
    const mark =
      check.status === "pass"
        ? "PASS"
        : check.status === "warn"
          ? "WARN"
          : "FAIL";
    console.log(
      `[${mark}] ${check.name} (${check.latencyMs}ms) - ${check.detail}`
    );
  }
  const failed = checks.filter(check => check.status === "fail");
  const warned = checks.filter(check => check.status === "warn");
  console.log(
    `Summary: ${checks.length - failed.length - warned.length} passed, ${warned.length} warned, ${failed.length} failed`
  );
}
