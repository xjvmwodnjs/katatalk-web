import type { AuthenticatedUser } from "./sdk";

declare global {
  namespace Express {
    interface Request {
      /** requireAnalyzeAuth 미들웨어가 주입. 분석 API에서 인증된 사용자 식별용 */
      katatalkUser?: AuthenticatedUser;
    }
  }
}

export {};
