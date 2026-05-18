import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sha256HexUtf8, utf8ByteLength } from "../../sgfPayload";
import { readKatagoMaxVisitsFrom, readKatagoTimeoutMsFrom } from "./config";
import { assertKatagoSmokePathsFromEnv, buildKatagoAnalysisArgv, formatKatagoSmokeCommandPreview } from "./katagoCommand";

import { buildKatagoAnalysisQueryLine, parseMinimalSgfForSmoke } from "./katagoSgfQuery";
import {
  buildKatagoSmokeNormalized,
  detectKatagoStdoutFormat,
  extractJsonObjectsFromKatagoStdout,
  type KatagoSmokeDocument,
} from "./katagoRawParser";

/** worker timeout 후 SIGKILL 까지 대기 (ms) */
export const KATAGO_WORKER_KILL_GRACE_MS = 5000;

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; stdio: StdioOptions }
) => ChildProcess;

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** stdout 수집과 timeout race — 성공·실패 모두에서 `clearTimeout` 으로 타이머 정리. */
export function raceOutputWithTimeout<T>(
  outputPromise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      try {
        onTimeout();
      } catch {
        /* ignore */
      }
      reject(
        new Error(
          `[katago-smoke] ${String(timeoutMs)}ms 안에 KataGo 가 끝나지 않아 중단했습니다. KATAGO_ANALYSIS_TIMEOUT_MS 를 늘리거나 SGF/설정을 확인하세요.`
        )
      );
    }, timeoutMs);
  });
  return Promise.race([outputPromise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  }) as Promise<T>;
}

export function resolveSgfPathFromArgv(argv: string[]): string | null {
  const dash = argv.indexOf("--");
  if (dash >= 0 && argv[dash + 1]) {
    return argv[dash + 1]!;
  }
  const tail = argv.filter((a) => a.length > 0 && a !== "--" && !a.startsWith("-"));
  return tail.length > 0 ? tail[tail.length - 1]! : null;
}

function collectSpawnOutput(
  proc: ChildProcess,
  onStdoutChunk?: (chunk: string) => void
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const chunksOut: Buffer[] = [];
    const chunksErr: Buffer[] = [];
    proc.stdout?.on("data", (c: Buffer | string) => {
      const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
      chunksOut.push(b);
      onStdoutChunk?.(b.toString("utf8"));
    });
    proc.stderr?.on("data", (c: Buffer | string) => {
      chunksErr.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(chunksOut).toString("utf8"),
        stderr: Buffer.concat(chunksErr).toString("utf8"),
        code,
      });
    });
  });
}

export type KatagoSmokeRunResult = {
  rawPath: string;
  stderrPath: string;
  normalizedPath: string;
  document: KatagoSmokeDocument;
};

