import type { AuthenticatedUser } from "./sdk";

declare global {
  namespace Express {
    interface Request {
      /** requireAnalyzeAuth 가 주입 */
      katatalkUser?: AuthenticatedUser;
    }
  }
}

export {};
