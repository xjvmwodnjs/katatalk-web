import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import type { StdioOptions } from "node:child_process";

export type KatagoBackendV1 = "cuda" | "opencl" | "tensorrt" | "eigen" | "unknown";
export type KatagoBackendCheckModeV1 = "version" | "analysis_smoke" | "version_then_smoke";

export type KatagoBackendDetectionResultV1 = {
  backend: KatagoBackendV1;
  gpuBackend: boolean;
  ok: boolean;
  timedOut: boolean;
  checkMode?: KatagoBackendCheckModeV1;
  versionOk?: boolean;
  smokeOk?: boolean;
  configFileExists?: boolean;
  configLooksLikeAnalysis?: boolean;
  configGpuDeviceKeyPresent?: boolean;
};

type CommandOutput = {
  stdout: string;
  stderr: string;
  code: number | null;
};

export type KatagoBackendDetectionRunnerV1 = (
  binaryPath: string,
  args: readonly string[],
  opts?: { stdinPayload?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
) => Promise<CommandOutput>;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_SMOKE_VISITS = 10;

function isGpuBackendV1(backend: KatagoBackendV1): boolean {
  return backend === "cuda" || backend === "opencl" || backend === "tensorrt";
}

export function detectKatagoBackendFromTextV1(text: string): KatagoBackendV1 {
  const t = text.toLowerCase();
  if (/\btensorrt\b|tensor\s*rt|trt backend|using trt/.test(t)) {
    return "tensorrt";
  }
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

export function readKatagoBackendCheckModeFrom(env: NodeJS.ProcessEnv): KatagoBackendCheckModeV1 {
  const raw = env.KATAGO_BACKEND_CHECK_MODE?.trim().toLowerCase();
  if (raw === "analysis_smoke" || raw === "version_then_smoke" || raw === "version") {
    return raw;
  }
  return "version";
}

export function readKatagoBackendCheckSmokeVisitsFrom(env: NodeJS.ProcessEnv): number {
  const n = parsePositiveInt(env.KATAGO_BACKEND_CHECK_SMOKE_VISITS);
  return n == null ? DEFAULT_SMOKE_VISITS : Math.min(200, Math.max(1, n));
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

function runKatagoCommand(
  binaryPath: string,
  args: readonly string[],
  opts?: { stdinPayload?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    const stdio: StdioOptions = opts?.stdinPayload != null ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"];
    const proc = spawn(binaryPath, [...args], {
      stdio,
      env: opts?.env != null ? { ...process.env, ...opts.env } : process.env,
    });
    let settled = false;
    const timeoutId =
      opts?.timeoutMs != null
        ? setTimeout(() => {
            if (settled) {
              return;
            }
            settled = true;
            try {
              proc.kill("SIGTERM");
            } catch {
              // ignore kill failures; startup guard still fails closed.
            }
            reject(new Error("KATAGO_BACKEND_CHECK_TIMEOUT"));
          }, opts.timeoutMs)
        : undefined;
    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId != null) {
        clearTimeout(timeoutId);
      }
      fn();
    };
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout?.on("data", (chunk: Buffer | string) => out.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    proc.stderr?.on("data", (chunk: Buffer | string) => err.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    proc.on("error", (e) => finish(() => reject(e)));
    proc.on("close", (code) => {
      finish(() =>
        resolve({
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
          code,
        })
      );
    });
    if (opts?.stdinPayload != null) {
      proc.stdin?.write(opts.stdinPayload, "utf8");
      proc.stdin?.end();
    }
  });
}

function buildKatagoBackendSmokeQueryLine(visits: number): string {
  return `${JSON.stringify({
    id: "katatalk-backend-smoke",
    moves: [],
    rules: "japanese",
    komi: 6.5,
    boardXSize: 19,
    boardYSize: 19,
    analyzeTurns: [0],
    maxVisits: visits,
    includeOwnership: false,
    includePolicy: false,
    analysisPVLen: 1,
  })}\n`;
}

function buildKatagoAnalysisArgs(env: NodeJS.ProcessEnv): string[] | null {
  const config = env.KATAGO_CONFIG_PATH?.trim();
  const model = env.KATAGO_MODEL_PATH?.trim();
  if (!config || !model) {
    return null;
  }
  return ["analysis", "-config", config, "-model", model];
}

function hasSmokeResponseV1(stdout: string): boolean {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.rootInfo != null && typeof obj.rootInfo === "object") {
        return true;
      }
      if (Array.isArray(obj.moveInfos)) {
        return true;
      }
    } catch {
      // KataGo can emit non-JSON status lines before JSONL output.
    }
  }
  return false;
}

async function readKatagoConfigSanityFromEnv(env: NodeJS.ProcessEnv): Promise<Pick<
  KatagoBackendDetectionResultV1,
  "configFileExists" | "configLooksLikeAnalysis" | "configGpuDeviceKeyPresent"
>> {
  const configPath = env.KATAGO_CONFIG_PATH?.trim();
  if (!configPath) {
    return { configFileExists: false, configLooksLikeAnalysis: false, configGpuDeviceKeyPresent: false };
  }
  try {
    await access(configPath, fsConstants.R_OK);
    const raw = await readFile(configPath, "utf8");
    return {
      configFileExists: true,
      configLooksLikeAnalysis: /numSearchThreadsPerAnalysisThread|numAnalysisThreads|maxVisits|nnCacheSizePowerOfTwo/i.test(raw),
      configGpuDeviceKeyPresent: /cudaDeviceToUse|openclDeviceToUse/i.test(raw),
    };
  } catch {
    return { configFileExists: false, configLooksLikeAnalysis: false, configGpuDeviceKeyPresent: false };
  }
}

