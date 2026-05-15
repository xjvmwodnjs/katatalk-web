import type { AnalysisJobGetResponse } from "@shared/analysisJob";
import { isKatagoWorkerV1ResultPayload } from "@shared/analysisJob";
import type { AnalysisJobDbRow } from "./creditService";
import { getAnalysisWorkerMode } from "./analysisWorkerMode";
import { getAnalysisEngineName, type AnalysisEngineName } from "./worker/analysisEngines/config";

export type WorkerPipelineChoiceV1 = "katago" | "mock" | "engine_mismatch";

export type WorkerPipelineResolutionV1 = {
  pipeline: WorkerPipelineChoiceV1;
  mismatchCode?: string;
  mismatchDetail?: string;
};

export function resolveWorkerPipelineForClaimedJob(
  row: AnalysisJobDbRow,
  workerEngine: AnalysisEngineName
): WorkerPipelineResolutionV1 {
  const jobMock = row.is_mock === true;
  if (jobMock && workerEngine === "katago") {
    return {
      pipeline: "engine_mismatch",
      mismatchCode: "ENGINE_MISMATCH_JOB_MOCK",
      mismatchDetail: "job.is_mock=true but worker ANALYSIS_ENGINE=katago",
    };
  }
  if (!jobMock && workerEngine === "mock") {
    return {
      pipeline: "engine_mismatch",
      mismatchCode: "ENGINE_MISMATCH_WORKER_MOCK",
      mismatchDetail: "job.is_mock=false but worker ANALYSIS_ENGINE=mock",
    };
  }
  if (jobMock) {
    return { pipeline: "mock" };
  }
  if (workerEngine === "katago") {
    return { pipeline: "katago" };
  }
  return { pipeline: "mock" };
}

export function isLegacyMockResultPayload(data: unknown): boolean {
  if (data == null || typeof data !== "object") {
    return false;
  }
  const r = data as Record<string, unknown>;
  if (r.isMock === true) {
    return true;
  }
  const src = r.source;
  if (src != null && typeof src === "object" && (src as { mock?: boolean }).mock === true) {
    return true;
  }
  return false;
}

/** GET completed job meta.mock — row·result.source·isMock 일관 규칙 */
export function resolveCompletedJobMetaMock(
  row: Pick<AnalysisJobDbRow, "is_mock">,
  parsedResult: unknown
): AnalysisJobGetResponse["meta"] {
  if (isKatagoWorkerV1ResultPayload(parsedResult)) {
    return {
      mock: false,
      message: "KataGo worker v1: BSI/ADI v1 computed from multi-turn; Deep Search not executed.",
    };
  }
  if (row.is_mock === true) {
    return {
      mock: true,
      message: "Mock analysis job finished. SGF was validated at enqueue; KataGo not used.",
    };
  }
  if (isLegacyMockResultPayload(parsedResult)) {
    return {
      mock: true,
      message: "Mock analysis result payload.",
    };
  }
  return undefined;
}

export function logAnalysisEngineSnapshot(args: {
  phase: "enqueue" | "worker_claim";
  jobId: string;
  rowIsMock?: boolean;
  selectedPipeline?: WorkerPipelineChoiceV1;
  mismatchCode?: string;
  resultSource?: string;
}): void {
  const payload: Record<string, unknown> = {
    phase: args.phase,
    jobId: args.jobId,
    rowIsMock: args.rowIsMock,
    ANALYSIS_ENGINE: getAnalysisEngineName(),
    ANALYSIS_WORKER_MODE: getAnalysisWorkerMode(),
    selectedPipeline: args.selectedPipeline,
    mismatchCode: args.mismatchCode,
    resultSource: args.resultSource,
  };
  console.log("[analysis-engine]", payload);
}

/** DB error_message — 코드 접두 유지, SGF 원문·과도한 stderr 제거 */
export function sanitizeAnalysisJobErrorMessage(raw: string, maxLen = 400): string {
  let msg = raw.replace(/\r\n/g, "\n").trim();
  if (msg.includes("(;")) {
    msg = msg.replace(/\(;[\s\S]{0,200}/g, "(;…)");
  }
  if (msg.length > maxLen) {
    return `${msg.slice(0, maxLen)}…`;
  }
  return msg;
}
