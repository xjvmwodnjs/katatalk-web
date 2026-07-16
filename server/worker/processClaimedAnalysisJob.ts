import type { AnalysisJobLanguage } from "../analysisJobStore.types";
import type { AnalysisJobDbRow } from "../creditService";
import {
  analysisJobProcessingLeaseFromClaimedRow,
  refundCreditIfJobFailedByProfileId,
  updateAnalysisJobRow,
  updateAnalysisJobRowWithLease,
} from "../creditService";
import {
  logAnalysisEngineSnapshot,
  resolveWorkerPipelineForClaimedJob,
  sanitizeAnalysisJobErrorMessage,
} from "../analysisEngineDeterminism";
import { runMockAnalysisDbPipeline } from "../mockAnalysisDbPipeline";
import { getAnalysisEngineName } from "./analysisEngines";
import { runKatagoAnalysisDbPipeline } from "./katagoAnalysisDbPipeline";
import type { AnalysisWorkerJobOutcome } from "./analysisJobOutcome";

const SUPPORTED = new Set<AnalysisJobLanguage>(["ko", "en", "zh", "ja"]);

function coerceLanguage(raw: string | null | undefined): AnalysisJobLanguage {
  if (raw && SUPPORTED.has(raw as AnalysisJobLanguage)) {
    return raw as AnalysisJobLanguage;
  }
  return "ko";
}

async function failClaimedJobEngineMismatch(args: {
  row: AnalysisJobDbRow;
  lease: ReturnType<typeof analysisJobProcessingLeaseFromClaimedRow>;
  mismatchCode: string;
  mismatchDetail: string;
  refund: boolean;
  onRefund?: () => void | Promise<void>;
}): Promise<AnalysisWorkerJobOutcome> {
  const error_message = sanitizeAnalysisJobErrorMessage(
    `${args.mismatchCode}: ${args.mismatchDetail}`
  );
  const patch = {
    status: "failed" as const,
    progress: null,
    error_message,
    completed_at: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
  };
  if (args.lease) {
    const r = await updateAnalysisJobRowWithLease(args.row.id, args.lease, patch);
    if (!r.ok) {
      console.warn("[analysis-worker] lease_lost skip engine_mismatch failed write", {
        jobId: args.row.id,
        mismatchCode: args.mismatchCode,
      });
      return "lease_lost";
    }
  } else {
    await updateAnalysisJobRow(args.row.id, patch);
  }
  if (args.refund) {
    await args.onRefund?.();
  }
  return "failed";
}

/** Claim 된 `analysis_jobs` 행을 job.is_mock + worker `ANALYSIS_ENGINE` 에 따라 처리한다. */
export async function processClaimedAnalysisJob(
  row: AnalysisJobDbRow
): Promise<AnalysisWorkerJobOutcome> {
  const workerEngine = getAnalysisEngineName();
  const routing = resolveWorkerPipelineForClaimedJob(row, workerEngine);
  logAnalysisEngineSnapshot({
    phase: "worker_claim",
    jobId: row.id,
    rowIsMock: row.is_mock,
    selectedPipeline: routing.pipeline,
    mismatchCode: routing.mismatchCode,
  });

  const fileName = row.file_name?.trim() || "uploaded.sgf";
  const language = coerceLanguage(row.language);
  const lease = analysisJobProcessingLeaseFromClaimedRow(row);
  const onFail = async (): Promise<void> => {
    const r = await refundCreditIfJobFailedByProfileId(row.user_id, row.id, row.credit_cost);
    if (!r.ok) {
      console.error(
        "[analysis-worker] refund failed",
        JSON.stringify({ jobId: row.id, code: r.errorCode })
      );
    } else if (r.duplicate) {
      console.warn("[analysis-worker] refund idempotent duplicate", JSON.stringify({ jobId: row.id }));
    }
  };

  if (routing.pipeline === "engine_mismatch") {
    const refund = row.credit_cost > 0;
    return failClaimedJobEngineMismatch({
      row,
      lease,
      mismatchCode: routing.mismatchCode ?? "ENGINE_MISMATCH",
      mismatchDetail: routing.mismatchDetail ?? "worker engine does not match job.is_mock",
      refund,
      onRefund: onFail,
    });
  }

  if (routing.pipeline === "katago") {
    return runKatagoAnalysisDbPipeline({
      jobId: row.id,
      row,
      fileName,
      language,
      lease,
      onJobFailed: onFail,
    });
  }

  if (row.is_mock !== true) {
    return failClaimedJobEngineMismatch({
      row,
      lease,
      mismatchCode: "ENGINE_MISMATCH_WORKER_MOCK",
      mismatchDetail: "refusing mock pipeline for is_mock=false job",
      refund: true,
      onRefund: onFail,
    });
  }

  return runMockAnalysisDbPipeline({
    jobId: row.id,
    fileName,
    language,
    lease,
    onJobFailed: onFail,
  });
}
