import { trpc } from "@/lib/trpc";
import { purgeDeprecatedBrowserIdentityCache } from "@/lib/browserPrivacy";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import {
  KataTalkAuthContext,
  type KataTalkAuthContextValue,
} from "./authContext";

/** Supabase / local-dev / Manus 등 Clerk 이전 인증 경로 */
export function KataTalkLegacyAuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const utils = trpc.useUtils();

  useEffect(() => {
    purgeDeprecatedBrowserIdentityCache();
  }, []);

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      if (import.meta.env.VITE_AUTH_PROVIDER === "supabase") {
        const { supabase: sb } = await import("@/lib/supabase");
        await sb?.auth.signOut();
      }
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  const value = useMemo<KataTalkAuthContextValue>(() => {
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: (meQuery.error ?? logoutMutation.error) as Error | null,
      isAuthenticated: Boolean(meQuery.data),
      logout,
      refresh: () => {
        void meQuery.refetch();
      },
    };
  }, [
    logout,
    meQuery,
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  return (
    <KataTalkAuthContext.Provider value={value}>
      {children}
    </KataTalkAuthContext.Provider>
  );
}
