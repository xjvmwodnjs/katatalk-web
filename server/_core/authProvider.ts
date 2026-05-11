import type { Request } from "express";
import { ForbiddenError } from "@shared/_core/errors";
import type { User } from "../../drizzle/schema";
import { ENV } from "./env";
import type { AuthenticatedUser } from "./sdk";
import type { ExchangeTokenResponse, GetUserInfoResponse } from "./types/manusTypes";

export interface AuthProvider {
  name: "local-dev" | "legacy-manus" | "supabase";
  authenticateRequest(req: Request): Promise<AuthenticatedUser>;
  exchangeCodeForToken?(code: string, state: string): Promise<ExchangeTokenResponse>;
  getUserInfo?(accessToken: string): Promise<GetUserInfoResponse>;
  createSessionToken?(
    openId: string,
    options?: { expiresInMs?: number; name?: string }
  ): Promise<string>;
}

function buildLocalDevUser(): AuthenticatedUser {
  const now = new Date();
  return {
    id: 1,
    openId: "local-dev-user",
    name: ENV.localDevUserName,
    email: ENV.localDevUserEmail,
    loginMethod: "local-dev",
    role: "user",
    subscriptionTier: "free",
    remainingAnalysisCount: 2,
    maxAnalysisCount: 3,
    subscriptionStartDate: null,
    preferredLanguage: "ko",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  } satisfies User;
}

const localDevAuthProvider: AuthProvider = {
  name: "local-dev",
  async authenticateRequest() {
    return buildLocalDevUser();
  },
};

/**
 * Supabase 모드에서는 HTTP Bearer로만 인증(resolveRequestUser).
 * 쿠키 기반 authenticateRequest 경로는 의도적으로 막음.
 */
const supabaseCookieDisabledProvider: AuthProvider = {
  name: "supabase",
  async authenticateRequest() {
    throw ForbiddenError(
      "AUTH_PROVIDER=supabase에서는 Authorization Bearer 토큰을 사용해야 합니다."
    );
  },
};

/**
 * Legacy Manus OAuth adapter.
 * TODO: 상용 전환 후 완전 제거 또는 관리자 전용으로 격리
 */
const legacyManusAuthProvider: AuthProvider = {
  name: "legacy-manus",
  async authenticateRequest(req) {
    const { sdk } = await import("./sdk");
    return sdk.authenticateRequest(req);
  },
  async exchangeCodeForToken(code, state) {
    const { sdk } = await import("./sdk");
    return sdk.exchangeCodeForToken(code, state);
  },
  async getUserInfo(accessToken) {
    const { sdk } = await import("./sdk");
    return sdk.getUserInfo(accessToken);
  },
  async createSessionToken(openId, options) {
    const { sdk } = await import("./sdk");
    return sdk.createSessionToken(openId, options);
  },
};

export function getAuthProvider(): AuthProvider {
  if (ENV.authProvider === "legacy-manus") {
    return legacyManusAuthProvider;
  }
  if (ENV.authProvider === "supabase") {
    return supabaseCookieDisabledProvider;
  }
  return localDevAuthProvider;
}

export const authProvider = getAuthProvider();
