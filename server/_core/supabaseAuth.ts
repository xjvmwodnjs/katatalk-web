import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import type { AuthenticatedUser } from "./sdk";

let _anonClient: SupabaseClient | null = null;

/** legacy Supabase — anon 키로 JWT 검증만 (service_role 사용 안 함) */
export function getSupabaseAnonClient(): SupabaseClient | null {
  if (!ENV.supabaseUrl || !ENV.supabaseAnonKey) {
    return null;
  }
  if (!_anonClient) {
    _anonClient = createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _anonClient;
}

export function parseBearerAuthorization(header: string | undefined): string | null {
  if (!header || typeof header !== "string") {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export async function verifySupabaseAccessTokenAndSyncUser(
  accessToken: string
): Promise<AuthenticatedUser | null> {
  const client = getSupabaseAnonClient();
  if (!client) {
    return null;
  }
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) {
    return null;
  }
  const su = data.user;
  const openId = `sb:${su.id}`;
  const meta = su.user_metadata as Record<string, unknown> | undefined;
  const name =
    (typeof meta?.name === "string" && meta.name) ||
    (typeof meta?.full_name === "string" && meta.full_name) ||
    (su.email ? su.email.split("@")[0] : null);
  const loginMethod =
    su.app_metadata?.provider === "google" ? "google" : su.email ? "email" : "supabase";

  await db.upsertUser({
    openId,
    email: su.email ?? null,
    name,
    loginMethod,
    lastSignedIn: new Date(),
  });

  const row = await db.getUserByOpenId(openId);
  if (!row) {
    return null;
  }
  return { ...row } as AuthenticatedUser;
}
