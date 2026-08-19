import {
  ENV,
  isMockAnalysisAllowed,
  validateProductionAnalysisWorkerEnv,
  validateServerEnv,
} from "../_core/env";
import type { AnalysisJobDbRow } from "../creditService";
import {
  assertAtomicFailureRefundRpcReady,
  claimNextAnalysisJobRpc,
} from "../creditService";
import {
  assertKatagoPathsConfiguredOrThrow,
  assertKatagoWinratePerspectiveConfig,
  closeSharedPersistentRootSession,
  getAnalysisEngineName,
  readKatagoMaxVisitsFrom,
  readKatagoMultiTurnMaxFrom,
  readKatagoPersistentMultiTurnEnabledFrom,
  readKatagoPersistentMultiTurnPerJobConcurrencyFrom,
  readKatagoPersistentMultiTurnStrictFrom,
  readKatagoPersistentRootEnabledFrom,
  readKatagoPersistentRootStrictFrom,
} from "./analysisEngines";
import { getAnalysisWorkerMode } from "../analysisWorkerMode";
import { getResolvedAnalysisWorkerId } from "./analysisWorkerId";
import { processClaimedAnalysisJob } from "./processClaimedAnalysisJob";
import {
  createAnalysisWorkerInstanceId,
  startAnalysisWorkerStatusHeartbeat,
} from "./analysisWorkerStatus";
import { readDeepSearchExecutionEnabledFromEnv } from "../deepSearchResultsV1";
import { readWinrateTimelineEnabledFrom } from "./analysisEngines/winrateTimelineConfig";
import {
  assertKatagoGpuBackendRequirementV1,
  buildKatagoBackendLogLineV1,
  detectKatagoBackendV1,
  readKatagoRequireGpuBackendFrom,
} from "./katagoBackendDetectionV1";

function readClaimStaleSeconds(): number {
  const n = parseInt(process.env.ANALYSIS_CLAIM_STALE_SECONDS ?? "900", 10);
  return Number.isFinite(n) && n >= 1 ? n : 900;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

const IDLE_MS = 900;
const IDLE_MOCK_DISABLED_MS = 8000;
const MAX_ANALYSIS_WORKER_CONCURRENCY = 4;

export function readAnalysisWorkerConcurrencyFrom(
  env: NodeJS.ProcessEnv
): number {
  const raw = env.ANALYSIS_WORKER_CONCURRENCY?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    return 1;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return 1;
  }
  return Math.min(MAX_ANALYSIS_WORKER_CONCURRENCY, parsed);
}

export function assertAnalysisWorkerConcurrencyConfig(
  env: NodeJS.ProcessEnv
): void {
  const concurrency = readAnalysisWorkerConcurrencyFrom(env);
  if (concurrency <= 1 || readAnalysisEngineNameFrom(env) !== "katago") {
    return;
  }
  const violations: string[] = [];
  if (!readKatagoPersistentRootEnabledFrom(env)) {
    violations.push("KATAGO_PERSISTENT_ROOT_ENABLED=true");
  }
  if (!readKatagoPersistentRootStrictFrom(env)) {
    violations.push("KATAGO_PERSISTENT_ROOT_STRICT=true");
  }
  if (!readKatagoPersistentMultiTurnEnabledFrom(env)) {
    violations.push("KATAGO_PERSISTENT_MULTI_TURN_ENABLED=true");
  }
  if (!readKatagoPersistentMultiTurnStrictFrom(env)) {
    violations.push("KATAGO_PERSISTENT_MULTI_TURN_STRICT=true");
  }
  if (readKatagoPersistentMultiTurnPerJobConcurrencyFrom(env) !== 1) {
    violations.push("KATAGO_PERSISTENT_MULTI_TURN_PER_JOB_CONCURRENCY=1");
  }
  if (readDeepSearchExecutionEnabledFromEnv(env)) {
    violations.push("KATAGO_DEEP_SEARCH_ENABLED=false");
  }
  if (readWinrateTimelineEnabledFrom(env)) {
    violations.push("KATAGO_WINRATE_TIMELINE_ENABLED=false");
  }
  if (violations.length > 0) {
    throw new Error(
      `ANALYSIS_WORKER_CONCURRENCY_UNSAFE: concurrency=${String(concurrency)} requires ${violations.join(", ")}`
    );
  }
}

