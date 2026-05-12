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
