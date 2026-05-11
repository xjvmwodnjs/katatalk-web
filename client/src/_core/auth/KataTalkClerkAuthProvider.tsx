import { trpc } from "@/lib/trpc";
import { registerClerkGetToken } from "@/lib/clerkSessionBridge";
import { TRPCClientError } from "@trpc/client";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { KataTalkAuthContext, type KataTalkAuthContextValue } from "./authContext";

/** Clerk 세션 + 서버 동기화된 auth.me 를 하나의 컨텍스트로 제공 */
export function KataTalkClerkAuthProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  const { isLoaded, isSignedIn, signOut, getToken } = useClerkAuth();

  useEffect(() => {
    registerClerkGetToken(async () => (await getToken()) ?? null);
  }, [getToken]);

  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: isLoaded && isSignedIn,
    retry: 2,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!isLoaded) return;
    void meQuery.refetch();
  }, [isLoaded, isSignedIn, meQuery]);

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await signOut();
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
  }, [logoutMutation, signOut, utils]);

  const value = useMemo<KataTalkAuthContextValue>(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("katatalk-runtime-user-info", JSON.stringify(meQuery.data));
    }
    return {
      user: meQuery.data ?? null,
      loading: !isLoaded || (isSignedIn && meQuery.isLoading) || logoutMutation.isPending,
      error: (meQuery.error ?? logoutMutation.error) as Error | null,
      isAuthenticated: Boolean(isSignedIn && meQuery.data),
      logout,
      refresh: () => {
        void meQuery.refetch();
      },
    };
  }, [
    isLoaded,
    isSignedIn,
    logout,
    logoutMutation.error,
    logoutMutation.isPending,
    meQuery,
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
  ]);

  return <KataTalkAuthContext.Provider value={value}>{children}</KataTalkAuthContext.Provider>;
}
