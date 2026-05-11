import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * 브라우저 전용 Supabase 클라이언트 (anon key만 사용).
 * service_role 등 서버 전용 키는 절대 여기에 넣지 않음.
 */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          detectSessionInUrl: true,
          flowType: "pkce",
        },
      })
    : null;
