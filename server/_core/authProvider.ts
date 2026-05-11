import type { Request } from "express";
import type { User } from "../../drizzle/schema";
import { ENV } from "./env";
import type { AuthenticatedUser } from "./sdk";
import type { ExchangeTokenResponse, GetUserInfoResponse } from "./types/manusTypes";

export interface AuthProvider {
  name: "local-dev" | "legacy-manus";
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
 * Legacy Manus OAuth adapter.
 * TODO: Replace this provider with Supabase Auth in the commercial service.
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
  return ENV.authProvider === "legacy-manus"
    ? legacyManusAuthProvider
    : localDevAuthProvider;
}

export const authProvider = getAuthProvider();