export async function runKatagoSmoke(opts: {
  sgfPath: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  outDir?: string;
  spawnFn?: SpawnFn;
}): Promise<KatagoSmokeRunResult> {
  const env = opts.env != null ? { ...process.env, ...opts.env } : process.env;
  const paths = assertKatagoSmokePathsFromEnv(env);
  const sgfAbsolute = path.resolve(opts.cwd ?? process.cwd(), opts.sgfPath);
  const sgfText = await readFile(sgfAbsolute, "utf8");
  const sgfSha256 = sha256HexUtf8(sgfText);
  const sgfSizeBytes = utf8ByteLength(sgfText);

  const maxVisits = readKatagoMaxVisitsFrom(env);
  const timeoutMs = readKatagoTimeoutMsFrom(env);
  const parsed = parseMinimalSgfForSmoke(sgfText);

  const outDir = path.resolve(opts.cwd ?? process.cwd(), opts.outDir ?? path.join(".tmp", "katago"));
  await mkdir(outDir, { recursive: true });
  const ts = timestampForFilename();
  const queryId = `katatalk-smoke-${ts}`;
  const queryLine = buildKatagoAnalysisQueryLine({
    boardSize: parsed.boardSize,
    komi: parsed.komi,
    moves: parsed.moves,
    initialStones: parsed.initialStones,
    maxVisits,
    id: queryId,
  });
  const argv = buildKatagoAnalysisArgv(paths);
  const commandPreview = `${formatKatagoSmokeCommandPreview(paths.binary, argv)} <stdin-json>`;

  const stderrPath = path.join(outDir, `stderr-${ts}.log`);
  const normalizedPath = path.join(outDir, `normalized-${ts}.json`);

  const spawnFn = opts.spawnFn ?? ((cmd, a, o) => spawn(cmd, [...a], { ...o, env: { ...process.env, ...o.env } }));

  const proc = spawnFn(paths.binary, argv, {
    env,
    stdio: ["pipe", "pipe", "pipe"] as StdioOptions,
  });

  const outputPromise = collectSpawnOutput(proc);

  try {
    const stdin = proc.stdin;
    if (!stdin) {
      throw new Error("[katago-smoke] stdin 을 열 수 없습니다.");
    }
    stdin.write(queryLine, "utf8");
    stdin.end();
  } catch (e) {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    throw e;
  }

  const raced = await raceOutputWithTimeout(outputPromise, timeoutMs, () => {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  });

  const { stdout, stderr, code } = raced;

  const objs = extractJsonObjectsFromKatagoStdout(stdout);
  const fmt = detectKatagoStdoutFormat(stdout, objs);
  const rawExt = fmt === "jsonl" ? "jsonl" : fmt === "json" ? "json" : "txt";
  const rawPath = path.join(outDir, `raw-${ts}.${rawExt}`);

  await writeFile(rawPath, stdout, "utf8");
  await writeFile(stderrPath, stderr, "utf8");

  const document = buildKatagoSmokeNormalized({
    sgfSha256,
    sgfSizeBytes,
    rawStdout: stdout,
    exitCode: code,
    commandPreview,
  });

  await writeFile(normalizedPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  return { rawPath, stderrPath, normalizedPath, document };
}

/** stderr 를 DB `error_message` 용으로만 짧게 요약(경로·긴 줄 축소, 원문 로그 금지). */
export function summarizeKatagoStderrForDb(stderr: string, maxLen = 420): string {
  const t = stderr.trim().replace(/\r\n/g, "\n");
  if (!t) {
    return "";
  }
  const redacted = t
    .replace(/[A-Za-z]:\\[^\s]+/g, "<path>")
    .replace(/\/[^\s]+/g, (m) => (m.length > 32 ? "<path>" : m));
  const oneLine = redacted.replace(/\s+/g, " ").slice(0, maxLen);
  return oneLine.length < t.length ? `${oneLine}…` : oneLine;
}

export async function runKatagoWorkerAnalysisQueryLines(opts: {
  /** 각 줄은 JSON + `\n` (여러 줄이면 한 프로세스 stdin 에 연속 기록) */
  stdinPayload: string;
  jobId: string;
  env?: NodeJS.ProcessEnv;
  spawnFn?: SpawnFn;
  timeoutMs: number;
  onStdoutChunk?: (chunk: string) => void;
}): Promise<{ stdout: string; stderr: string; code: number | null; commandPreview: string }> {
  const env = opts.env != null ? { ...process.env, ...opts.env } : process.env;
  const paths = assertKatagoSmokePathsFromEnv(env);
  const argv = buildKatagoAnalysisArgv(paths);
  const commandPreview = `${formatKatagoSmokeCommandPreview(paths.binary, argv)} <stdin-json>`;

  const spawnFn = opts.spawnFn ?? ((cmd, a, o) => spawn(cmd, [...a], { ...o, env: { ...process.env, ...o.env } }));

  const proc = spawnFn(paths.binary, argv, {
    env,
    stdio: ["pipe", "pipe", "pipe"] as StdioOptions,
  });

  const outputPromise = collectSpawnOutput(proc, opts.onStdoutChunk);
  let killFallbackTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelKillFallback = () => {
    if (killFallbackTimer !== undefined) {
      clearTimeout(killFallbackTimer);
      killFallbackTimer = undefined;
    }
  };
  proc.once("close", () => {
    cancelKillFallback();
  });

  try {
    const stdin = proc.stdin;
    if (!stdin) {
      throw new Error("KATAGO_STDIN_UNAVAILABLE: KataGo stdin 을 열 수 없습니다.");
    }
    stdin.write(opts.stdinPayload, "utf8");
    stdin.end();
  } catch (e) {
    cancelKillFallback();
    try {
      proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    throw e;
  }

  const onTimeout = () => {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    killFallbackTimer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, KATAGO_WORKER_KILL_GRACE_MS);
  };

  try {
    const raced = await raceOutputWithTimeout(outputPromise, opts.timeoutMs, onTimeout);
    return { stdout: raced.stdout, stderr: raced.stderr, code: raced.code, commandPreview };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ms 안에 KataGo/.test(msg) || /did not finish/i.test(msg)) {
      throw new Error(`KATAGO_TIMEOUT: ${msg}`);
    }
    throw e instanceof Error ? e : new Error(msg);
  }
}

