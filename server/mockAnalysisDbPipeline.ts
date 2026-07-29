import type { AnalysisJobLanguage } from "./analysisJobStore.types";
import { buildMockAnalysisReport } from "./mockAnalysisResult";
import {
  type AnalysisJobProcessingLease,
  updateAnalysisJobRow,
  updateAnalysisJobRowWithLease,
} from "./creditService";
import type { AnalysisWorkerJobOutcome } from "./worker/analysisJobOutcome";
import { finalizeAnalysisJobFailure } from "./worker/finalizeAnalysisJobFailure";

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
 * Supabase analysis_jobs 행을 단계적으로 갱신하는 mock 파이프라인.
 * Express 인라인(inline)과 별도 worker 가 동일 로직을 공유한다.
 */
export async function runMockAnalysisDbPipeline(args: {
  jobId: string;
  fileName: string;
  language: AnalysisJobLanguage;
  /** Claim 경로 worker 전용; 없으면(인라인 mock) 기존 id-only update */
  lease?: AnalysisJobProcessingLease | null;
  onJobFailed?: () => void | Promise<void>;
}): Promise<AnalysisWorkerJobOutcome> {
  const { jobId, fileName, language, lease, onJobFailed } = args;
  try {
    await sleep(350);
    let r = await updateJobForPipeline(jobId, lease, { status: "running", progress: 25 });
    if (!r.ok) {
      console.warn("[mockAnalysisDbPipeline] lease_lost skip progress", { jobId, stage: 25 });
      return "lease_lost";
    }

    await sleep(450);
    r = await updateJobForPipeline(jobId, lease, { status: "running", progress: 55 });
    if (!r.ok) {
      console.warn("[mockAnalysisDbPipeline] lease_lost skip progress", { jobId, stage: 55 });
      return "lease_lost";
    }

    await sleep(400);
    r = await updateJobForPipeline(jobId, lease, { status: "running", progress: 85 });
    if (!r.ok) {
      console.warn("[mockAnalysisDbPipeline] lease_lost skip progress", { jobId, stage: 85 });
      return "lease_lost";
    }

    await sleep(300);

    const data = buildMockAnalysisReport({ fileName, language });
    r = await updateJobForPipeline(jobId, lease, {
      status: "completed",
      progress: 100,
      result: data,
      completed_at: new Date().toISOString(),
      is_mock: true,
      locked_at: null,
      locked_by: null,
    });
    if (!r.ok) {
      console.warn("[mockAnalysisDbPipeline] lease_lost skip completed write", { jobId });
      return "lease_lost";
    }
    return "completed";
  } catch (e) {
    return finalizeAnalysisJobFailure({
      jobId,
      rawError: e instanceof Error ? e.message : "ANALYSIS_FAILED: unknown error",
      lease,
      onLegacyJobFailed: onJobFailed,
      logPrefix: "mockAnalysisDbPipeline",
    });
  }
}