function readAnalysisEngineNameFrom(
  env: NodeJS.ProcessEnv
): ReturnType<typeof getAnalysisEngineName> {
  return env.ANALYSIS_ENGINE?.trim().toLowerCase() === "katago"
    ? "katago"
    : "mock";
}

function readAnalysisWorkerModeFrom(
  env: NodeJS.ProcessEnv
): ReturnType<typeof getAnalysisWorkerMode> {
  const raw = env.ANALYSIS_WORKER_MODE?.trim().toLowerCase();
  if (raw === "inline" || raw === "external") {
    return raw;
  }
  return env.NODE_ENV === "production" ? "external" : "inline";
}

export function buildAnalysisWorkerStartupEnvSnapshot(
  env: NodeJS.ProcessEnv
): Record<string, unknown> {
  return {
    ANALYSIS_ENGINE: readAnalysisEngineNameFrom(env),
    ANALYSIS_WORKER_MODE: readAnalysisWorkerModeFrom(env),
    ANALYSIS_WORKER_CONCURRENCY: readAnalysisWorkerConcurrencyFrom(env),
    KATATALK_ALLOW_MOCK_ANALYSIS:
      env.KATATALK_ALLOW_MOCK_ANALYSIS?.trim() || "(unset)",
    ANALYSIS_WORKER_ID: env.ANALYSIS_WORKER_ID?.trim() || "(auto)",
    hasKATAGO_BINARY_PATH: Boolean(env.KATAGO_BINARY_PATH?.trim()),
    hasKATAGO_CONFIG_PATH: Boolean(env.KATAGO_CONFIG_PATH?.trim()),
    hasKATAGO_MODEL_PATH: Boolean(env.KATAGO_MODEL_PATH?.trim()),
    KATAGO_REQUIRE_GPU_BACKEND: readKatagoRequireGpuBackendFrom(env),
  };
}

export function buildAnalysisConfigLogLine(env: NodeJS.ProcessEnv): string {
  return [
    "[analysis-config]",
    `engine=${readAnalysisEngineNameFrom(env)}`,
    `workerMode=${readAnalysisWorkerModeFrom(env)}`,
    `concurrency=${String(readAnalysisWorkerConcurrencyFrom(env))}`,
    `deepSearch=${String(readDeepSearchExecutionEnabledFromEnv(env))}`,
    `timeline=${String(readWinrateTimelineEnabledFrom(env))}`,
    `maxVisits=${String(readKatagoMaxVisitsFrom(env))}`,
    `multiTurnMax=${String(readKatagoMultiTurnMaxFrom(env))}`,
  ].join(" ");
}

export async function runBoundedAnalysisWorkerLoop(opts: {
  concurrency: number;
  claimNext: () => Promise<AnalysisJobDbRow | null>;
  processJob: (job: AnalysisJobDbRow) => Promise<void>;
  signal?: AbortSignal;
  idleMs?: number;
  onClaimError?: (error: unknown) => void;
  onJobError?: (job: AnalysisJobDbRow, error: unknown) => void;
}): Promise<void> {
  const requestedConcurrency = Math.trunc(opts.concurrency);
  const concurrency = Number.isFinite(requestedConcurrency)
    ? Math.min(
        MAX_ANALYSIS_WORKER_CONCURRENCY,
        Math.max(1, requestedConcurrency)
      )
    : 1;
  const inFlight = new Set<Promise<void>>();

  const startJob = (job: AnalysisJobDbRow): void => {
    let task!: Promise<void>;
    task = Promise.resolve()
      .then(() => opts.processJob(job))
      .catch(error => opts.onJobError?.(job, error))
      .finally(() => inFlight.delete(task));
    inFlight.add(task);
  };

  while (!opts.signal?.aborted) {
    let queueEmptyOrUnavailable = false;
    while (!opts.signal?.aborted && inFlight.size < concurrency) {
      let job: AnalysisJobDbRow | null;
      try {
        job = await opts.claimNext();
      } catch (error) {
        opts.onClaimError?.(error);
        queueEmptyOrUnavailable = true;
        break;
      }
      if (job == null) {
        queueEmptyOrUnavailable = true;
        break;
      }
      startJob(job);
    }

    if (opts.signal?.aborted) {
      break;
    }
    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
      continue;
    }
    if (queueEmptyOrUnavailable) {
      await Promise.race([
        ...Array.from(inFlight),
        sleep(opts.idleMs ?? IDLE_MS, opts.signal),
      ]);
    }
  }

  await Promise.allSettled(inFlight);
}

