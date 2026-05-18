import { spawn } from "node:child_process";

export type KatagoBackendV1 = "cuda" | "opencl" | "eigen" | "unknown";

export type KatagoBackendDetectionResultV1 = {
  backend: KatagoBackendV1;
  gpuBackend: boolean;
  ok: boolean;
  timedOut: boolean;
};

type CommandOutput = {
  stdout: string;
  stderr: string;
  code: number | null;
};

export type KatagoBackendDetectionRunnerV1 = (
  binaryPath: string,
  args: readonly string[]
) => Promise<CommandOutput>;

const DEFAULT_TIMEOUT_MS = 10_000;

export function detectKatagoBackendFromTextV1(text: string): KatagoBackendV1 {
  const t = text.toLowerCase();
  if (/\bcuda\b|using cuda|cuda backend/.test(t)) {
    return "cuda";
  }
  if (/\bopencl\b|using opencl|opencl backend/.test(t)) {
    return "opencl";
  }
  if (/\beigen\b|cpu backend|using cpu|backend[^\n\r]*cpu/.test(t)) {
    return "eigen";
  }
  return "unknown";
}

function parsePositiveInt(raw: string | undefined): number | null {
  const t = raw?.trim();
  if (!t || !/^\d+$/.test(t)) {
    return null;
  }
  const n = Number(t);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function readKatagoBackendCheckTimeoutMsFrom(env: NodeJS.ProcessEnv): number {
  const n = parsePositiveInt(env.KATAGO_BACKEND_CHECK_TIMEOUT_MS);
  return n == null ? DEFAULT_TIMEOUT_MS : Math.min(60_000, Math.max(100, n));
}

export function readKatagoRequireGpuBackendFrom(env: NodeJS.ProcessEnv): boolean {
  return env.KATAGO_REQUIRE_GPU_BACKEND?.trim().toLowerCase() === "true";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("KATAGO_BACKEND_CHECK_TIMEOUT")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }) as Promise<T>;
}

function runKatagoVersionCommand(binaryPath: string, args: readonly string[]): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout?.on("data", (chunk: Buffer | string) => out.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    proc.stderr?.on("data", (chunk: Buffer | string) => err.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        code,
      });
    });
  });
}

export async function detectKatagoBackendV1(opts: {
  env?: NodeJS.ProcessEnv;
  runner?: KatagoBackendDetectionRunnerV1;
  timeoutMs?: number;
} = {}): Promise<KatagoBackendDetectionResultV1> {
  const env = opts.env ?? process.env;
  const binaryPath = env.KATAGO_BINARY_PATH?.trim();
  if (!binaryPath) {
    return { backend: "unknown", gpuBackend: false, ok: false, timedOut: false };
  }
  const runner = opts.runner ?? runKatagoVersionCommand;
  const timeoutMs = opts.timeoutMs ?? readKatagoBackendCheckTimeoutMsFrom(env);
  try {
    const output = await withTimeout(runner(binaryPath, ["version"]), timeoutMs);
    const backend = detectKatagoBackendFromTextV1(`${output.stdout}\n${output.stderr}`);
    return { backend, gpuBackend: backend === "cuda" || backend === "opencl", ok: output.code === 0 && backend !== "unknown", timedOut: false };
  } catch (e) {
    const timedOut = e instanceof Error && e.message === "KATAGO_BACKEND_CHECK_TIMEOUT";
    return { backend: "unknown", gpuBackend: false, ok: false, timedOut };
  }
}

export function buildKatagoBackendLogLineV1(result: KatagoBackendDetectionResultV1, env: NodeJS.ProcessEnv): string {
  return [
    "[analysis-worker] katago backend",
    `katagoBackend=${result.backend}`,
    `katagoGpuBackend=${String(result.gpuBackend)}`,
    `katagoBackendCheckOk=${String(result.ok)}`,
    `katagoBackendCheckTimedOut=${String(result.timedOut)}`,
    `requireGpuBackend=${String(readKatagoRequireGpuBackendFrom(env))}`,
  ].join(" ");
}

export function assertKatagoGpuBackendRequirementV1(result: KatagoBackendDetectionResultV1, env: NodeJS.ProcessEnv): void {
  if (!readKatagoRequireGpuBackendFrom(env) || (result.ok && result.gpuBackend)) {
    return;
  }
  throw new Error(`KATAGO_GPU_BACKEND_REQUIRED: katagoBackend=${result.backend}`);
}
