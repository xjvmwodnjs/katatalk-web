import { trpc } from "@/lib/trpc";
import { supabase } from "@/lib/supabase";
import { getClerkBearerHeaders } from "@/lib/clerkSessionBridge";
import { KataTalkAuthRoot } from "@/_core/auth/KataTalkAuthRoot";
import { KATATALK_UI_LANG_EVENT, readStoredUiLang, type UiLangCode } from "@/const";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { ClerkProvider } from "@clerk/clerk-react";
import { enUS, jaJP, koKR, zhCN } from "@clerk/localizations";
import { dark } from "@clerk/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import { useEffect, useState, type ReactNode } from "react";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient();

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
        if (import.meta.env.VITE_AUTH_PROVIDER === "clerk") {
          return getClerkBearerHeaders();
        }
        if (import.meta.env.VITE_AUTH_PROVIDER === "supabase" && supabase) {
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
    if (import.meta.env.VITE_AUTH_PROVIDER !== "supabase" || !supabase) {
      return;
    }
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void utils.auth.me.invalidate();
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [utils]);
  return null;
}

const clerkPk = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";
const clerkMode = import.meta.env.VITE_AUTH_PROVIDER === "clerk";
const useClerk = clerkMode && Boolean(clerkPk);

const CLERK_LOCALIZATION: Record<UiLangCode, typeof koKR> = {
  ko: koKR,
  en: enUS,
  zh: zhCN,
  ja: jaJP,
};

/** Clerk 기본 다크 테마 + KataTalk 톤(골드 포인트, 입력 텍스트 고대비) */
function ClerkProviderShell({ children }: { children: ReactNode }) {
  const [uiLang, setUiLang] = useState<UiLangCode>(() =>
    typeof window !== "undefined" ? readStoredUiLang() : "ko"
  );

  useEffect(() => {
    const sync = () => setUiLang(readStoredUiLang());
    window.addEventListener(KATATALK_UI_LANG_EVENT, sync);
    return () => window.removeEventListener(KATATALK_UI_LANG_EVENT, sync);
  }, []);

  return (
    <ClerkProvider
      publishableKey={clerkPk}
      localization={CLERK_LOCALIZATION[uiLang]}
      afterSignInUrl="/"
      afterSignUpUrl="/"
      afterSignOutUrl="/login"
      signInUrl="/login"
      signUpUrl="/sign-up"
      appearance={{
        baseTheme: dark,
        variables: {
          colorPrimary: "#C9A84C",
          colorBackground: "#16161c",
          colorInputBackground: "rgba(255,255,255,0.08)",
          colorInputText: "#fafafa",
          colorText: "#f4f4f5",
          colorTextSecondary: "#a1a1aa",
          colorNeutral: "#71717a",
          colorDanger: "#fca5a5",
          colorSuccess: "#86efac",
          borderRadius: "12px",
          fontFamily: "'Noto Sans KR', system-ui, sans-serif",
        },
        elements: {
          rootBox: "w-full",
          card: "border border-white/10 bg-zinc-900/95 shadow-2xl",
          headerTitle: "text-amber-50 font-semibold",
          headerSubtitle: "text-zinc-400",
          socialButtonsBlockButton:
            "rounded-xl border border-white/15 bg-white/5 text-zinc-100 hover:bg-white/12 focus-visible:ring-2 focus-visible:ring-amber-400/45",
          formButtonPrimary:
            "rounded-xl font-semibold text-stone-950 shadow-md hover:brightness-110 focus-visible:ring-2 focus-visible:ring-amber-400/55 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
          formFieldInput:
            "rounded-xl border-white/18 bg-zinc-950/90 text-white caret-amber-300 placeholder:text-zinc-400 focus:border-amber-500/45 focus:shadow-[0_0_0_1px_rgba(250,204,21,0.25)]",
          formFieldLabel: "text-zinc-200 font-medium",
          formFieldHintText: "text-zinc-400",
          formFieldErrorText: "text-red-300",
          dividerText: "text-zinc-400",
          dividerLine: "bg-zinc-600",
          footerActionLink:
            "text-amber-200 hover:text-amber-100 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 rounded-sm",
          identityPreviewText: "text-zinc-200",
          alternativeMethodsBlockButton:
            "rounded-xl border border-white/12 bg-white/5 text-zinc-100 hover:bg-white/10",
          formFieldInputShowPasswordButton: "text-zinc-300 hover:text-white",
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
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
  createRoot(rootEl).render(
    useClerk ? <ClerkProviderShell>{inner}</ClerkProviderShell> : inner
  );
}
