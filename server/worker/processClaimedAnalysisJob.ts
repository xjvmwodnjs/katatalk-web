import type { AnalysisJobLanguage } from "../analysisJobStore.types";
import type { AnalysisJobDbRow } from "../creditService";
import { analysisJobProcessingLeaseFromClaimedRow } from "../creditService";
import {
  logAnalysisEngineSnapshot,
  resolveWorkerPipelineForClaimedJob,
} from "../analysisEngineDeterminism";
import { runMockAnalysisDbPipeline } from "../mockAnalysisDbPipeline";
import { getAnalysisEngineName } from "./analysisEngines";
import { finalizeAnalysisJobFailure } from "./finalizeAnalysisJobFailure";
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
  lease: NonNullable<ReturnType<typeof analysisJobProcessingLeaseFromClaimedRow>>;
  mismatchCode: string;
  mismatchDetail: string;
}): Promise<AnalysisWorkerJobOutcome> {
  return finalizeAnalysisJobFailure({
    jobId: args.row.id,
    rawError: `${args.mismatchCode}: ${args.mismatchDetail}`,
    lease: args.lease,
    logPrefix: "analysis-worker",
  });
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
  if (!lease) {
    console.error("[analysis-worker] claimed job is missing a valid processing lease", {
      jobId: row.id,
      code: "MISSING_PROCESSING_LEASE",
    });
    return "lease_lost";
  }

  if (routing.pipeline === "engine_mismatch") {
    return failClaimedJobEngineMismatch({
      row,
      lease,
      mismatchCode: routing.mismatchCode ?? "ENGINE_MISMATCH",
      mismatchDetail: routing.mismatchDetail ?? "worker engine does not match job.is_mock",
    });
  }

  if (routing.pipeline === "katago") {
    return runKatagoAnalysisDbPipeline({
      jobId: row.id,
      row,
      fileName,
      language,
      lease,
    });
  }

  if (row.is_mock !== true) {
    return failClaimedJobEngineMismatch({
      row,
      lease,
      mismatchCode: "ENGINE_MISMATCH_WORKER_MOCK",
      mismatchDetail: "refusing mock pipeline for is_mock=false job",
    });
  }

  return runMockAnalysisDbPipeline({
    jobId: row.id,
    fileName,
    language,
    lease,
  });
}
