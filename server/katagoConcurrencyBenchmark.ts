import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CUSTOMER_STYLE_KATAGO_PRODUCT_SMOKE_FIXTURES } from "./katagoProductSmokeSuite";
import { readKatagoMaxVisitsFrom } from "./worker/analysisEngines/config";
import { parseMinimalSgfForSmoke } from "./worker/analysisEngines/katagoSgfQuery";

export const KATAGO_CONCURRENCY_PROTOCOL =
  "katatalk-katago-concurrency-v1" as const;

export type KatagoConcurrencyPhaseDurations = {
  totalBeforeQualityGate: number | null;
  rootAnalysis: number | null;
  rootStage: number | null;
  multiTurn: number | null;
  signalPlanning: number | null;
  deepSearch: number | null;
  winrateTimeline: number | null;
};

export type KatagoConcurrencyQualitySummary = {
  ok: boolean;
  failureCount: number;
  warningCount: number;
  issueCodes: string[];
};

export type KatagoConcurrencyRunnerRequest =
  | {
      protocol: typeof KATAGO_CONCURRENCY_PROTOCOL;
      type: "analyze";
      jobId: string;
      sgfContent: string;
      language: string;
      maxVisits: number;
      fileName: string;
    }
  | {
      protocol: typeof KATAGO_CONCURRENCY_PROTOCOL;
      type: "shutdown";
    };

export type KatagoConcurrencyRunnerResult = {
  protocol: typeof KATAGO_CONCURRENCY_PROTOCOL;
  type: "result";
  jobId: string;
  ok: boolean;
  durationMs: number;
  quality: KatagoConcurrencyQualitySummary;
  phaseDurationsMs: KatagoConcurrencyPhaseDurations;
  error: string | null;
};

export type KatagoConcurrencyRunnerResponse =
  | {
      protocol: typeof KATAGO_CONCURRENCY_PROTOCOL;
      type: "ready";
      pid: number;
    }
  | KatagoConcurrencyRunnerResult
  | {
      protocol: typeof KATAGO_CONCURRENCY_PROTOCOL;
      type: "stopped";
      pid: number;
    };

export type DurationStats = {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
};

export type KatagoConcurrencyBenchmarkArgs = {
  sgfPath: string | null;
  outDir?: string;
  levels: number[];
  jobs: number;
  language: string;
  jobTimeoutMs: number;
  memoryReserveMiB: number;
  forceMemoryRisk: boolean;
  maxQueueP95Ms: number;
  maxEngineP95Ms: number;
  maxEndToEndP95Ms: number;
  minThroughputJobsPerMinute: number;
  help: boolean;
};

export type KatagoConcurrencyBenchmarkJobRow = {
  jobIndex: number;
  jobId: string;
  laneId: number;
  passed: boolean;
  queueWaitMs: number;
  engineDurationMs: number | null;
  endToEndMs: number;
  quality: KatagoConcurrencyQualitySummary;
  phaseDurationsMs: KatagoConcurrencyPhaseDurations;
  error: string | null;
};

export type KatagoConcurrencySloThresholds = {
  maxQueueP95Ms: number;
  maxEngineP95Ms: number;
  maxEndToEndP95Ms: number;
  minThroughputJobsPerMinute: number;
  memoryReserveMiB: number;
};

export type KatagoConcurrencySloCheck = {
  name: string;
  passed: boolean;
  actual: number | null;
  comparator: "<=" | ">=";
  threshold: number;
  unit: string;
};

export type KatagoConcurrencyBenchmarkLevel = {
  concurrency: number;
  jobs: number;
  status: "completed" | "failed" | "skipped";
  passed: boolean;
  error: string | null;
  wallDurationMs: number | null;
  successfulJobs: number;
  failedJobs: number;
  throughputJobsPerMinute: number | null;
  queueWaitMs: DurationStats;
  engineDurationMs: DurationStats;
  endToEndMs: DurationStats;
  rootAnalysisMs: DurationStats;
  multiTurnMs: DurationStats;
  memory: {
    approximate: true;
    baselineUsedMiB: number | null;
    peakUsedMiB: number | null;
    peakUsedDeltaMiB: number | null;
    minimumFreeMiB: number | null;
    estimatedRequiredMiB: number | null;
  };
  sloChecks: KatagoConcurrencySloCheck[];
  rows: KatagoConcurrencyBenchmarkJobRow[];
};

export type KatagoConcurrencyBenchmarkReport = {
  passed: boolean;
  allRequestedLevelsCompleted: boolean;
  recommendedConcurrency: number | null;
  scope: "single-host-isolated-worker-processes";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outDir: string;
  jsonPath: string;
  markdownPath: string;
  jsonFileUrl: string;
  markdownFileUrl: string;
  target: {
    name: string;
    path: string;
    moves: number;
    generatedFixture: boolean;
  };
  profile: {
    maxVisits: number;
    multiTurnMax: number | null;
    persistentRootEnabled: boolean;
    persistentRootStrict: boolean;
    persistentMultiTurnEnabled: boolean;
    persistentMultiTurnStrict: boolean;
    deepSearchEnabled: boolean;
    winrateTimelineEnabled: boolean;
  };
  host: {
    platform: NodeJS.Platform;
    cpuModel: string;
    logicalCpuCount: number;
    totalMemoryMiB: number;
    initialFreeMemoryMiB: number;
  };
  requested: {
    levels: number[];
    jobsPerLevel: number;
    forceMemoryRisk: boolean;
  };
  thresholds: KatagoConcurrencySloThresholds;
  levels: KatagoConcurrencyBenchmarkLevel[];
};

