import { verifyToken } from "@clerk/backend";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import type { AuthenticatedUser } from "./sdk";
import { ensureWalletWithSignupBonus } from "../creditService";

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

/**
 * Clerk 세션 JWT 검증 후 users 동기화. CLERK_SECRET_KEY 는 서버 전용.
 * DATABASE_URL 이 없으면 DB upsert 없이 JWT 클레임만으로 사용자를 반환한다.
 */
export async function verifyClerkBearerAndSyncUser(
  accessToken: string
): Promise<AuthenticatedUser | null> {
  if (!ENV.clerkSecretKey) {
    console.error("[clerkAuth] CLERK_SECRET_KEY 가 비어 있습니다.");
    return null;
  }

  let payload: Awaited<ReturnType<typeof verifyToken>>;
  try {
    payload = await verifyToken(accessToken, {
      secretKey: ENV.clerkSecretKey,
    });
  } catch {
    return null;
  }

  if (!payload || typeof payload.sub !== "string") {
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

  const openId = `clerk:${payload.sub}`;

  const hasDatabaseUrl = Boolean(ENV.databaseUrl?.trim());
  if (!hasDatabaseUrl) {
    const u = buildClerkUserWithoutDb(openId, email, name);
    await ensureWalletWithSignupBonus(u);
    return u;
  }

  await db.upsertUser({
    openId,
    email,
    name,
    loginMethod: "clerk",
    lastSignedIn: new Date(),
  });

  const row = await db.getUserByOpenId(openId);
  if (!row) {
    console.warn("[clerkAuth] DB 사용자 행 없음 — 연결 또는 마이그레이션 확인");
    return null;
  }

  const authed = mapRow(row);
  await ensureWalletWithSignupBonus(authed);
  return authed;
}
