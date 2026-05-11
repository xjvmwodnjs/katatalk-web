import type { NextFunction, Request, Response } from "express";
import { tryResolveUserFromRequest } from "../_core/resolveRequestUser";

/** 클라이언트에 노출해도 되는 일반화된 한국어 메시지 (내부 스택 미포함) */
export const ANALYZE_AUTH_REQUIRED_MESSAGE =
  "로그인이 필요합니다. 로그인 후 다시 시도해 주세요.";

/**
 * /api/analyze* — 반드시 서버에서 인증.
 * Supabase 모드: Bearer access token 검증.
 * local-dev: 기존처럼 항상 성공하는 모의 사용자(로컬 전용).
 * legacy-manus: 세션 쿠키 필수.
 */
export function requireAnalyzeAuth(req: Request, res: Response, next: NextFunction) {
  void (async () => {
    try {
      const user = await tryResolveUserFromRequest(req);
      if (!user) {
        res.status(401).json({
          success: false,
          message: ANALYZE_AUTH_REQUIRED_MESSAGE,
        });
        return;
      }
      req.katatalkUser = user;
      next();
    } catch (e) {
      console.error("[requireAnalyzeAuth] 예기치 않은 오류", e);
      res.status(401).json({
        success: false,
        message: ANALYZE_AUTH_REQUIRED_MESSAGE,
      });
    }
  })();
}
