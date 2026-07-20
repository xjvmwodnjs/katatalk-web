import type { AnalysisJobDbRow } from "../creditService";
import {
  type AnalysisJobProcessingLease,
  heartbeatAnalysisJobLease,
  readAnalysisWorkerHeartbeatSeconds,
  updateAnalysisJobRow,
  updateAnalysisJobRowWithLease,
} from "../creditService";
import { isLegacyMockResultPayload } from "../analysisEngineDeterminism";
import { assertKatagoResultQualityForCompletion } from "../katagoResultQualityGate";
import { analyzeSgfKatago, readKatagoMaxVisits } from "./analysisEngines";
import type { AnalysisWorkerJobOutcome } from "./analysisJobOutcome";
import { finalizeAnalysisJobFailure } from "./finalizeAnalysisJobFailure";

type LeasePatch = Parameters<typeof updateAnalysisJobRowWithLease>[2];

function leaseLockedAtRefresh(lease: AnalysisJobProcessingLease | null | undefined): Pick<LeasePatch, "locked_at"> | null {
  if (!lease) {
    return null;
  }
  return { locked_at: new Date().toISOString() };
}

async function updateJobForPipeline(
  jobId: string,
  lease: AnalysisJobProcessingLease | null | undefined,
  patch: LeasePatch
): Promise<{ ok: true } | { ok: false; reason: "LEASE_LOST" }> {
  const touch = leaseLockedAtRefresh(lease);
  const merged =
    touch && patch.status === "running" ? ({ ...patch, ...touch } as LeasePatch) : patch;
  if (lease) {
    return updateAnalysisJobRowWithLease(jobId, lease, merged);
  }
  await updateAnalysisJobRow(jobId, merged);
  return { ok: true };
}

/**
 * KataGo 분석용 DB 파이프라인 — worker 에서 `analyzeSgfKatago` 로 최종 국면 1회 + multi-turn 배치(환경 설정 시) 실행 후 `result` 저장.
 */
export async function runKatagoAnalysisDbPipeline(args: {
  jobId: string;
  row: AnalysisJobDbRow;
  fileName: string;
  language: string;
  lease?: AnalysisJobProcessingLease | null;
  onJobFailed?: () => void | Promise<void>;
}): Promise<AnalysisWorkerJobOutcome> {
  const { jobId, row, fileName, language, lease, onJobFailed } = args;
  try {
    const content = typeof row.sgf_content === "string" ? row.sgf_content : null;
    if (!content?.trim()) {
      return finalizeAnalysisJobFailure({
        jobId,
        rawError: "MISSING_SGF_CONTENT: KataGo 분석에는 저장된 SGF 원문이 필요합니다.",
        lease,
        onLegacyJobFailed: onJobFailed,
        logPrefix: "katagoAnalysisDbPipeline",
      });
    }

    const pr = await updateJobForPipeline(jobId, lease, { status: "running", progress: 15 });
    if (!pr.ok) {
      console.warn("[katagoAnalysisDbPipeline] lease_lost skip katago run", { jobId });
      return "lease_lost";
    }

    let leaseLostDuringRun = false;
    /** heartbeat RPC 예외 등으로 완료 저장을 안전하게 생략(실제 분석 실패로 취급하지 않음). */
    let heartbeatUncertain = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    if (lease) {
      const periodMs = readAnalysisWorkerHeartbeatSeconds() * 1000;
      heartbeatTimer = setInterval(() => {
        void (async () => {
          try {
            const hb = await heartbeatAnalysisJobLease(jobId, lease);
            if (!hb.ok) {
              leaseLostDuringRun = true;
              if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = undefined;
              }
              console.warn("[katagoAnalysisDbPipeline] heartbeat lease_lost", { jobId });
            }
          } catch (intervalErr) {
            heartbeatUncertain = true;
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer);
              heartbeatTimer = undefined;
            }
            console.warn("[katagoAnalysisDbPipeline] heartbeat interval error; stopping timer, skip completed", {
              jobId,
              err: intervalErr instanceof Error ? intervalErr.message : intervalErr,
            });
          }
        })().catch(err => {
          heartbeatUncertain = true;
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = undefined;
          }
          console.warn("[katagoAnalysisDbPipeline] heartbeat interval promise rejection; skip completed", {
            jobId,
            err: err instanceof Error ? err.message : err,
          });
        });
      }, periodMs);
    }

    let result: Awaited<ReturnType<typeof analyzeSgfKatago>>;
    try {
      result = await analyzeSgfKatago({
        jobId,
        sgfContent: content,
        language,
        maxVisits: readKatagoMaxVisits(),
        fileName,
      });
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    }

    if (heartbeatUncertain) {
      console.warn("[katagoAnalysisDbPipeline] heartbeat uncertain before post-run; skip completed (job stays running)", {
        jobId,
      });
      return "lease_lost";
    }

    if (lease) {
      try {
        const postRun = await heartbeatAnalysisJobLease(jobId, lease);
        if (!postRun.ok) {
          leaseLostDuringRun = true;
        }
      } catch (postErr) {
        heartbeatUncertain = true;
        console.warn("[katagoAnalysisDbPipeline] post_run heartbeat error; skip completed (job stays running)", {
          jobId,
          err: postErr instanceof Error ? postErr.message : postErr,
        });
        return "lease_lost";
      }
    }

    if (leaseLostDuringRun || heartbeatUncertain) {
      console.warn("[katagoAnalysisDbPipeline] lease_lost or heartbeat uncertain; skip post-analyze write", { jobId });
      return "lease_lost";
    }

    if (row.is_mock === true) {
      throw new Error("ENGINE_MISMATCH_JOB_MOCK: refusing to store KataGo result for is_mock=true job");
    }
    if (isLegacyMockResultPayload(result)) {
      throw new Error("ENGINE_MISMATCH_MOCK_RESULT: KataGo pipeline produced mock-shaped result");
    }
    const rObj = result as Record<string, unknown>;
    if (rObj.source !== "katago-worker-v1" || rObj.isMock === true) {
      throw new Error("KATAGO_OUTPUT_INVALID: result must be katago-worker-v1 with isMock=false");
    }
    assertKatagoResultQualityForCompletion(result);

    const cr = await updateJobForPipeline(jobId, lease, {
      status: "completed",
      progress: 100,
      result,
      completed_at: new Date().toISOString(),
      is_mock: false,
      locked_at: null,
      locked_by: null,
    });
    if (!cr.ok) {
      console.warn("[katagoAnalysisDbPipeline] lease_lost skip completed write", { jobId });
      return "lease_lost";
    }
    return "completed";
  } catch (e) {
    return finalizeAnalysisJobFailure({
      jobId,
      rawError: e instanceof Error ? e.message : "ANALYSIS_FAILED: unknown error",
      lease,
      onLegacyJobFailed: onJobFailed,
      logPrefix: "katagoAnalysisDbPipeline",
    });
  }
}
