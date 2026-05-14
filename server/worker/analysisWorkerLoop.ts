import { ENV, isMockAnalysisAllowed, validateServerEnv } from "../_core/env";
import type { AnalysisJobDbRow } from "../creditService";
import { claimNextAnalysisJobRpc } from "../creditService";
import { assertKatagoPathsConfiguredOrThrow, getAnalysisEngineName } from "./analysisEngines";
import { getResolvedAnalysisWorkerId } from "./analysisWorkerId";
import { processClaimedAnalysisJob } from "./processClaimedAnalysisJob";

function readClaimStaleSeconds(): number {
  const n = parseInt(process.env.ANALYSIS_CLAIM_STALE_SECONDS ?? "900", 10);
  return Number.isFinite(n) && n >= 1 ? n : 900;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const IDLE_MS = 900;
const IDLE_MOCK_DISABLED_MS = 8000;

export async function runAnalysisWorkerLoop(opts?: { signal?: AbortSignal }): Promise<void> {
  const signal = opts?.signal;
  while (!signal?.aborted) {
    const engine = getAnalysisEngineName();
    if (ENV.isProduction && engine === "mock" && !isMockAnalysisAllowed()) {
      console.warn(
        "[analysis-worker] production에서 ANALYSIS_ENGINE=mock 인데 KATATALK_ALLOW_MOCK_ANALYSIS≠true — queued job 을 claim 하지 않습니다."
      );
      await sleep(IDLE_MOCK_DISABLED_MS);
      continue;
    }

    let job: AnalysisJobDbRow | null = null;
    try {
      job = await claimNextAnalysisJobRpc({
        workerId: getResolvedAnalysisWorkerId(),
        staleSeconds: readClaimStaleSeconds(),
      });
    } catch (e) {
      console.error("[analysis-worker] claim_next_analysis_job 실패", e);
      await sleep(IDLE_MS);
      continue;
    }

    if (job == null) {
      await sleep(IDLE_MS);
      continue;
    }

    try {
      await processClaimedAnalysisJob(job);
    } catch (e) {
      console.error("[analysis-worker] job 처리 실패", job.id, e);
      await sleep(IDLE_MS);
    }
  }
}

export async function startAnalysisWorkerMain(): Promise<void> {
  validateServerEnv();
  if (getAnalysisEngineName() === "katago") {
    assertKatagoPathsConfiguredOrThrow();
  }
  const ac = new AbortController();
  const onStop = (): void => {
    ac.abort();
  };
  process.on("SIGTERM", onStop);
  process.on("SIGINT", onStop);
  await runAnalysisWorkerLoop({ signal: ac.signal });
}
