/**
 * Analysis job API contracts (POST enqueue + GET poll).
 *
 * Replace `InMemoryAnalysisJobStore` on the server with a DB-backed row +
 * queue producer; workers update status/progress/result the same shape.
 */

/** Terminal and in-progress states exposed to the client. */
export type AnalysisJobStatus = "queued" | "running" | "completed" | "failed";

/** Immediate response after SGF validation and enqueue. */
export type AnalysisJobCreateResponse = {
  success: true;
  jobId: string;
  status: "queued";
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
