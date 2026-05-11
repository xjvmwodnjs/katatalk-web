import { trpc } from "@/lib/trpc";
import { supabase } from "@/lib/supabase";
import { getClerkBearerHeaders } from "@/lib/clerkSessionBridge";
import { KataTalkAuthRoot } from "@/_core/auth/KataTalkAuthRoot";
import { KATATALK_UI_LANG_EVENT, readStoredUiLang, type UiLangCode } from "@/const";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { ClerkProvider } from "@clerk/clerk-react";
import { enUS, jaJP, koKR, zhCN } from "@clerk/localizations";
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
      afterSignOutUrl="/login"
      signInUrl="/login"
      signUpUrl="/login"
      appearance={{
        variables: {
          colorPrimary: "#A08030",
          colorBackground: "#ffffff",
          colorInputBackground: "#f4f4f5",
          colorInputText: "#18181b",
          colorText: "#18181b",
          colorTextSecondary: "#52525b",
          colorNeutral: "#78716c",
          colorDanger: "#b91c1c",
          colorSuccess: "#15803d",
          borderRadius: "12px",
          fontFamily: "'Noto Sans KR', system-ui, sans-serif",
        },
        elements: {
          rootBox: "w-full",
          card: "bg-white border border-stone-200 shadow-none",
          headerTitle: "text-stone-900 font-semibold",
          headerSubtitle: "text-stone-600",
          socialButtonsBlockButton:
            "rounded-xl border border-stone-200 bg-white text-stone-800 hover:bg-stone-50",
          formButtonPrimary:
            "rounded-xl text-stone-950 font-semibold shadow-sm hover:brightness-95 focus-visible:ring-2 focus-visible:ring-amber-600/50",
          formFieldInput:
            "rounded-xl border-stone-200 text-stone-900 placeholder:text-stone-400",
          formFieldLabel: "text-stone-800 font-medium",
          formFieldHintText: "text-stone-600",
          formFieldErrorText: "text-red-700",
          footerActionLink: "text-amber-900 font-medium hover:text-amber-950",
          identityPreviewText: "text-stone-800",
          alternativeMethodsBlockButton: "rounded-xl border border-stone-200",
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
      className="min-h-screen flex items-center justify-center p-6 text-center text-sm text-stone-800"
      style={{ background: "linear-gradient(180deg, #faf8f4 0%, #f0ebe3 100%)" }}
    >
      <div className="max-w-md rounded-2xl border border-amber-900/15 bg-white px-6 py-8 shadow-lg leading-relaxed">
        <p className="font-semibold text-stone-900 mb-2">Clerk 설정이 필요합니다</p>
        <p>
          Vite 클라이언트에{" "}
          <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-800">
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