export type KatagoConcurrencyBenchmarkLane = {
  id: number;
  ready(): Promise<void>;
  analyze(
    request: Extract<KatagoConcurrencyRunnerRequest, { type: "analyze" }>
  ): Promise<KatagoConcurrencyRunnerResult>;
  close(): Promise<void>;
};

type MemorySnapshot = {
  totalBytes: number;
  freeBytes: number;
};

const EMPTY_PHASES: KatagoConcurrencyPhaseDurations = {
  totalBeforeQualityGate: null,
  rootAnalysis: null,
  rootStage: null,
  multiTurn: null,
  signalPlanning: null,
  deepSearch: null,
  winrateTimeline: null,
};

const DEFAULT_CUSTOMER_FIXTURE = "customer-style-19x19-120-move";
const MIB = 1024 * 1024;

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: boolean
): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (!value) {
    return defaultValue;
  }
  return !["0", "false", "off", "no"].includes(value);
}

function integerEnv(env: NodeJS.ProcessEnv, name: string): number | null {
  const value = Number.parseInt(env[name]?.trim() ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function round(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function toMiB(bytes: number): number {
  return round(bytes / MIB);
}

function percentileNearestRank(
  sortedValues: readonly number[],
  percentile: number
): number | null {
  if (sortedValues.length === 0) {
    return null;
  }
  const rank = Math.ceil((percentile / 100) * sortedValues.length);
  const index = Math.min(sortedValues.length - 1, Math.max(0, rank - 1));
  return sortedValues[index] ?? null;
}

export function buildConcurrencyDurationStats(
  values: readonly number[]
): DurationStats {
  const sorted = values
    .filter(value => Number.isFinite(value) && value >= 0)
    .slice()
    .sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
    mean: sorted.length > 0 ? Math.round(sum / sorted.length) : null,
    p50: percentileNearestRank(sorted, 50),
    p90: percentileNearestRank(sorted, 90),
    p95: percentileNearestRank(sorted, 95),
  };
}

function emptyDurationStats(): DurationStats {
  return buildConcurrencyDurationStats([]);
}

function waitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    timer.unref?.();
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

class ProcessKatagoConcurrencyLane implements KatagoConcurrencyBenchmarkLane {
  readonly id: number;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private stdoutBuffer = "";
  private stderrTail = "";
  private ignoredStdoutTail = "";
  private exited = false;
  private pending: {
    jobId: string;
    timer: ReturnType<typeof setTimeout>;
    resolve: (result: KatagoConcurrencyRunnerResult) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(opts: {
    id: number;
    cwd: string;
    env: NodeJS.ProcessEnv;
    runnerPath: string;
    tsxCliPath: string;
    jobTimeoutMs: number;
  }) {
    this.id = opts.id;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.child = spawn(process.execPath, [opts.tsxCliPath, opts.runnerPath], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", chunk => this.handleStdout(String(chunk)));
    this.child.stderr.on("data", chunk => {
      this.stderrTail = `${this.stderrTail}${String(chunk)}`.slice(-8_000);
    });
    this.child.stdin.on("error", () => {
      // Process closure is handled through the child close/error events.
    });
    this.child.on("error", error => this.handleExit(error));
    this.child.on("close", (code, signal) => {
      this.handleExit(
        new Error(
          `KATAGO_CONCURRENCY_RUNNER_EXITED: lane=${String(this.id)} code=${String(
            code
          )} signal=${String(signal)}${this.processTails()}`
        )
      );
    });
    this.jobTimeoutMs = opts.jobTimeoutMs;
  }

  private readonly jobTimeoutMs: number;

  private processTails(): string {
    const stderr = this.stderrTail.trim();
    const stdout = this.ignoredStdoutTail.trim();
    return `${stderr ? ` stderr=${stderr.slice(-1_000)}` : ""}${
      stdout ? ` stdout=${stdout.slice(-1_000)}` : ""
    }`;
  }

  private handleExit(error: Error): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    this.rejectReady(error);
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) {
        this.handleLine(line);
      }
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.ignoredStdoutTail = `${this.ignoredStdoutTail}${line}\n`.slice(
        -8_000
      );
      return;
    }
    if (
      !isPlainObject(parsed) ||
      parsed.protocol !== KATAGO_CONCURRENCY_PROTOCOL ||
      typeof parsed.type !== "string"
    ) {
      this.ignoredStdoutTail = `${this.ignoredStdoutTail}${line}\n`.slice(
        -8_000
      );
      return;
    }
    if (parsed.type === "ready") {
      this.resolveReady();
      return;
    }
    if (parsed.type !== "result" || !this.pending) {
      return;
    }
    const response = parsed as unknown as KatagoConcurrencyRunnerResult;
    if (response.jobId !== this.pending.jobId) {
      return;
    }
    clearTimeout(this.pending.timer);
    const resolve = this.pending.resolve;
    this.pending = null;
    resolve(response);
  }

  async ready(): Promise<void> {
    await waitWithTimeout(
      this.readyPromise,
      30_000,
      `KATAGO_CONCURRENCY_RUNNER_READY_TIMEOUT: lane=${String(this.id)}`
    );
  }

  analyze(
    request: Extract<KatagoConcurrencyRunnerRequest, { type: "analyze" }>
  ): Promise<KatagoConcurrencyRunnerResult> {
    if (this.exited) {
      return Promise.reject(
        new Error(
          `KATAGO_CONCURRENCY_RUNNER_NOT_AVAILABLE: lane=${String(this.id)}`
        )
      );
    }
    if (this.pending) {
      return Promise.reject(
        new Error(`KATAGO_CONCURRENCY_LANE_BUSY: lane=${String(this.id)}`)
      );
    }
    return new Promise<KatagoConcurrencyRunnerResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(
          `KATAGO_CONCURRENCY_JOB_TIMEOUT: lane=${String(this.id)} job=${request.jobId} timeoutMs=${String(this.jobTimeoutMs)}`
        );
        this.pending = null;
        reject(error);
        this.child.kill();
      }, this.jobTimeoutMs);
      timer.unref?.();
      this.pending = { jobId: request.jobId, timer, resolve, reject };
      this.child.stdin.write(`${JSON.stringify(request)}\n`, "utf8", error => {
        if (!error || !this.pending || this.pending.jobId !== request.jobId) {
          return;
        }
        clearTimeout(this.pending.timer);
        this.pending = null;
        reject(error);
      });
    });
  }

  async close(): Promise<void> {
    if (this.exited) {
      return;
    }
    const closed = new Promise<void>(resolve => {
      this.child.once("close", () => resolve());
    });
    const request: KatagoConcurrencyRunnerRequest = {
      protocol: KATAGO_CONCURRENCY_PROTOCOL,
      type: "shutdown",
    };
    this.child.stdin.end(`${JSON.stringify(request)}\n`, "utf8");
    try {
      await waitWithTimeout(
        closed,
        20_000,
        `KATAGO_CONCURRENCY_RUNNER_CLOSE_TIMEOUT: lane=${String(this.id)}`
      );
    } catch {
      this.child.kill();
      await waitWithTimeout(closed, 5_000, "runner did not exit").catch(
        () => undefined
      );
    }
  }
}

