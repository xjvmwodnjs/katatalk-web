import type { Request } from "express";
import { verifyClerkBearerReadOnly } from "./clerkAuth";
import { authProvider } from "./authProvider";
import { ENV } from "./env";
import { parseBearerAuthorization, verifySupabaseAccessTokenAndSyncUser } from "./supabaseAuth";
import type { AuthenticatedUser } from "./sdk";

/**
 * Bearer(Clerk/Supabase) 우선, 그 외 쿠키 기반 authProvider.
 */
export async function tryResolveUserFromRequest(
  req: Request
): Promise<AuthenticatedUser | null> {
  if (ENV.authProvider === "clerk") {
    const token = parseBearerAuthorization(req.headers.authorization);
    if (!token) {
      return null;
    }
    return verifyClerkBearerReadOnly(token);
  }

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
