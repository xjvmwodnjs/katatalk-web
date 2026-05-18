/**
 * Analysis job API contracts (POST enqueue + GET poll).
 *
 * 서버는 Supabase `analysis_jobs` 를 authoritative source 로 두고,
 * mock 파이프라인은 동일 테이블을 갱신한다. 운영 규모에서는 queue/worker 가 필요하다.
 * Worker claim 은 `claim_next_analysis_job`(007 이후) 로 `locked_at` / `attempt_count` 등 lease 필드를 갱신한다.
 * **Lease fencing:** stale 재claim 으로 `locked_by` / `attempt_count` 가 바뀐 뒤에는, 이전 worker 의 DB 갱신이 `update…WithLease` 조건에 맞지 않아 무시된다.
 * **Heartbeat:** `heartbeatAnalysisJobLease` 및 running 진행 갱신 시 `locked_at` 연장으로 장기 작업의 오인 stale 을 줄인다(`ANALYSIS_WORKER_HEARTBEAT_SECONDS`).
 */

/** Terminal and in-progress states exposed to the client. */
export type AnalysisJobStatus = "queued" | "running" | "completed" | "failed";

/** Immediate response after SGF validation and enqueue. */
export type AnalysisJobCreateResponse = {
  success: true;
  jobId: string;
  status: "queued";
  /** 차감 직후 남은 크레딧 (서버 wallet 기준). */
  creditBalance?: number;
  /** 차감 직후 남은 크레딧 (creditBalance 와 동일, 클라이언트 편의). */
  remainingCredits?: number;
};

/**
 * GET /api/analyze/:jobId payload (mock engine fills `data` when completed).
 * `data` is the analysis report JSON; typed loosely here so client can narrow.
 * 완료·본인 조회 시 DB `analysis_jobs.sgf_content` 가 비어 있지 않으면 `data.sgf_content` 로 병합될 수 있다.
 */
export type AnalysisJobGetResponse = {
  success: true;
  jobId: string;
  status: AnalysisJobStatus;
  /** 0–100 while queued/running; 100 when completed; null if not applicable. */
  progress: number | null;
  createdAt: string;
  updatedAt: string;
  /** Present when status === "completed". */
  data?: unknown;
  /** Present when status === "failed". */
  error?: { message: string };
  meta?: { mock: boolean; message: string };
};

export type AnalysisJobErrorResponse = {
  success: false;
  message: string;
};

const TERMINAL_STATUSES = new Set<AnalysisJobStatus>(["queued", "running", "completed", "failed"]);

/**
 * DB/클라이언트 간 status 문자열 표기 차이를 흡수한다 (예: "COMPLETED").
 */
export function normalizeAnalysisJobStatus(raw: string): AnalysisJobStatus {
  const s = raw.trim().toLowerCase();
  if (TERMINAL_STATUSES.has(s as AnalysisJobStatus)) {
    return s as AnalysisJobStatus;
  }
  /** 알 수 없는 값은 터미널 상태로 오인하지 않도록 폴링을 이어가게 한다. */
  return "running";
}

/**
 * Supabase jsonb 가 일부 경로에서 JSON 문자열로 올 때 객체로 복원한다.
 */
export function parseStoredAnalysisJobResult(result: unknown): unknown | null {
  if (result == null) {
    return null;
  }
  if (typeof result === "string") {
    const t = result.trim();
    if (!t) {
      return null;
    }
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return null;
    }
  }
  return result;
}

/**
 * 완료 job GET 응답용: DB `sgf_content` 가 있으면 파싱된 `result` 객체에 `sgf_content` 필드를 얕게 병합한다.
 * plain object 가 아니면(배열·원시 등) `parsedResult` 그대로. DB 값이 null/빈 문자열이면 병합하지 않는다.
 */
export function mergeDbSgfContentIntoCompletedJobData(
  parsedResult: unknown,
  sgfContentFromDb: string | null | undefined
): unknown {
  const sgf =
    typeof sgfContentFromDb === "string" && sgfContentFromDb.trim() ? sgfContentFromDb : null;
  if (sgf == null) {
    return parsedResult;
  }
  if (parsedResult == null || typeof parsedResult !== "object" || Array.isArray(parsedResult)) {
    return parsedResult;
  }
  return { ...(parsedResult as Record<string, unknown>), sgf_content: sgf };
}