function defaultMemorySnapshot(): MemorySnapshot {
  return { totalBytes: os.totalmem(), freeBytes: os.freemem() };
}

function qualityFailureSummary(
  error: unknown
): KatagoConcurrencyQualitySummary {
  return {
    ok: false,
    failureCount: 1,
    warningCount: 0,
    issueCodes: [errorMessage(error).split(":", 1)[0] ?? "RUNNER_ERROR"],
  };
}

function thresholdCheck(args: {
  name: string;
  actual: number | null;
  comparator: "<=" | ">=";
  threshold: number;
  unit: string;
}): KatagoConcurrencySloCheck {
  const passed =
    args.actual != null &&
    (args.comparator === "<="
      ? args.actual <= args.threshold
      : args.actual >= args.threshold);
  return { ...args, passed };
}

export async function runKatagoConcurrencyLevel(opts: {
  concurrency: number;
  jobs: number;
  sgfContent: string;
  fileName: string;
  language: string;
  maxVisits: number;
  thresholds: KatagoConcurrencySloThresholds;
  estimatedRequiredMiB?: number | null;
  laneFactory: (
    laneId: number
  ) => KatagoConcurrencyBenchmarkLane | Promise<KatagoConcurrencyBenchmarkLane>;
  memorySnapshot?: () => MemorySnapshot;
  memorySampleIntervalMs?: number;
  runId?: string;
}): Promise<KatagoConcurrencyBenchmarkLevel> {
  const memorySnapshot = opts.memorySnapshot ?? defaultMemorySnapshot;
  const lanes: KatagoConcurrencyBenchmarkLane[] = [];
  let memoryTimer: ReturnType<typeof setInterval> | null = null;
  try {
    for (let index = 0; index < opts.concurrency; index++) {
      lanes.push(await opts.laneFactory(index + 1));
    }
    await Promise.all(lanes.map(lane => lane.ready()));

    const initialMemory = memorySnapshot();
    const baselineUsedBytes =
      initialMemory.totalBytes - initialMemory.freeBytes;
    let peakUsedBytes = baselineUsedBytes;
    let minimumFreeBytes = initialMemory.freeBytes;
    const sampleMemory = () => {
      const current = memorySnapshot();
      peakUsedBytes = Math.max(
        peakUsedBytes,
        current.totalBytes - current.freeBytes
      );
      minimumFreeBytes = Math.min(minimumFreeBytes, current.freeBytes);
    };
    memoryTimer = setInterval(
      sampleMemory,
      Math.max(25, opts.memorySampleIntervalMs ?? 250)
    );
    memoryTimer.unref?.();

    const levelStartedAt = Date.now();
    const runId = opts.runId ?? timestampForFilename();
    const rows: KatagoConcurrencyBenchmarkJobRow[] = [];
    let nextJobIndex = 0;

    const runLane = async (lane: KatagoConcurrencyBenchmarkLane) => {
      while (true) {
        const jobIndex = nextJobIndex;
        nextJobIndex += 1;
        if (jobIndex >= opts.jobs) {
          return;
        }
        const dispatchedAt = Date.now();
        const jobId = `katago-concurrency-c${String(opts.concurrency)}-j${String(
          jobIndex + 1
        )}-${runId}`;
        try {
          const result = await lane.analyze({
            protocol: KATAGO_CONCURRENCY_PROTOCOL,
            type: "analyze",
            jobId,
            sgfContent: opts.sgfContent,
            language: opts.language,
            maxVisits: opts.maxVisits,
            fileName: opts.fileName,
          });
          const finishedAt = Date.now();
          const passed =
            result.ok &&
            result.quality.ok &&
            result.quality.failureCount === 0 &&
            result.quality.warningCount === 0;
          rows.push({
            jobIndex: jobIndex + 1,
            jobId,
            laneId: lane.id,
            passed,
            queueWaitMs: dispatchedAt - levelStartedAt,
            engineDurationMs: numberValue(result.durationMs),
            endToEndMs: finishedAt - levelStartedAt,
            quality: result.quality,
            phaseDurationsMs: result.phaseDurationsMs,
            error: result.error,
          });
        } catch (error) {
          const finishedAt = Date.now();
          rows.push({
            jobIndex: jobIndex + 1,
            jobId,
            laneId: lane.id,
            passed: false,
            queueWaitMs: dispatchedAt - levelStartedAt,
            engineDurationMs: null,
            endToEndMs: finishedAt - levelStartedAt,
            quality: qualityFailureSummary(error),
            phaseDurationsMs: { ...EMPTY_PHASES },
            error: errorMessage(error).slice(0, 2_000),
          });
        }
      }
    };

    await Promise.all(lanes.map(runLane));
    sampleMemory();
    const wallDurationMs = Date.now() - levelStartedAt;
    rows.sort((a, b) => a.jobIndex - b.jobIndex);
    const successfulJobs = rows.filter(row => row.passed).length;
    const failedJobs = rows.length - successfulJobs;
    const throughputJobsPerMinute =
      wallDurationMs > 0
        ? round(successfulJobs / (wallDurationMs / 60_000), 2)
        : null;
    const queueWaitMs = buildConcurrencyDurationStats(
      rows.map(row => row.queueWaitMs)
    );
    const engineDurationMs = buildConcurrencyDurationStats(
      rows
        .map(row => row.engineDurationMs)
        .filter((value): value is number => value != null)
    );
    const endToEndMs = buildConcurrencyDurationStats(
      rows.map(row => row.endToEndMs)
    );
    const rootAnalysisMs = buildConcurrencyDurationStats(
      rows
        .map(row => row.phaseDurationsMs.rootAnalysis)
        .filter((value): value is number => value != null)
    );
    const multiTurnMs = buildConcurrencyDurationStats(
      rows
        .map(row => row.phaseDurationsMs.multiTurn)
        .filter((value): value is number => value != null)
    );
    const minimumFreeMiB = toMiB(minimumFreeBytes);
    const sloChecks = [
      thresholdCheck({
        name: "successful jobs",
        actual: successfulJobs,
        comparator: ">=",
        threshold: opts.jobs,
        unit: "jobs",
      }),
      thresholdCheck({
        name: "queue wait p95",
        actual: queueWaitMs.p95,
        comparator: "<=",
        threshold: opts.thresholds.maxQueueP95Ms,
        unit: "ms",
      }),
      thresholdCheck({
        name: "engine duration p95",
        actual: engineDurationMs.p95,
        comparator: "<=",
        threshold: opts.thresholds.maxEngineP95Ms,
        unit: "ms",
      }),
      thresholdCheck({
        name: "end-to-end p95",
        actual: endToEndMs.p95,
        comparator: "<=",
        threshold: opts.thresholds.maxEndToEndP95Ms,
        unit: "ms",
      }),
      thresholdCheck({
        name: "throughput",
        actual: throughputJobsPerMinute,
        comparator: ">=",
        threshold: opts.thresholds.minThroughputJobsPerMinute,
        unit: "jobs/min",
      }),
      thresholdCheck({
        name: "minimum free memory",
        actual: minimumFreeMiB,
        comparator: ">=",
        threshold: opts.thresholds.memoryReserveMiB,
        unit: "MiB",
      }),
    ];

    return {
      concurrency: opts.concurrency,
      jobs: opts.jobs,
      status: "completed",
      passed: sloChecks.every(check => check.passed),
      error: null,
      wallDurationMs,
      successfulJobs,
      failedJobs,
      throughputJobsPerMinute,
      queueWaitMs,
      engineDurationMs,
      endToEndMs,
      rootAnalysisMs,
      multiTurnMs,
      memory: {
        approximate: true,
        baselineUsedMiB: toMiB(baselineUsedBytes),
        peakUsedMiB: toMiB(peakUsedBytes),
        peakUsedDeltaMiB: toMiB(Math.max(0, peakUsedBytes - baselineUsedBytes)),
        minimumFreeMiB,
        estimatedRequiredMiB: opts.estimatedRequiredMiB ?? null,
      },
      sloChecks,
      rows,
    };
  } finally {
    if (memoryTimer) {
      clearInterval(memoryTimer);
    }
    await Promise.allSettled(lanes.map(lane => lane.close()));
  }
}

