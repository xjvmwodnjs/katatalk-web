import type { Request } from "express";
import { ForbiddenError } from "@shared/_core/errors";
import type { User } from "../../drizzle/schema";
import { ENV } from "./env";
import type { AuthenticatedUser } from "./sdk";
import type { ExchangeTokenResponse, GetUserInfoResponse } from "./types/manusTypes";

export interface AuthProvider {
  name: "local-dev" | "legacy-manus" | "supabase" | "clerk";
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

const supabaseCookieDisabledProvider: AuthProvider = {
  name: "supabase",
  async authenticateRequest() {
    throw ForbiddenError("supabase 모드는 Authorization Bearer 만 사용합니다.");
  },
};

const clerkCookieDisabledProvider: AuthProvider = {
  name: "clerk",
  async authenticateRequest() {
    throw ForbiddenError("clerk 모드는 Authorization Bearer(Clerk JWT)만 사용합니다.");
  },
};

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
  if (ENV.authProvider === "clerk") {
    return clerkCookieDisabledProvider;
  }
  return localDevAuthProvider;
}

export const authProvider = getAuthProvider();
