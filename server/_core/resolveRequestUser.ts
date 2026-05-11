import type { Request } from "express";
import { authProvider } from "./authProvider";
import { ENV } from "./env";
import {
  parseBearerAuthorization,
  verifySupabaseAccessTokenAndSyncUser,
} from "./supabaseAuth";
import type { AuthenticatedUser } from "./sdk";

/**
 * tRPC 컨텍스트 및 분석 API에서 공통으로 사용하는 사용자 해석.
 * - supabase: Authorization Bearer만 신뢰 (쿠키 세션과 혼용하지 않음)
 * - 그 외: 기존 authProvider (local-dev / legacy-manus)
 */
export async function tryResolveUserFromRequest(
  req: Request
): Promise<AuthenticatedUser | null> {
  if (ENV.authProvider === "supabase") {
    const token = parseBearerAuthorization(req.headers.authorization);
    if (!token) {
      return null;
    }
    return verifySupabaseAccessTokenAndSyncUser(token);
  }

  try {
    return await authProvider.authenticateRequest(req);
  } catch {
    return null;
  }
}
