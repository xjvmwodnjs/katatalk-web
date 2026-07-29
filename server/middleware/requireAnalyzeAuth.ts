import type { NextFunction, Request, Response } from "express";
import { tryResolveUserFromRequest } from "../_core/resolveRequestUser";

export const ANALYZE_AUTH_REQUIRED_MESSAGE =
  "로그인이 필요합니다. 로그인 후 다시 시도해 주세요.";

/** /api/analyze* — 서버에서 반드시 인증 (Bearer 또는 legacy 쿠키 규칙) */
function makeRequireAnalyzeAuth(options: { ensureWallet?: boolean } = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const user = await tryResolveUserFromRequest(req, options);
        if (!user) {
          res.status(401).json({ success: false, message: ANALYZE_AUTH_REQUIRED_MESSAGE });
          return;
        }
        req.katatalkUser = user;
        next();
      } catch (e) {
        console.error("[requireAnalyzeAuth]", e);
        res.status(401).json({ success: false, message: ANALYZE_AUTH_REQUIRED_MESSAGE });
      }
    })();
  };
}

export const requireAnalyzeAuth = makeRequireAnalyzeAuth();

/** Authenticates an upload without provisioning its wallet before SGF admission. */
export const requireAnalyzeAuthBeforeAdmission = makeRequireAnalyzeAuth({
  ensureWallet: false,
});
