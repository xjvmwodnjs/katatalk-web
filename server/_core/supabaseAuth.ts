import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import type { AuthenticatedUser } from "./sdk";

let _anonClient: SupabaseClient | null = null;

/**
 * JWT(access token) 검증 전용 Supabase 클라이언트(anon key).
 * 서비스 롤 키는 사용하지 않음 — RLS/유저 컨텍스트 밖에서도 getUser(jwt)는 anon으로 가능.
 */
export function getSupabaseAnonClient(): SupabaseClient | null {
  if (!ENV.supabaseUrl || !ENV.supabaseAnonKey) {
    return null;
  }
  if (!_anonClient) {
    _anonClient = createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return _anonClient;
}

/** Authorization 헤더에서 Bearer 토큰만 추출 */
export function parseBearerAuthorization(header: string | undefined): string | null {
  if (!header || typeof header !== "string") {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function mapDbUserToAuthenticated(row: User): AuthenticatedUser {
  return { ...row } as AuthenticatedUser;
}

/**
 * Supabase access token을 검증하고, 내부 users 테이블과 동기화한 뒤 Drizzle User를 반환.
 * TODO: Supabase 전용 프로필 테이블/구독 테이블과 정합성 맞추기
 */
export async function verifySupabaseAccessTokenAndSyncUser(
  accessToken: string
): Promise<AuthenticatedUser | null> {
  const client = getSupabaseAnonClient();
  if (!client) {
    console.error("[supabaseAuth] Supabase 클라이언트가 설정되지 않았습니다.");
    return null;
  }

  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) {
    return null;
  }

  const su = data.user;
  const openId = `sb:${su.id}`;
  const meta = su.user_metadata as Record<string, unknown> | undefined;
  const nameFromMeta =
    (typeof meta?.name === "string" && meta.name) ||
    (typeof meta?.full_name === "string" && meta.full_name) ||
    null;
  const name = nameFromMeta || (su.email ? su.email.split("@")[0] : null);
  const loginMethod =
    su.app_metadata?.provider === "google"
      ? "google"
      : su.email
        ? "email"
        : "supabase";

  await db.upsertUser({
    openId,
    email: su.email ?? null,
    name,
    loginMethod,
    lastSignedIn: new Date(),
  });

  const row = await db.getUserByOpenId(openId);
  if (!row) {
    console.warn(
      "[supabaseAuth] DB에 사용자 행이 없습니다. DATABASE_URL과 마이그레이션을 확인하세요."
    );
    return null;
  }

  return mapDbUserToAuthenticated(row);
}
