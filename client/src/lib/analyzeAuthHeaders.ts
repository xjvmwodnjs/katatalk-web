import { supabase } from "@/lib/supabase";

/** 분석 API 호출 시 Authorization 헤더 (Supabase 세션이 있을 때만) */
export async function getAnalyzeAuthHeaders(): Promise<HeadersInit> {
  if (!supabase) {
    return {};
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}
