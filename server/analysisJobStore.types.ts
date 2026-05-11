/**
 * Server-side job persistence abstraction.
 * Swap `InMemoryAnalysisJobStore` for a class that reads/writes DB rows and
 * pushes work to a queue; the worker updates the same logical fields.
 */

import type { AnalysisJobGetResponse, AnalysisJobStatus } from "@shared/analysisJob";

export type AnalysisJobLanguage = "ko" | "en" | "zh" | "ja";

/** Input captured at enqueue time (SGF already validated). */
export type AnalysisJobEnqueuePayload = {
  fileName: string;
  language: AnalysisJobLanguage;
  sgfContent: string;
};

/** Internal row — not sent to the client as-is (excludes raw SGF in API). */
export type AnalysisJobInternal = {
  jobId: string;
  status: AnalysisJobStatus;
  progress: number | null;
  createdAt: Date;
  updatedAt: Date;
  payload: AnalysisJobEnqueuePayload;
  /** Set when completed (mock or future KataGo). */
  resultData?: unknown;
  meta?: { mock: boolean; message: string };
  errorMessage?: string;
};

export interface AnalysisJobStore {
  /** Persist queued job and start async processing (mock delay for now). */
  createAndEnqueueMock(payload: AnalysisJobEnqueuePayload): string;
  /** Serialize public GET shape, or null if jobId unknown. */
  toPublicGetResponse(jobId: string): AnalysisJobGetResponse | null;
}
