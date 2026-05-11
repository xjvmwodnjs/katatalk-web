import { getLoginUrl } from "@/const";
import { KataTalkAuthContext } from "@/_core/auth/authContext";
import { useContext, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = getLoginUrl() } =
    options ?? {};
  const ctx = useContext(KataTalkAuthContext);
  if (!ctx) {
    throw new Error("KataTalkAuthRoot 가 트리 상단에 없습니다.");
  }

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (ctx.loading) return;
    if (ctx.user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;
    window.location.href = redirectPath;
  }, [ctx.loading, ctx.user, redirectOnUnauthenticated, redirectPath]);

  return useMemo(
    () => ({
      ...ctx,
      refresh: ctx.refresh,
    }),
    [ctx]
  );
}