function unavailableLevel(args: {
  concurrency: number;
  jobs: number;
  status: "failed" | "skipped";
  error: string;
  minimumFreeMiB: number;
  estimatedRequiredMiB: number | null;
}): KatagoConcurrencyBenchmarkLevel {
  return {
    concurrency: args.concurrency,
    jobs: args.jobs,
    status: args.status,
    passed: false,
    error: args.error,
    wallDurationMs: null,
    successfulJobs: 0,
    failedJobs: args.status === "failed" ? args.jobs : 0,
    throughputJobsPerMinute: null,
    queueWaitMs: emptyDurationStats(),
    engineDurationMs: emptyDurationStats(),
    endToEndMs: emptyDurationStats(),
    rootAnalysisMs: emptyDurationStats(),
    multiTurnMs: emptyDurationStats(),
    memory: {
      approximate: true,
      baselineUsedMiB: null,
      peakUsedMiB: null,
      peakUsedDeltaMiB: null,
      minimumFreeMiB: args.minimumFreeMiB,
      estimatedRequiredMiB: args.estimatedRequiredMiB,
    },
    sloChecks: [],
    rows: [],
  };
}

function shiftArg(argv: string[], index: number, flag: string): string | null {
  const current = argv[index] ?? "";
  const prefix = `${flag}=`;
  if (current.startsWith(prefix)) {
    return current.slice(prefix.length);
  }
  return argv[index + 1] && !argv[index + 1]!.startsWith("-")
    ? argv[index + 1]!
    : null;
}

