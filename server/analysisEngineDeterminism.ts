import type { AnalysisJobResultMeta } from "@shared/analysisJob";
import { isKatagoWorkerV1ResultPayload } from "@shared/analysisJob";
import type { AnalysisJobDbRow } from "./creditService";
import { getAnalysisWorkerMode } from "./analysisWorkerMode";
import {
  getAnalysisEngineName,
  type AnalysisEngineName,
} from "./worker/analysisEngines/config";

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
  if (
    src != null &&
    typeof src === "object" &&
    (src as { mock?: boolean }).mock === true
  ) {
    return true;
  }
  return false;
}

/** GET completed job meta.mock — row·result.source·isMock 일관 규칙 */
export function resolveCompletedJobMetaMock(
  row: Pick<AnalysisJobDbRow, "is_mock">,
  parsedResult: unknown
): AnalysisJobResultMeta | undefined {
  if (isKatagoWorkerV1ResultPayload(parsedResult)) {
    return {
      mock: false,
      message:
        "KataGo worker v1: BSI/ADI v1 computed from multi-turn; Deep Search not executed.",
    };
  }
  if (row.is_mock === true) {
    return {
      mock: true,
      message:
        "Mock analysis job finished. SGF was validated at enqueue; KataGo not used.",
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

const SGF_TREE_REDACTED = "(;…)";
const SGF_PROP_REDACTED = "[SGF_PROP_REDACTED]";

/** error_message 본문에서 SGF-like payload 제거 (길이 무관) */
function redactSgfLikePayloadInErrorBody(body: string): string {
  let t = body;
  for (let pass = 0; pass < 8; pass++) {
    const prev = t;
    t = t.replace(/\(;[\s\S]*?\)/g, SGF_TREE_REDACTED);
    if (t === prev) {
      break;
    }
  }
  if (t.includes("(;")) {
    t = t.replace(/\(;[\s\S]*/g, SGF_TREE_REDACTED);
  }
  t = t.replace(/;[BW]\[[^\]]*\]/gi, "");
  t = t.replace(/\b[A-Z]{1,2}\[[^\]]*\]/g, SGF_PROP_REDACTED);
  t = t.replace(/(?:\(;…\)\s*)+/g, `${SGF_TREE_REDACTED} `);
  t = t.replace(/(?:\[SGF_PROP_REDACTED\]\s*)+/g, `${SGF_PROP_REDACTED} `);
  return t.replace(/\s{2,}/g, " ").trim();
}

/** DB error_message — 코드 접두 유지, SGF 원문·property fragment·긴 tail 제거 */
export function sanitizeAnalysisJobErrorMessage(
  raw: string,
  maxLen = 400
): string {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  const prefixMatch = /^([A-Z][A-Z0-9_]+):\s*([\s\S]*)$/.exec(normalized);
  const prefix = prefixMatch ? `${prefixMatch[1]}: ` : "";
  const body = prefixMatch ? prefixMatch[2]! : normalized;
  let cleaned = redactSgfLikePayloadInErrorBody(body);
  if (!cleaned && prefix) {
    cleaned = "(details redacted)";
  }
  let msg = `${prefix}${cleaned}`.trim();
  if (msg.length > maxLen) {
    return `${msg.slice(0, maxLen)}…`;
  }
  return msg;
}

/** Stable terminal failure code stored separately from diagnostics. */
export function analysisJobErrorCodeFromMessage(message: string): string {
  const match = /^([A-Z][A-Z0-9_]{1,127})(?::|$)/.exec(message.trim());
  return match?.[1] ?? "ANALYSIS_FAILED";
}

/** Allowlisted message safe to persist in user-readable analysis_jobs rows. */
export function publicAnalysisJobErrorMessage(
  errorCode: string | null | undefined
): string {
  switch (errorCode) {
    case "KATAGO_TIMEOUT":
      return "Analysis timed out. Please try again.";
    case "SGF_PARSE_FAILED":
    case "KATAGO_QUERY_BUILD_FAILED":
      return "The game record could not be analyzed.";
    default:
      return "Analysis failed. Please try again.";
  }
}