/**
 * Worker 전용: KataGo `analysis` 1회 실행. raw stdout 은 호출자가 DB에 넣지 않는다.
 * timeout 시 SIGTERM → grace 후 SIGKILL.
 */
export async function runKatagoWorkerAnalysisV1(opts: {
  sgfContent: string;
  jobId: string;
  env?: NodeJS.ProcessEnv;
  spawnFn?: SpawnFn;
}): Promise<{ stdout: string; stderr: string; code: number | null; commandPreview: string }> {
  const env = opts.env != null ? { ...process.env, ...opts.env } : process.env;
  const maxVisits = readKatagoMaxVisitsFrom(env);
  const timeoutMs = readKatagoTimeoutMsFrom(env);
  const parsed = parseMinimalSgfForSmoke(opts.sgfContent);
  const queryLine = buildKatagoAnalysisQueryLine({
    boardSize: parsed.boardSize,
    komi: parsed.komi,
    moves: parsed.moves,
    initialStones: parsed.initialStones,
    maxVisits,
    id: `katatalk-worker-${opts.jobId}-${timestampForFilename()}`,
  });
  return runKatagoWorkerAnalysisQueryLines({
    stdinPayload: queryLine,
    jobId: opts.jobId,
    env: opts.env,
    spawnFn: opts.spawnFn,
    timeoutMs,
  });
}

/** CLI 진입 — 성공 시 경로만 stdout 에 한 줄씩(원문 없음). */
export async function runKatagoSmokeCliMain(argv: string[], deps?: { spawnFn?: SpawnFn }): Promise<void> {
  const sgfPath = resolveSgfPathFromArgv(argv);
  if (!sgfPath) {
    console.error(
      "[katago-smoke] SGF 파일 경로가 없습니다. 예: corepack pnpm katago:smoke -- ./samples/test.sgf"
    );
    process.exitCode = 2;
    return;
  }

  try {
    const { rawPath, stderrPath, normalizedPath, document } = await runKatagoSmoke({
      sgfPath,
      spawnFn: deps?.spawnFn,
    });
    console.log(`[katago-smoke] raw: ${pathToFileURL(rawPath).href}`);
    console.log(`[katago-smoke] stderr: ${pathToFileURL(stderrPath).href}`);
    console.log(`[katago-smoke] normalized: ${pathToFileURL(normalizedPath).href}`);
    console.log(`[katago-smoke] ok=${String(document.ok)} rawFormat=${document.katago.rawFormat}`);
    if (!document.ok && document.error) {
      console.error(`[katago-smoke] ${document.error}`);
      process.exitCode = 1;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg);
    process.exitCode = 1;
  }
}
