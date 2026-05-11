import { getClerkBearerHeaders } from "@/lib/clerkSessionBridge";
import { supabase } from "@/lib/supabase";

/** 분석 API용 Authorization (clerk > supabase 순) */
export async function getAnalyzeAuthHeaders(): Promise<HeadersInit> {
  if (import.meta.env.VITE_AUTH_PROVIDER === "clerk") {
    return getClerkBearerHeaders();
  }
  if (import.meta.env.VITE_AUTH_PROVIDER === "supabase" && supabase) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  return {};
}
