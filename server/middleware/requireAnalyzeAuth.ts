import type { NextFunction, Request, Response } from "express";
import {
  AUTH_DEPENDENCY_UNAVAILABLE_CODE,
  AUTH_DEPENDENCY_UNAVAILABLE_MESSAGE,
} from "../_core/authErrors";
import { tryResolveUserFromRequest } from "../_core/resolveRequestUser";

export const ANALYZE_AUTH_REQUIRED_MESSAGE =
  "로그인이 필요합니다. 로그인 후 다시 시도해 주세요.";

/** /api/analyze* — 서버에서 반드시 인증 (Bearer 또는 legacy 쿠키 규칙) */
function makeRequireAnalyzeAuth() {
  return (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const user = await tryResolveUserFromRequest(req);
        if (!user) {
          res.status(401).json({ success: false, message: ANALYZE_AUTH_REQUIRED_MESSAGE });
          return;
        }
        req.katatalkUser = user;
        next();
      } catch {
        console.error(
          `[requireAnalyzeAuth] ${AUTH_DEPENDENCY_UNAVAILABLE_CODE}`
        );
        res.status(503).json({
          success: false,
          code: AUTH_DEPENDENCY_UNAVAILABLE_CODE,
          message: AUTH_DEPENDENCY_UNAVAILABLE_MESSAGE,
        });
      }
    })();
  };
}

export const requireAnalyzeAuth = makeRequireAnalyzeAuth();

/** 인증은 읽기 전용이며 identity/wallet 생성은 검증된 first-use 경계에서 수행한다. */
export const requireAnalyzeAuthBeforeAdmission = requireAnalyzeAuth;
