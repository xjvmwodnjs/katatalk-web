import type { NextFunction, Request, Response } from "express";
import { isMockAnalysisAllowed } from "../_core/env";

/** Production 에서 mock 분석을 실수로 노출하지 않도록 차단 */
export function requireMockAnalysisAllowed(req: Request, res: Response, next: NextFunction): void {
  if (isMockAnalysisAllowed()) {
    next();
    return;
  }
  res.status(503).json({
    success: false,
    code: "MOCK_ANALYSIS_DISABLED",
    message: "현재 분석 기능은 준비 중입니다.",
  });
}