function positiveInteger(value: string | null, max: number): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(max, parsed) : null;
}

function positiveNumber(value: string | null, max: number): number | null {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(max, parsed) : null;
}

export function parseKatagoConcurrencyBenchmarkArgs(
  argv: string[]
): KatagoConcurrencyBenchmarkArgs {
  const parsed: KatagoConcurrencyBenchmarkArgs = {
    sgfPath: null,
    levels: [1, 2, 4],
    jobs: 4,
    language: "ko",
    jobTimeoutMs: 15 * 60_000,
    memoryReserveMiB: 1_024,
    forceMemoryRisk: false,
    maxQueueP95Ms: 30_000,
    maxEngineP95Ms: 120_000,
    maxEndToEndP95Ms: 120_000,
    minThroughputJobsPerMinute: 1,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--") {
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
      continue;
    }
    if (arg === "--force-memory-risk") {
      parsed.forceMemoryRisk = true;
      continue;
    }
    const valueFlags: Array<{
      flag: string;
      apply: (value: string) => void;
    }> = [
      {
        flag: "--out-dir",
        apply: value => {
          parsed.outDir = value;
        },
      },
      {
        flag: "--lang",
        apply: value => {
          parsed.language = value;
        },
      },
      {
        flag: "--levels",
        apply: value => {
          const levels = Array.from(
            new Set(
              value
                .split(",")
                .map(item => positiveInteger(item.trim(), 8))
                .filter((item): item is number => item != null)
            )
          ).sort((a, b) => a - b);
          if (levels.length > 0) {
            parsed.levels = levels;
          }
        },
      },
      {
        flag: "--jobs",
        apply: value => {
          parsed.jobs = positiveInteger(value, 100) ?? parsed.jobs;
        },
      },
      {
        flag: "--job-timeout-ms",
        apply: value => {
          parsed.jobTimeoutMs =
            positiveInteger(value, 60 * 60_000) ?? parsed.jobTimeoutMs;
        },
      },
      {
        flag: "--memory-reserve-mib",
        apply: value => {
          parsed.memoryReserveMiB =
            positiveNumber(value, 1024 * 1024) ?? parsed.memoryReserveMiB;
        },
      },
      {
        flag: "--max-queue-p95-ms",
        apply: value => {
          parsed.maxQueueP95Ms =
            positiveInteger(value, 60 * 60_000) ?? parsed.maxQueueP95Ms;
        },
      },
      {
        flag: "--max-engine-p95-ms",
        apply: value => {
          parsed.maxEngineP95Ms =
            positiveInteger(value, 60 * 60_000) ?? parsed.maxEngineP95Ms;
        },
      },
      {
        flag: "--max-end-to-end-p95-ms",
        apply: value => {
          parsed.maxEndToEndP95Ms =
            positiveInteger(value, 60 * 60_000) ?? parsed.maxEndToEndP95Ms;
        },
      },
      {
        flag: "--min-throughput-jobs-per-minute",
        apply: value => {
          parsed.minThroughputJobsPerMinute =
            positiveNumber(value, 10_000) ?? parsed.minThroughputJobsPerMinute;
        },
      },
    ];
    const matched = valueFlags.find(
      entry => arg === entry.flag || arg.startsWith(`${entry.flag}=`)
    );
    if (matched) {
      const value = shiftArg(argv, index, matched.flag);
      if (value) {
        matched.apply(value);
        if (arg === matched.flag) {
          index += 1;
        }
      }
      continue;
    }
    if (!arg.startsWith("-")) {
      parsed.sgfPath = arg;
    }
  }
  return parsed;
}

async function resolveTarget(opts: {
  cwd: string;
  outDir: string;
  sgfPath: string | null | undefined;
}): Promise<{
  name: string;
  path: string;
  sgfContent: string;
  moves: number;
  generatedFixture: boolean;
}> {
  if (opts.sgfPath) {
    const absolutePath = path.resolve(opts.cwd, opts.sgfPath);
    const sgfContent = await readFile(absolutePath, "utf8");
    return {
      name: path.basename(absolutePath),
      path: absolutePath,
      sgfContent,
      moves: parseMinimalSgfForSmoke(sgfContent).moves.length,
      generatedFixture: false,
    };
  }
  const fixture = CUSTOMER_STYLE_KATAGO_PRODUCT_SMOKE_FIXTURES.find(
    item => item.name === DEFAULT_CUSTOMER_FIXTURE
  );
  if (!fixture) {
    throw new Error(
      `KATAGO_CONCURRENCY_FIXTURE_MISSING: ${DEFAULT_CUSTOMER_FIXTURE}`
    );
  }
  const fixtureDir = path.join(opts.outDir, "fixtures");
  await mkdir(fixtureDir, { recursive: true });
  const fixturePath = path.join(fixtureDir, fixture.fileName);
  await writeFile(fixturePath, `${fixture.sgf}\n`, "utf8");
  return {
    name: fixture.name,
    path: fixturePath,
    sgfContent: fixture.sgf,
    moves: parseMinimalSgfForSmoke(fixture.sgf).moves.length,
    generatedFixture: true,
  };
}

