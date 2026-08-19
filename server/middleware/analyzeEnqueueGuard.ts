import type { NextFunction, Request, Response } from "express";
import { getAnalysisWorkerMode } from "../analysisWorkerMode";
import { isMockAnalysisAllowed } from "../_core/env";
import { getAnalysisEngineName } from "../worker/analysisEngines/config";

export type AnalyzeEnqueueAdmissionCode =
  | "ANALYSIS_IDEMPOTENCY_UNAVAILABLE"
  | "KATAGO_INLINE_FORBIDDEN"
  | "MOCK_ANALYSIS_DISABLED";

/**
 * Return why a new job must not be admitted. The v2 database RPC evaluates
 * this only after checking for an exact committed replay. A configuration
 * change therefore cannot hide a job whose original HTTP response was lost.
 */
export function analyzeEnqueueAdmissionCode(): AnalyzeEnqueueAdmissionCode | null {
  if (process.env.KATATALK_ATOMIC_ENQUEUE?.trim().toLowerCase() === "false") {
    return "ANALYSIS_IDEMPOTENCY_UNAVAILABLE";
  }
  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  const engine = getAnalysisEngineName();
  const mode = getAnalysisWorkerMode();
  if (engine === "katago") {
    return mode === "inline" ? "KATAGO_INLINE_FORBIDDEN" : null;
  }
  return isMockAnalysisAllowed() ? null : "MOCK_ANALYSIS_DISABLED";
}

/** Standalone middleware retained for focused guard tests and other callers. */
export function requireAnalyzeEnqueueAllowed(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  const code = analyzeEnqueueAdmissionCode();
  if (code == null) {
    next();
    return;
  }

  res.status(503).json({
    success: false,
    code,
    message:
      code === "KATAGO_INLINE_FORBIDDEN"
        ? "Production KataGo analysis requires an external Worker."
        : code === "ANALYSIS_IDEMPOTENCY_UNAVAILABLE"
          ? "Analysis submission is unavailable because atomic idempotency is disabled."
          : "Analysis is temporarily unavailable.",
  });
}

/** DB insert `is_mock`: false only for KataGo jobs handled by an external Worker. */
export function shouldEnqueueAnalysisJobAsMock(): boolean {
  return !(
    getAnalysisEngineName() === "katago" &&
    getAnalysisWorkerMode() === "external"
  );
}
