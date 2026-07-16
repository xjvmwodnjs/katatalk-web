import { trpc } from "@/lib/trpc";
import { KataTalkAuthRoot } from "@/_core/auth/KataTalkAuthRoot";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import { lazy, Suspense, useEffect } from "react";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient();
const authProvider = import.meta.env.VITE_AUTH_PROVIDER;
const clerkPk = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";
const clerkMode = authProvider === "clerk";
const useClerk = clerkMode && Boolean(clerkPk);

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      async headers() {
        if (authProvider === "clerk") {
          const { getClerkBearerHeaders } = await import("@/lib/clerkSessionBridge");
          return getClerkBearerHeaders();
        }
        if (authProvider === "supabase") {
          const { supabase } = await import("@/lib/supabase");
          if (!supabase) {
            return {};
          }
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          return token ? { Authorization: `Bearer ${token}` } : {};
        }
        return {};
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

function SupabaseSessionSync() {
  const utils = trpc.useUtils();
  useEffect(() => {
    if (authProvider !== "supabase") {
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void import("@/lib/supabase").then(({ supabase }) => {
      if (cancelled || !supabase) {
        return;
      }
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(() => {
        void utils.auth.me.invalidate();
      });
      if (cancelled) {
        subscription.unsubscribe();
        return;
      }
      unsubscribe = () => subscription.unsubscribe();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [utils]);
  return null;
}

if (clerkMode && !clerkPk) {
  console.error("[KataTalk] VITE_AUTH_PROVIDER=clerk 인데 VITE_CLERK_PUBLISHABLE_KEY 가 없습니다.");
}

const inner = (
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <KataTalkAuthRoot>
        <SupabaseSessionSync />
        <App />
      </KataTalkAuthRoot>
    </QueryClientProvider>
  </trpc.Provider>
);

const rootEl = document.getElementById("root")!;

if (clerkMode && !clerkPk) {
  createRoot(rootEl).render(
    <div
      className="min-h-screen flex items-center justify-center p-6 text-center text-sm text-zinc-200"
      style={{ background: "oklch(0.13 0.005 285)" }}
    >
      <div
        className="max-w-md rounded-2xl border border-amber-500/25 bg-zinc-900/90 px-6 py-8 shadow-xl leading-relaxed"
        style={{ fontFamily: "'Noto Sans KR', sans-serif" }}
      >
        <p className="font-semibold text-amber-100 mb-2">Clerk 설정이 필요합니다</p>
        <p className="text-zinc-300">
          Vite 클라이언트에{" "}
          <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs text-amber-100">
            VITE_CLERK_PUBLISHABLE_KEY
          </code>{" "}
          를 .env 에 넣은 뒤 개발 서버를 다시 시작하세요. 이 값은 Git 에 커밋하지 마세요.
        </p>
      </div>
    </div>
  );
} else {
  if (useClerk) {
    const LazyClerkProviderShell = lazy(() =>
      import("@/_core/auth/ClerkProviderShell").then(module => ({
        default: module.ClerkProviderShell,
      }))
    );
    createRoot(rootEl).render(
      <Suspense fallback={<div className="min-h-screen bg-background" />}>
        <LazyClerkProviderShell publishableKey={clerkPk}>{inner}</LazyClerkProviderShell>
      </Suspense>
    );
  } else {
    createRoot(rootEl).render(inner);
  }
}
