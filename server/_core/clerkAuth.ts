import { verifyToken } from "@clerk/backend";
import {
  TokenVerificationErrorReason,
  type TokenVerificationError,
} from "@clerk/backend/errors";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { AuthDependencyUnavailableError } from "./authErrors";
import { ENV } from "./env";
import type { AuthenticatedUser } from "./sdk";

function mapRow(row: User): AuthenticatedUser {
  return { ...row } as AuthenticatedUser;
}

/** DATABASE_URL 없을 때 JWT만으로 요청 사용자를 채움 (DB 없이도 인증·/api/analyze 보호 유지) */
function buildClerkUserWithoutDb(
  openId: string,
  email: string | null,
  name: string | null
): AuthenticatedUser {
  const now = new Date();
  return {
    id: 0,
    openId,
    name,
    email,
    loginMethod: "clerk",
    role: "user",
    subscriptionTier: "free",
    remainingAnalysisCount: 2,
    maxAnalysisCount: 3,
    subscriptionStartDate: null,
    preferredLanguage: "ko",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  } as AuthenticatedUser;
}

const INVALID_TOKEN_REASONS = new Set<string>([
  TokenVerificationErrorReason.TokenExpired,
  TokenVerificationErrorReason.TokenInvalid,
  TokenVerificationErrorReason.TokenInvalidAlgorithm,
  TokenVerificationErrorReason.TokenInvalidAuthorizedParties,
  TokenVerificationErrorReason.TokenInvalidSignature,
  TokenVerificationErrorReason.TokenNotActiveYet,
  TokenVerificationErrorReason.TokenIatInTheFuture,
  TokenVerificationErrorReason.TokenVerificationFailed,
  TokenVerificationErrorReason.JWKKidMismatch,
]);

function isInvalidClerkTokenError(error: unknown): boolean {
  const reason =
    error != null && typeof error === "object"
      ? (error as Partial<TokenVerificationError>).reason
      : undefined;
  return typeof reason === "string" && INVALID_TOKEN_REASONS.has(reason);
}

function isParsableJwtSyntax(token: string): boolean {
  const segments = token.split(".");
  if (segments.length !== 3) {
    return false;
  }

  try {
    const [headerSegment, payloadSegment, signatureSegment] = segments;
    if (!headerSegment || !payloadSegment || !signatureSegment) {
      return false;
    }
    for (const segment of segments) {
      if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
        return false;
      }
      const bytes = Buffer.from(segment, "base64url");
      if (bytes.length === 0 || bytes.toString("base64url") !== segment) {
        return false;
      }
    }

    const header = JSON.parse(
      Buffer.from(headerSegment, "base64url").toString("utf8")
    ) as unknown;
    const payload = JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString("utf8")
    ) as unknown;
    return (
      header != null &&
      typeof header === "object" &&
      !Array.isArray(header) &&
      payload != null &&
      typeof payload === "object" &&
      !Array.isArray(payload)
    );
  } catch {
    return false;
  }
}

function clerkClaimsFromPayload(
  payload: Awaited<ReturnType<typeof verifyToken>>
): {
  openId: string;
  email: string | null;
  name: string | null;
} | null {
  const subject = typeof payload?.sub === "string" ? payload.sub.trim() : "";
  if (!subject) {
    return null;
  }

  const claims = payload as Record<string, unknown>;
  const email =
    typeof claims.email === "string"
      ? claims.email
      : typeof claims.primary_email === "string"
        ? (claims.primary_email as string)
        : null;
  const name =
    typeof claims.name === "string"
      ? claims.name
      : typeof claims.username === "string"
        ? (claims.username as string)
        : email
          ? (email.split("@")[0] ?? null)
          : null;

  return { openId: `clerk:${subject}`, email, name };
}

/**
 * Clerk 세션 JWT를 검증하고 기존 identity를 읽기만 한다.
 *
 * 이 함수는 polling/auth.me 경로에서 호출되므로 MySQL upsert나 Supabase
 * profile provisioning을 절대 수행하지 않는다. DB row가 아직 없으면 검증된
 * JWT claim 기반 identity를 반환하고, 명시적 first-use 경계가 별도로 생성한다.
 */
export async function verifyClerkBearerReadOnly(
  accessToken: string
): Promise<AuthenticatedUser | null> {
  if (!ENV.clerkSecretKey) {
    throw new AuthDependencyUnavailableError();
  }

  let payload: Awaited<ReturnType<typeof verifyToken>>;
  try {
    payload = await verifyToken(accessToken, {
      secretKey: ENV.clerkSecretKey,
    });
  } catch (error) {
    if (isInvalidClerkTokenError(error) || !isParsableJwtSyntax(accessToken)) {
      return null;
    }
    throw new AuthDependencyUnavailableError();
  }

  const identity = clerkClaimsFromPayload(payload);
  if (!identity) {
    return null;
  }

  if (!ENV.databaseUrl?.trim()) {
    return buildClerkUserWithoutDb(
      identity.openId,
      identity.email,
      identity.name
    );
  }

  try {
    const row = await db.getUserByOpenIdRequired(identity.openId);
    return row
      ? mapRow(row)
      : buildClerkUserWithoutDb(identity.openId, identity.email, identity.name);
  } catch {
    throw new AuthDependencyUnavailableError();
  }
}

/**
 * Explicit first-use identity provisioning for validated mutation boundaries.
 * Existing identities return without a write; new rows use the existing
 * idempotent upsert contract and are read back before continuing.
 */
export async function provisionClerkUserForFirstUse(
  user: AuthenticatedUser
): Promise<AuthenticatedUser> {
  if (
    !user.openId.startsWith("clerk:") ||
    !ENV.databaseUrl?.trim() ||
    user.id !== 0
  ) {
    return user;
  }

  try {
    const existing = await db.getUserByOpenIdRequired(user.openId);
    if (existing) {
      return mapRow(existing);
    }

    await db.upsertUser({
      openId: user.openId,
      email: user.email ?? null,
      name: user.name ?? null,
      loginMethod: "clerk",
      lastSignedIn: new Date(),
    });

    const created = await db.getUserByOpenIdRequired(user.openId);
    if (!created) {
      throw new AuthDependencyUnavailableError();
    }
    return mapRow(created);
  } catch (error) {
    if (error instanceof AuthDependencyUnavailableError) {
      throw error;
    }
    throw new AuthDependencyUnavailableError();
  }
}