export function isKatagoWorkerV1ResultPayload(data: unknown): boolean {
  if (data == null || typeof data !== "object") {
    return false;
  }
  const o = data as Record<string, unknown>;
  return o.source === "katago-worker-v1";
}

/** 결과 페이지용 ViewModel v1 — `shared/analysisResultViewModel.ts` */
export {
  buildAnalysisResultViewModel,
  type AnalysisResultViewModel,
  type BuildAnalysisResultViewModelOpts,
  type KatagoWorkerV1AnalysisViewModel,
  type MockLegacyAnalysisViewModel,
  type UnknownAnalysisViewModel,
  type AnalysisResultWinratePointV1,
  type AnalysisResultKeyMoveCandidateV1,
  type AnalysisResultVariationPreviewV1,
} from "./analysisResultViewModel";

export type {
  WinrateTimelineProgressEventV1,
  WinrateTimelineProgressResponseV1,
  WinrateTimelineGraphPointStatusV1,
} from "./winrateTimelineV1";

export type {
  SgfPlaybackViewModelV1,
  SgfPlaybackActiveV1,
  SgfPlaybackPlaceholderV1,
  SgfPlaybackStoneV1,
  SgfPlaybackLastMoveV1,
  SgfPlaybackWarningV1,
  SgfPlaybackWarningCodeV1,
  ExtractMainlineBwMovesResultV1,
} from "./sgfPlaybackV1";

export {
  buildSgfPlaybackStateV1,
  extractMainlineBwMoves,
  readSgfBracketValue,
  sgfLetterToCoordIndex,
  indexToGtpColumn,
  sgfPointToGtp,
  readSgfContentFromResultPayload,
} from "./sgfPlaybackV1";

/** `analysis_jobs.result.analysisPlan` 등 — 상세는 `shared/analysisPlanV1.ts` */
export type {
  AnalysisPlanV1,
  AnalysisPlanCandidateTurnV1,
  BuildAnalysisPlanV1Options,
} from "./analysisPlanV1";

/** `analysis_jobs.result.turnAnalyses` / `multiTurnAnalysis` — `shared/multiTurnKatagoAnalysisV1.ts` */
export type {
  TurnAnalysisEntryV1,
  TurnAnalysisEntrySuccessV1,
  TurnAnalysisEntryFailedV1,
  MultiTurnKatagoAnalysisMetaV1,
  TurnAnalysisCandidateMoveSummaryV1,
} from "./multiTurnKatagoAnalysisV1";

/** `analysis_jobs.result.bsiV1` — `shared/bsiV1.ts` */
export type {
  BsiV1Result,
  BsiV1Signal,
  BsiV1SignalStatus,
  BsiV1Severity,
  BsiV1Confidence,
  BsiV1SignalComponents,
  BsiV1ScoreMetricUsed,
  BsiV1Perspective,
  BsiV1InterpretationStatus,
} from "./bsiV1";

/** `analysis_jobs.result.adiV1` — `shared/adiV1.ts` */
export type {
  AdiV1Result,
  AdiV1Signal,
  AdiV1SignalStatus,
  AdiV1Band,
  AdiV1SignalComponents,
  AdiV1InterpretationStatus,
} from "./adiV1";

/** `analysis_jobs.result.deepSearchPlan` — `shared/deepSearchPlanV1.ts` */
export type {
  DeepSearchPlanV1Result,
  DeepSearchPlanPolicyV1,
  DeepSearchPlanCandidateV1,
  DeepSearchPlanNotSelectedV1,
  DeepSearchPlanSelectionBandV1,
} from "./deepSearchPlanV1";

/** `analysis_jobs.result.deepSearchResults` — `shared/deepSearchResultsV1.ts` */
export type {
  DeepSearchResultsV1Result,
  DeepSearchResultsPolicyV1,
  DeepSearchSingleResultV1,
  DeepSearchSingleResultOkV1,
  DeepSearchSingleResultFailedV1,
  DeepSearchResultComparisonV1,
} from "./deepSearchResultsV1";
