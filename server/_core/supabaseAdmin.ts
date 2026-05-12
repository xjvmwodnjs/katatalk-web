import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "./env";

let cached: SupabaseClient | null = null;

/** Supabase 크레딧/작업 DB 접근 불가 — env 미설정 등 (시크릿 미포함). */
export class SupabaseAdminUnavailableError extends Error {
  readonly code = "SUPABASE_ADMIN_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "SupabaseAdminUnavailableError";
  }
}

/**
 * 서비스 롤 클라이언트 — 서버 전용. 클라이언트 번들에서 import 금지.
 * SUPABASE_SERVICE_ROLE_KEY 는 로그에 출력하지 않는다.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (cached) {
    return cached;
  }

  const url = ENV.supabaseUrl.trim();
  const serviceRoleKey = ENV.supabaseServiceRoleKey.trim();

  if (!url || !serviceRoleKey) {
    if (ENV.isProduction) {
      throw new Error(
        "운영 환경에서는 SUPABASE_URL 및 SUPABASE_SERVICE_ROLE_KEY(서비스 롤)가 필요합니다."
      );
    }
    throw new SupabaseAdminUnavailableError(
      "크레딧 기능을 사용하려면 서버에 SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 설정해 주세요. (Supabase Dashboard → Project Settings → API)"
    );
  }

  cached = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
