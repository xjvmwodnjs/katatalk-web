import type { NextFunction, Request, Response } from "express";
import { getAnalysisWorkerMode } from "../analysisWorkerMode";
import { isMockAnalysisAllowed } from "../_core/env";
import { getAnalysisEngineName } from "../worker/analysisEngines/config";

/**
 * Production: mock 엔진은 KATATALK_ALLOW_MOCK_ANALYSIS 로만 공개.
 * KataGo 실분석은 ANALYSIS_WORKER_MODE=external 일 때만 enqueue 허용(inline+katago 는 웹과 혼동·위험).
 */
export function requireAnalyzeEnqueueAllowed(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== "production") {
    next();
    return;
  }

  const engine = getAnalysisEngineName();
  const mode = getAnalysisWorkerMode();

  if (engine === "katago") {
    if (mode === "inline") {
      res.status(503).json({
        success: false,
        code: "KATAGO_INLINE_FORBIDDEN",
        message:
          "운영에서는 ANALYSIS_ENGINE=katago 일 때 ANALYSIS_WORKER_MODE=external 만 허용됩니다. 별도 worker 프로세스로 큐를 소비하세요.",
      });
      return;
    }
    next();
    return;
  }

  if (!isMockAnalysisAllowed()) {
    res.status(503).json({
      success: false,
      code: "MOCK_ANALYSIS_DISABLED",
      message: "현재 분석 기능은 준비 중입니다.",
    });
    return;
  }

  next();
}

/** DB insert 시 is_mock — KataGo+external 실분석 job 만 false */
export function shouldEnqueueAnalysisJobAsMock(): boolean {
  return !(getAnalysisEngineName() === "katago" && getAnalysisWorkerMode() === "external");
}