export async function runAnalysisWorkerLoop(opts?: {
  signal?: AbortSignal;
  onJobCompleted?: () => Promise<void>;
}): Promise<void> {
  const signal = opts?.signal;
  const engine = getAnalysisEngineName();
  if (ENV.isProduction && engine === "mock" && !isMockAnalysisAllowed()) {
    console.warn(
      "[analysis-worker] production에서 ANALYSIS_ENGINE=mock 인데 KATATALK_ALLOW_MOCK_ANALYSIS≠true — queued job 을 claim 하지 않습니다."
    );
    while (!signal?.aborted) {
      await sleep(IDLE_MOCK_DISABLED_MS, signal);
    }
    return;
  }

  const workerId = getResolvedAnalysisWorkerId();
  await runBoundedAnalysisWorkerLoop({
    concurrency: readAnalysisWorkerConcurrencyFrom(process.env),
    signal,
    claimNext: () =>
      claimNextAnalysisJobRpc({
        workerId,
        staleSeconds: readClaimStaleSeconds(),
      }),
    processJob: async job => {
      const outcome = await processClaimedAnalysisJob(job);
      if (outcome === "completed") {
        void opts?.onJobCompleted?.().catch(error => {
          console.warn("[analysis-worker] completion status report failed", {
            code: error instanceof Error ? error.message : "UNKNOWN",
          });
        });
      }
    },
    onClaimError: error =>
      console.error("[analysis-worker] claim_next_analysis_job 실패", error),
    onJobError: (job, error) =>
      console.error("[analysis-worker] job 처리 실패", job.id, error),
  });
}

export async function startAnalysisWorkerMain(): Promise<void> {
  // Production Workers do not serve browser or payment routes. Validate only
  // their queue/database contract so deployment can withhold unrelated secrets.
  if (ENV.isProduction) {
    validateProductionAnalysisWorkerEnv();
  } else {
    validateServerEnv();
  }
  assertAnalysisWorkerConcurrencyConfig(process.env);
  await assertAtomicFailureRefundRpcReady();
  console.log(
    "[analysis-worker] startup env",
    buildAnalysisWorkerStartupEnvSnapshot(process.env)
  );
  console.log(buildAnalysisConfigLogLine(process.env));
  if (getAnalysisEngineName() === "katago") {
    assertKatagoPathsConfiguredOrThrow();
    const winratePerspective = assertKatagoWinratePerspectiveConfig(
      process.env
    );
    console.log(
      `[katago-winrate-axis] reportAnalysisWinratesAs=${winratePerspective} source=config`
    );
    const backendResult = await detectKatagoBackendV1({ env: process.env });
    console.log(buildKatagoBackendLogLineV1(backendResult, process.env));
    assertKatagoGpuBackendRequirementV1(backendResult, process.env);
  }
  const ac = new AbortController();
  const onStop = (): void => {
    ac.abort();
  };
  process.on("SIGTERM", onStop);
  process.on("SIGINT", onStop);
  const workerStatus =
    getAnalysisWorkerMode() === "external"
      ? startAnalysisWorkerStatusHeartbeat({
          instanceId: createAnalysisWorkerInstanceId(),
          workerId: getResolvedAnalysisWorkerId(),
          engine: getAnalysisEngineName(),
        })
      : null;
  try {
    await runAnalysisWorkerLoop({
      signal: ac.signal,
      onJobCompleted: workerStatus?.reportSuccess,
    });
  } finally {
    process.off("SIGTERM", onStop);
    process.off("SIGINT", onStop);
    await workerStatus?.stop();
    await closeSharedPersistentRootSession();
  }
}
