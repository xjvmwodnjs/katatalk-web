import { trpc } from "@/lib/trpc";
import { registerClerkGetToken } from "@/lib/clerkSessionBridge";
import { purgeDeprecatedBrowserIdentityCache } from "@/lib/browserPrivacy";
import { TRPCClientError } from "@trpc/client";
import { useAuth as useClerkAuth, useUser } from "@clerk/clerk-react";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import {
  KataTalkAuthContext,
  type KataTalkAuthContextValue,
} from "./authContext";

/** Clerk useUser() 기준 표시명: fullName → username → 이메일 @앞 → 이메일 전체 */
function clerkDisplayNameParts(
  clerkUser: NonNullable<ReturnType<typeof useUser>["user"]>
) {
  const full = (clerkUser.fullName ?? "").trim();
  if (full)
    return {
      name: full,
      email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
    };
  const un = (clerkUser.username ?? "").trim();
  if (un)
    return {
      name: un,
      email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
    };
  const email = (clerkUser.primaryEmailAddress?.emailAddress ?? "").trim();
  if (email) {
    const at = email.indexOf("@");
    const local = at > 0 ? email.slice(0, at).trim() : email;
    return { name: local || email, email };
  }
  return { name: null as string | null, email: null as string | null };
}

/** Clerk 세션 + 서버 동기화된 auth.me 를 하나의 컨텍스트로 제공 */
export function KataTalkClerkAuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const utils = trpc.useUtils();
  const { isLoaded, isSignedIn, signOut, getToken } = useClerkAuth();
  const { user: clerkUser, isLoaded: clerkUserLoaded } = useUser();

  useEffect(() => {
    registerClerkGetToken(async () => (await getToken()) ?? null);
  }, [getToken]);

  useEffect(() => {
    purgeDeprecatedBrowserIdentityCache();
  }, []);

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

  const mergedUser = useMemo(() => {
    const base = meQuery.data;
    if (!base) return null;
    if (!isSignedIn || !isLoaded || !clerkUserLoaded || !clerkUser) {
      return base;
    }
    const { name: clerkName, email: clerkEmail } =
      clerkDisplayNameParts(clerkUser);
    const baseName = typeof base.name === "string" ? base.name.trim() : "";
    const baseEmail = typeof base.email === "string" ? base.email.trim() : "";
    const resolvedEmail = (clerkEmail ?? "").trim() || baseEmail || null;
    const resolvedName =
      (clerkName ?? "").trim() ||
      baseName ||
      (resolvedEmail?.includes("@")
        ? resolvedEmail.split("@")[0]!.trim()
        : resolvedEmail) ||
      resolvedEmail ||
      null;
    return {
      ...base,
      name: resolvedName ? resolvedName.trim() : null,
      email: resolvedEmail ?? base.email,
    };
  }, [meQuery.data, isSignedIn, isLoaded, clerkUserLoaded, clerkUser]);

  const value = useMemo<KataTalkAuthContextValue>(() => {
    return {
      user: mergedUser,
      loading:
        !isLoaded ||
        (isSignedIn && meQuery.isLoading) ||
        logoutMutation.isPending,
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
    clerkUserLoaded,
    logout,
    logoutMutation.error,
    logoutMutation.isPending,
    meQuery,
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    mergedUser,
  ]);

  return (
    <KataTalkAuthContext.Provider value={value}>
      {children}
    </KataTalkAuthContext.Provider>
  );
}
