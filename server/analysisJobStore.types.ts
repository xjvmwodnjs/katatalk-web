/**
 * Server-side job persistence abstraction.
 * Swap `InMemoryAnalysisJobStore` on the server with a DB-backed row +
 * queue producer; workers update the same logical fields.
 */

import type { AnalysisJobGetResponse, AnalysisJobStatus } from "@shared/analysisJob";

export type AnalysisJobLanguage = "ko" | "en" | "zh" | "ja";

/** In-memory mock 파이프라인에 필요한 최소 필드 (SGF 원문은 저장하지 않음). */
export type AnalysisJobEnqueuePayload = {
  fileName: string;
  language: AnalysisJobLanguage;
};

/** Internal row — not sent to the client as-is. */
export type AnalysisJobInternal = {
  jobId: string;
  status: AnalysisJobStatus;
  progress: number | null;
  createdAt: Date;
  updatedAt: Date;
  /** Clerk JWT `sub` 또는 non-clerk 로컬 식별자 (creditService 와 동일 규칙). */
  ownerClerkSubject: string;
  /** users.id — DB 없이 Clerk JWT 만 쓰는 경우 0 */
  ownerAppUserId: number;
  /** Supabase credit_logs.id (UUID 문자열) */
  creditLedgerId: string;
  payload: AnalysisJobEnqueuePayload;
  /** Set when completed (mock or future KataGo). */
  resultData?: unknown;
  meta?: { mock: boolean; message: string };
  errorMessage?: string;
  /** 완료/실패 시 TTL 정리용 */
  terminalAt?: Date;
};

export interface AnalysisJobStore {
  createAndEnqueueMock(args: {
    jobId: string;
    payload: AnalysisJobEnqueuePayload;
    ownerClerkSubject: string;
    ownerAppUserId: number;
    creditLedgerId: string;
    onJobFailed?: () => void | Promise<void>;
  }): void;
  getInternal(jobId: string): AnalysisJobInternal | null;
  toPublicGetResponse(jobId: string): AnalysisJobGetResponse | null;
}
