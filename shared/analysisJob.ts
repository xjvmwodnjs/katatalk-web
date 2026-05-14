/**
 * Analysis job API contracts (POST enqueue + GET poll).
 *
 * 서버는 Supabase `analysis_jobs` 를 authoritative source 로 두고,
 * mock 파이프라인은 동일 테이블을 갱신한다. 운영 규모에서는 queue/worker 가 필요하다.
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

export function isKatagoWorkerV1ResultPayload(data: unknown): boolean {
  if (data == null || typeof data !== "object") {
    return false;
  }
  const o = data as Record<string, unknown>;
  return o.source === "katago-worker-v1";
}

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
} from "./multiTurnKatagoAnalysisV1";