function createProcessLaneFactory(opts: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  jobTimeoutMs: number;
}): (laneId: number) => KatagoConcurrencyBenchmarkLane {
  const runnerPath = path.resolve(
    opts.cwd,
    "scripts",
    "katago-concurrency-runner.ts"
  );
  const tsxCliPath = path.resolve(
    opts.cwd,
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs"
  );
  return laneId =>
    new ProcessKatagoConcurrencyLane({
      id: laneId,
      cwd: opts.cwd,
      env: opts.env,
      runnerPath,
      tsxCliPath,
      jobTimeoutMs: opts.jobTimeoutMs,
    });
}

function formatValue(value: number | null, suffix = ""): string {
  return value == null ? "n/a" : `${String(value)}${suffix}`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderKatagoConcurrencyBenchmarkMarkdown(
  report: KatagoConcurrencyBenchmarkReport
): string {
  const lines = [
    "# KataGo Concurrency Benchmark",
    "",
    `- Result: **${report.passed ? "PASS" : "NO-GO"}**`,
    `- Recommended concurrency: **${formatValue(report.recommendedConcurrency)}**`,
    `- Target: \`${escapeMarkdown(report.target.name)}\` (${String(report.target.moves)} moves)`,
    `- Profile: visits=${String(report.profile.maxVisits)}, multi-turn=${formatValue(report.profile.multiTurnMax)}, persistent-root=${String(report.profile.persistentRootEnabled)}, persistent-multi-turn=${String(report.profile.persistentMultiTurnEnabled)}`,
    `- Host: ${escapeMarkdown(report.host.cpuModel)}, ${String(report.host.logicalCpuCount)} logical CPUs, ${String(report.host.totalMemoryMiB)} MiB RAM`,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    "",
    "> Scope: this is a single-host capacity test using isolated long-lived Worker processes. It does not validate Supabase claim contention, staging network latency, autoscaling, or multi-host orchestration.",
    "",
    "## SLO",
    "",
    "| Metric | Threshold |",
    "| --- | ---: |",
    `| Queue wait p95 | <= ${String(report.thresholds.maxQueueP95Ms)} ms |`,
    `| Engine duration p95 | <= ${String(report.thresholds.maxEngineP95Ms)} ms |`,
    `| End-to-end p95 | <= ${String(report.thresholds.maxEndToEndP95Ms)} ms |`,
    `| Throughput | >= ${String(report.thresholds.minThroughputJobsPerMinute)} jobs/min |`,
    `| Minimum free memory | >= ${String(report.thresholds.memoryReserveMiB)} MiB |`,
    "| Quality | all jobs pass with zero warnings/failures |",
    "",
    "## Levels",
    "",
    "| C | Status | Jobs | Queue p95 | Engine p95 | E2E p95 | Jobs/min | Root p95 | Multi p95 | Peak delta* | Min free* | SLO |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const level of report.levels) {
    lines.push(
      `| ${String(level.concurrency)} | ${level.status} | ${String(level.successfulJobs)}/${String(level.jobs)} | ${formatValue(level.queueWaitMs.p95, " ms")} | ${formatValue(level.engineDurationMs.p95, " ms")} | ${formatValue(level.endToEndMs.p95, " ms")} | ${formatValue(level.throughputJobsPerMinute)} | ${formatValue(level.rootAnalysisMs.p95, " ms")} | ${formatValue(level.multiTurnMs.p95, " ms")} | ${formatValue(level.memory.peakUsedDeltaMiB, " MiB")} | ${formatValue(level.memory.minimumFreeMiB, " MiB")} | ${level.passed ? "PASS" : "FAIL"} |`
    );
    if (level.error) {
      lines.push(
        `|  | Reason | ${escapeMarkdown(level.error)} |  |  |  |  |  |  |  |  |  |`
      );
    }
  }
  lines.push(
    "",
    "\* Memory values are approximate whole-system samples, not isolated process RSS.",
    "",
    "## Jobs",
    "",
    "| C | Job | Lane | Queue | Engine | E2E | Root | Multi | Quality |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |"
  );
  for (const level of report.levels) {
    for (const row of level.rows) {
      lines.push(
        `| ${String(level.concurrency)} | ${String(row.jobIndex)} | ${String(row.laneId)} | ${String(row.queueWaitMs)} ms | ${formatValue(row.engineDurationMs, " ms")} | ${String(row.endToEndMs)} ms | ${formatValue(row.phaseDurationsMs.rootAnalysis, " ms")} | ${formatValue(row.phaseDurationsMs.multiTurn, " ms")} | ${row.passed ? "PASS" : `FAIL ${escapeMarkdown(row.error ?? row.quality.issueCodes.join(", "))}`} |`
      );
    }
  }
  lines.push("", "## Gate Checks", "");
  for (const level of report.levels) {
    lines.push(`### Concurrency ${String(level.concurrency)}`, "");
    if (level.sloChecks.length === 0) {
      lines.push(
        `- ${escapeMarkdown(level.error ?? "No checks executed.")}`,
        ""
      );
      continue;
    }
    for (const check of level.sloChecks) {
      lines.push(
        `- [${check.passed ? "x" : " "}] ${check.name}: ${formatValue(check.actual)} ${check.comparator} ${String(check.threshold)} ${check.unit}`
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export async function runKatagoConcurrencyBenchmark(opts: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  sgfPath?: string | null;
  outDir?: string;
  levels?: number[];
  jobs?: number;
  language?: string;
  jobTimeoutMs?: number;
  memoryReserveMiB?: number;
  forceMemoryRisk?: boolean;
  maxQueueP95Ms?: number;
  maxEngineP95Ms?: number;
  maxEndToEndP95Ms?: number;
  minThroughputJobsPerMinute?: number;
  laneFactory?: (
    laneId: number,
    concurrency: number
  ) => KatagoConcurrencyBenchmarkLane | Promise<KatagoConcurrencyBenchmarkLane>;
  memorySnapshot?: () => MemorySnapshot;
  memorySampleIntervalMs?: number;
  onLevelComplete?: (level: KatagoConcurrencyBenchmarkLevel) => void;
}): Promise<KatagoConcurrencyBenchmarkReport> {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const levels = Array.from(new Set(opts.levels ?? [1, 2, 4])).sort(
    (a, b) => a - b
  );
  const jobs = opts.jobs ?? 4;
  const jobTimeoutMs = opts.jobTimeoutMs ?? 15 * 60_000;
  const memorySnapshot = opts.memorySnapshot ?? defaultMemorySnapshot;
  const thresholds: KatagoConcurrencySloThresholds = {
    maxQueueP95Ms: opts.maxQueueP95Ms ?? 30_000,
    maxEngineP95Ms: opts.maxEngineP95Ms ?? 120_000,
    maxEndToEndP95Ms: opts.maxEndToEndP95Ms ?? 120_000,
    minThroughputJobsPerMinute: opts.minThroughputJobsPerMinute ?? 1,
    memoryReserveMiB: opts.memoryReserveMiB ?? 1_024,
  };
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const outDir = path.resolve(
    cwd,
    opts.outDir ??
      path.join(".tmp", "katago-concurrency", timestampForFilename())
  );
  await mkdir(outDir, { recursive: true });
  const target = await resolveTarget({
    cwd,
    outDir,
    sgfPath: opts.sgfPath,
  });
  const initialMemory = memorySnapshot();
  const processLaneFactory = createProcessLaneFactory({
    cwd,
    env,
    jobTimeoutMs,
  });
  const levelReports: KatagoConcurrencyBenchmarkLevel[] = [];
  let observedPeakPerLaneMiB: number | null = null;

  for (const concurrency of levels) {
    if (levelReports.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
    const before = memorySnapshot();
    const freeMiB = toMiB(before.freeBytes);
    const estimatedRequiredMiB =
      observedPeakPerLaneMiB != null
        ? round(
            observedPeakPerLaneMiB * concurrency + thresholds.memoryReserveMiB
          )
        : null;
    if (
      !opts.forceMemoryRisk &&
      (freeMiB < thresholds.memoryReserveMiB ||
        (estimatedRequiredMiB != null && freeMiB < estimatedRequiredMiB))
    ) {
      const level = unavailableLevel({
        concurrency,
        jobs,
        status: "skipped",
        error: `MEMORY_PREFLIGHT_BLOCKED: free=${String(freeMiB)} MiB estimatedRequired=${formatValue(estimatedRequiredMiB, " MiB")} reserve=${String(thresholds.memoryReserveMiB)} MiB. Re-run with --force-memory-risk only on a disposable host.`,
        minimumFreeMiB: freeMiB,
        estimatedRequiredMiB,
      });
      levelReports.push(level);
      opts.onLevelComplete?.(level);
      continue;
    }
    try {
      const level = await runKatagoConcurrencyLevel({
        concurrency,
        jobs,
        sgfContent: target.sgfContent,
        fileName: path.basename(target.path),
        language: opts.language ?? "ko",
        maxVisits: readKatagoMaxVisitsFrom(env),
        thresholds,
        estimatedRequiredMiB,
        laneFactory: laneId =>
          opts.laneFactory
            ? opts.laneFactory(laneId, concurrency)
            : processLaneFactory(laneId),
        memorySnapshot,
        memorySampleIntervalMs: opts.memorySampleIntervalMs,
        runId: `${timestampForFilename()}-${String(concurrency)}`,
      });
      levelReports.push(level);
      if (
        level.memory.peakUsedDeltaMiB != null &&
        level.memory.peakUsedDeltaMiB > 0
      ) {
        observedPeakPerLaneMiB = Math.max(
          observedPeakPerLaneMiB ?? 0,
          level.memory.peakUsedDeltaMiB / concurrency
        );
      }
      opts.onLevelComplete?.(level);
    } catch (error) {
      const after = memorySnapshot();
      const level = unavailableLevel({
        concurrency,
        jobs,
        status: "failed",
        error: errorMessage(error).slice(0, 4_000),
        minimumFreeMiB: toMiB(after.freeBytes),
        estimatedRequiredMiB,
      });
      levelReports.push(level);
      opts.onLevelComplete?.(level);
    }
  }

  const recommendedConcurrency =
    levelReports.find(level => level.status === "completed" && level.passed)
      ?.concurrency ?? null;
  const finishedMs = Date.now();
  const jsonPath = path.join(outDir, "katago-concurrency-report.json");
  const markdownPath = path.join(outDir, "katago-concurrency-report.md");
  const cpu = os.cpus();
  const report: KatagoConcurrencyBenchmarkReport = {
    passed: recommendedConcurrency != null,
    allRequestedLevelsCompleted: levelReports.every(
      level => level.status === "completed"
    ),
    recommendedConcurrency,
    scope: "single-host-isolated-worker-processes",
    startedAt,
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: finishedMs - startedMs,
    outDir,
    jsonPath,
    markdownPath,
    jsonFileUrl: pathToFileURL(jsonPath).href,
    markdownFileUrl: pathToFileURL(markdownPath).href,
    target: {
      name: target.name,
      path: target.path,
      moves: target.moves,
      generatedFixture: target.generatedFixture,
    },
    profile: {
      maxVisits: readKatagoMaxVisitsFrom(env),
      multiTurnMax: integerEnv(env, "KATAGO_MULTI_TURN_MAX"),
      persistentRootEnabled: booleanEnv(
        env,
        "KATAGO_PERSISTENT_ROOT_ENABLED",
        false
      ),
      persistentRootStrict: booleanEnv(
        env,
        "KATAGO_PERSISTENT_ROOT_STRICT",
        false
      ),
      persistentMultiTurnEnabled: booleanEnv(
        env,
        "KATAGO_PERSISTENT_MULTI_TURN_ENABLED",
        false
      ),
      persistentMultiTurnStrict: booleanEnv(
        env,
        "KATAGO_PERSISTENT_MULTI_TURN_STRICT",
        false
      ),
      deepSearchEnabled: booleanEnv(env, "KATAGO_DEEP_SEARCH_ENABLED", false),
      winrateTimelineEnabled: booleanEnv(
        env,
        "KATAGO_WINRATE_TIMELINE_ENABLED",
        false
      ),
    },
    host: {
      platform: process.platform,
      cpuModel: cpu[0]?.model ?? "unknown",
      logicalCpuCount: cpu.length,
      totalMemoryMiB: toMiB(initialMemory.totalBytes),
      initialFreeMemoryMiB: toMiB(initialMemory.freeBytes),
    },
    requested: {
      levels,
      jobsPerLevel: jobs,
      forceMemoryRisk: opts.forceMemoryRisk === true,
    },
    thresholds,
    levels: levelReports,
  };
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(
    markdownPath,
    renderKatagoConcurrencyBenchmarkMarkdown(report),
    "utf8"
  );
  return report;
}

export function katagoConcurrencyBenchmarkUsage(): string {
  return [
    "Usage: corepack pnpm katago:concurrency-benchmark -- [game.sgf] [options]",
    "",
    "Without game.sgf, the 120-move customer-style fixture is generated.",
    "",
    "Options:",
    "  --levels <csv>                         Worker process levels. Default: 1,2,4",
    "  --jobs <n>                             Queued jobs per level. Default: 4",
    "  --out-dir <dir>                        Report directory.",
    "  --job-timeout-ms <ms>                  Per-job parent timeout. Default: 900000",
    "  --memory-reserve-mib <mib>             Required free-memory floor. Default: 1024",
    "  --force-memory-risk                    Disable memory preflight skip.",
    "  --max-queue-p95-ms <ms>                Default: 30000",
    "  --max-engine-p95-ms <ms>               Default: 120000",
    "  --max-end-to-end-p95-ms <ms>           Default: 120000",
    "  --min-throughput-jobs-per-minute <n>   Default: 1",
    "  --lang <code>                          Default: ko",
  ].join("\n");
}

export async function runKatagoConcurrencyBenchmarkCliMain(
  argv: string[]
): Promise<void> {
  const args = parseKatagoConcurrencyBenchmarkArgs(argv);
  if (args.help) {
    console.log(katagoConcurrencyBenchmarkUsage());
    return;
  }
  try {
    console.log(
      `[katago-concurrency] levels=${args.levels.join(",")} jobs=${String(args.jobs)} memoryReserveMiB=${String(args.memoryReserveMiB)}`
    );
    const report = await runKatagoConcurrencyBenchmark({
      sgfPath: args.sgfPath,
      outDir: args.outDir,
      levels: args.levels,
      jobs: args.jobs,
      language: args.language,
      jobTimeoutMs: args.jobTimeoutMs,
      memoryReserveMiB: args.memoryReserveMiB,
      forceMemoryRisk: args.forceMemoryRisk,
      maxQueueP95Ms: args.maxQueueP95Ms,
      maxEngineP95Ms: args.maxEngineP95Ms,
      maxEndToEndP95Ms: args.maxEndToEndP95Ms,
      minThroughputJobsPerMinute: args.minThroughputJobsPerMinute,
      onLevelComplete: level => {
        console.log(
          `[katago-concurrency] c=${String(level.concurrency)} status=${level.status} passed=${String(level.passed)} jobs=${String(level.successfulJobs)}/${String(level.jobs)} queueP95=${formatValue(level.queueWaitMs.p95)} engineP95=${formatValue(level.engineDurationMs.p95)} throughput=${formatValue(level.throughputJobsPerMinute)}`
        );
        if (level.error) {
          console.log(`[katago-concurrency] reason=${level.error}`);
        }
      },
    });
    console.log(
      `[katago-concurrency] result=${report.passed ? "PASS" : "NO-GO"} recommended=${formatValue(report.recommendedConcurrency)}`
    );
    console.log(`[katago-concurrency] report=${report.markdownFileUrl}`);
    if (!report.passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`[katago-concurrency] ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
