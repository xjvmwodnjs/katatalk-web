import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** legacy Supabase Auth — 사용 안 할 때는 env 미설정으로 null 유지 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { detectSessionInUrl: true, flowType: "pkce" },
      })
    : null;
