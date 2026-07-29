import { printSmokeResults, runDeploySmoke } from "./deploySmokeCore";

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

function readTimeoutMs(): number {
  const raw = readArg("timeout-ms") ?? process.env.SMOKE_TIMEOUT_MS ?? "";
  const timeoutMs = Number.parseInt(raw, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(timeoutMs, 60_000);
}

async function main(): Promise<void> {
  const { baseUrl, checks } = await runDeploySmoke({
    baseUrl: readArg("base-url") ?? process.env.SMOKE_BASE_URL ?? "",
    expectedOrigin:
      readArg("expected-origin") ?? process.env.SMOKE_EXPECTED_ORIGIN,
    authToken: process.env.SMOKE_AUTH_TOKEN,
    opsToken: process.env.SMOKE_OPS_TOKEN,
    allowInsecureLoopback: envBool("SMOKE_ALLOW_INSECURE_LOOPBACK"),
    timeoutMs: readTimeoutMs(),
    createCheckout: envBool("SMOKE_CREATE_CHECKOUT"),
  });

  printSmokeResults(baseUrl, checks);
  if (checks.some(check => check.status === "fail")) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
