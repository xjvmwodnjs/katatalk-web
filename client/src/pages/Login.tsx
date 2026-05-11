import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { SignIn, UserButton, SignedIn, SignedOut } from "@clerk/clerk-react";
import { useAuth } from "@/_core/hooks/useAuth";
import LanguageSelector from "@/components/LanguageSelector";
import { KATATALK_UI_LANG_EVENT, readStoredUiLang, persistUiLang, type UiLangCode } from "@/const";
import type { Language } from "@/lib/mockData";

/** 로그인 페이지 주변 안내 (Clerk 미번역분 보완) */
const COPY: Record<
  UiLangCode,
  { title: string; subtitle: string; homeLink: string; notConfigured: string }
> = {
  ko: {
    title: "KataTalk",
    subtitle: "SGF 기보를 업로드하고 AI가 요약·패착을 짚어 드립니다.",
    homeLink: "홈으로",
    notConfigured:
      "Clerk 로그인을 쓰려면 .env 에 VITE_AUTH_PROVIDER=clerk 와 VITE_CLERK_PUBLISHABLE_KEY 를 설정한 뒤 다시 빌드하세요.",
  },
  en: {
    title: "KataTalk",
    subtitle: "Upload SGF games for AI summaries and mistake highlights.",
    homeLink: "Back to home",
    notConfigured:
      "Set VITE_AUTH_PROVIDER=clerk and VITE_CLERK_PUBLISHABLE_KEY in .env, then rebuild.",
  },
  zh: {
    title: "KataTalk",
    subtitle: "上传 SGF 棋谱，由 AI 生成摘要与失误要点。",
    homeLink: "返回首页",
    notConfigured: "请在 .env 中设置 VITE_AUTH_PROVIDER=clerk 与 VITE_CLERK_PUBLISHABLE_KEY 后重新构建。",
  },
  ja: {
    title: "KataTalk",
    subtitle: "SGF 棋譜をアップロードし、AI の要約と失着の指摘を受け取れます。",
    homeLink: "ホームへ",
    notConfigured:
      ".env に VITE_AUTH_PROVIDER=clerk と VITE_CLERK_PUBLISHABLE_KEY を設定し、再ビルドしてください。",
  },
};

const PAGE_BG = "linear-gradient(180deg, #faf8f4 0%, #f0ebe3 100%)";
const HEADER_BG = "rgba(255,255,255,0.92)";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, loading } = useAuth();
  const [uiLang, setUiLang] = useState<UiLangCode>(() => readStoredUiLang());
  const t = COPY[uiLang];

  useEffect(() => {
    const sync = () => setUiLang(readStoredUiLang());
    window.addEventListener(KATATALK_UI_LANG_EVENT, sync);
    return () => window.removeEventListener(KATATALK_UI_LANG_EVENT, sync);
  }, []);

  useEffect(() => {
    if (import.meta.env.VITE_AUTH_PROVIDER !== "clerk") {
      return;
    }
    if (!loading && isAuthenticated) {
      setLocation("/");
    }
  }, [isAuthenticated, loading, setLocation]);

  if (import.meta.env.VITE_AUTH_PROVIDER !== "clerk") {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6 text-sm text-stone-800"
        style={{ background: PAGE_BG }}
      >
        <div
          className="max-w-md rounded-2xl px-6 py-8 border border-amber-900/15 bg-white shadow-lg"
          style={{ fontFamily: "'Noto Sans KR', sans-serif" }}
        >
          <p className="leading-relaxed">{t.notConfigured}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: PAGE_BG }}>
      <header
        className="sticky top-0 z-40 border-b border-stone-200/80 shadow-sm"
        style={{
          background: HEADER_BG,
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="container flex items-center justify-between h-14 px-4 sm:px-6">
          <Link href="/">
            <div className="flex items-center gap-2.5 cursor-pointer rounded-lg p-1 -m-1 transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50 focus-visible:ring-offset-2">
              <div
                className="w-7 h-7 rounded-md flex items-center justify-center shadow-sm"
                style={{ background: "linear-gradient(135deg, #C9A84C, #8B6914)" }}
              >
                <span
                  className="text-xs font-bold text-black"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  AI
                </span>
              </div>
              <span
                className="text-sm font-semibold text-stone-900"
                style={{ fontFamily: "'Noto Serif KR', serif" }}
              >
                {t.title}
              </span>
            </div>
          </Link>
          <LanguageSelector
            tone="light"
            current={uiLang as Language}
            onChange={lang => {
              persistUiLang(lang as UiLangCode);
              setUiLang(lang as UiLangCode);
            }}
          />
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 gap-6 sm:gap-8">
        <div
          className="w-full max-w-md rounded-2xl p-6 sm:p-10 bg-white border border-stone-200/90 shadow-xl"
          style={{ boxShadow: "0 20px 50px rgba(28, 25, 23, 0.08)" }}
        >
          <div className="text-center mb-6 sm:mb-8">
            <h1
              className="text-2xl sm:text-3xl font-bold text-stone-900 mb-3"
              style={{ fontFamily: "'Noto Serif KR', serif" }}
            >
              {t.title}
            </h1>
            <p
              className="text-sm sm:text-base text-stone-600 leading-relaxed px-1"
              style={{ fontFamily: "'Noto Sans KR', sans-serif" }}
            >
              {t.subtitle}
            </p>
          </div>

          <SignedIn>
            <div className="flex flex-col items-center gap-5">
              <UserButton afterSignOutUrl="/login" />
              <Link
                href="/"
                className="inline-flex items-center justify-center min-h-[44px] px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 hover:brightness-95 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/55 focus-visible:ring-offset-2"
                style={{
                  background: "linear-gradient(135deg, #C9A84C, #A08030)",
                  color: "#0c0a09",
                  fontFamily: "'Noto Sans KR', sans-serif",
                }}
              >
                {t.homeLink}
              </Link>
            </div>
          </SignedIn>
          <SignedOut>
            <div className="w-full flex justify-center overflow-x-auto">
              <div className="min-w-0 w-full max-w-[100%] [&_.cl-card]:shadow-none">
                <SignIn routing="hash" />
              </div>
            </div>
          </SignedOut>
        </div>

        <Link
          href="/"
          className="text-sm text-stone-600 hover:text-stone-900 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50 rounded px-2 py-1"
        >
          ← {t.homeLink}
        </Link>
      </main>
    </div>
  );
}
