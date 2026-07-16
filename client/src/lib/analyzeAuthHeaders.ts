/** 분석 API용 Authorization (clerk > supabase 순) */
export async function getAnalyzeAuthHeaders(): Promise<HeadersInit> {
  if (import.meta.env.VITE_AUTH_PROVIDER === "clerk") {
    const { getClerkBearerHeaders } = await import("@/lib/clerkSessionBridge");
    return getClerkBearerHeaders();
  }
  if (import.meta.env.VITE_AUTH_PROVIDER === "supabase") {
    const { supabase } = await import("@/lib/supabase");
    if (!supabase) {
      return {};
    }
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  return {};
}