function emptyDetectionResult(
  backend: KatagoBackendV1,
  mode: KatagoBackendCheckModeV1,
  extra?: Partial<KatagoBackendDetectionResultV1>
): KatagoBackendDetectionResultV1 {
  return {
    backend,
    gpuBackend: isGpuBackendV1(backend),
    ok: false,
    timedOut: false,
    checkMode: mode,
    versionOk: false,
    smokeOk: false,
    ...extra,
  };
}

export async function detectKatagoBackendV1(opts: {
  env?: NodeJS.ProcessEnv;
  runner?: KatagoBackendDetectionRunnerV1;
  timeoutMs?: number;
} = {}): Promise<KatagoBackendDetectionResultV1> {
  const env = opts.env ?? process.env;
  const binaryPath = env.KATAGO_BINARY_PATH?.trim();
  const mode = readKatagoBackendCheckModeFrom(env);
  const configSanity = await readKatagoConfigSanityFromEnv(env);
  if (!binaryPath) {
    return emptyDetectionResult("unknown", mode, configSanity);
  }
  const runner = opts.runner ?? runKatagoCommand;
  const timeoutMs = opts.timeoutMs ?? readKatagoBackendCheckTimeoutMsFrom(env);
  try {
    let versionOutput: CommandOutput | null = null;
    let smokeOutput: CommandOutput | null = null;

    if (mode === "version" || mode === "version_then_smoke") {
      versionOutput = await withTimeout(runner(binaryPath, ["version"], { env, timeoutMs }), timeoutMs);
    }

    if (mode === "analysis_smoke" || mode === "version_then_smoke") {
      const args = buildKatagoAnalysisArgs(env);
      if (!args) {
        return emptyDetectionResult(detectKatagoBackendFromTextV1(`${versionOutput?.stdout ?? ""}\n${versionOutput?.stderr ?? ""}`), mode, {
          ...configSanity,
          versionOk: versionOutput?.code === 0,
        });
      }
      smokeOutput = await withTimeout(
        runner(binaryPath, args, {
          env,
          timeoutMs,
          stdinPayload: buildKatagoBackendSmokeQueryLine(readKatagoBackendCheckSmokeVisitsFrom(env)),
        }),
        timeoutMs
      );
    }

    const backend = detectKatagoBackendFromTextV1(
      `${versionOutput?.stdout ?? ""}\n${versionOutput?.stderr ?? ""}\n${smokeOutput?.stdout ?? ""}\n${smokeOutput?.stderr ?? ""}`
    );
    const versionOk = versionOutput == null ? undefined : versionOutput.code === 0;
    const smokeOk = smokeOutput == null ? undefined : smokeOutput.code === 0 && hasSmokeResponseV1(smokeOutput.stdout);
    const ok =
      mode === "version"
        ? versionOk === true && backend !== "unknown"
        : mode === "analysis_smoke"
          ? smokeOk === true
          : versionOk === true && smokeOk === true;
    return {
      backend,
      gpuBackend: isGpuBackendV1(backend),
      ok,
      timedOut: false,
      checkMode: mode,
      versionOk,
      smokeOk,
      ...configSanity,
    };
  } catch (e) {
    const timedOut = e instanceof Error && e.message === "KATAGO_BACKEND_CHECK_TIMEOUT";
    return emptyDetectionResult("unknown", mode, { ...configSanity, timedOut });
  }
}

export function buildKatagoBackendLogLineV1(result: KatagoBackendDetectionResultV1, env: NodeJS.ProcessEnv): string {
  return [
    "[analysis-worker] katago backend",
    `katagoBackend=${result.backend}`,
    `katagoGpuBackend=${String(result.gpuBackend)}`,
    `katagoBackendCheckOk=${String(result.ok)}`,
    `katagoBackendCheckMode=${result.checkMode ?? readKatagoBackendCheckModeFrom(env)}`,
    `katagoSmokeOk=${String(result.smokeOk === true)}`,
    `katagoBackendCheckTimedOut=${String(result.timedOut)}`,
    `requireGpuBackend=${String(readKatagoRequireGpuBackendFrom(env))}`,
    `hasBinaryPath=${String(Boolean(env.KATAGO_BINARY_PATH?.trim()))}`,
    `hasConfigPath=${String(Boolean(env.KATAGO_CONFIG_PATH?.trim()))}`,
    `hasModelPath=${String(Boolean(env.KATAGO_MODEL_PATH?.trim()))}`,
    `configFileExists=${String(result.configFileExists === true)}`,
    `configLooksLikeAnalysis=${String(result.configLooksLikeAnalysis === true)}`,
    `configGpuDeviceKeyPresent=${String(result.configGpuDeviceKeyPresent === true)}`,
  ].join(" ");
}

export function assertKatagoGpuBackendRequirementV1(result: KatagoBackendDetectionResultV1, env: NodeJS.ProcessEnv): void {
  if (!readKatagoRequireGpuBackendFrom(env) || (result.ok && result.gpuBackend)) {
    return;
  }
  throw new Error(`KATAGO_GPU_BACKEND_REQUIRED: katagoBackend=${result.backend}`);
}
