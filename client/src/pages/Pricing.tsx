// =============================================================
// Pricing Page: Dedicated subscription plans page
// =============================================================

import { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl, readStoredUiLang, persistUiLang, KATATALK_UI_LANG_EVENT } from "@/const";
import { ArrowLeft, Crown, LogIn, LogOut, User, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import { TRANSLATIONS, Language } from "@/lib/mockData";
import { trpc } from "@/lib/trpc";
import LanguageSelector from "@/components/LanguageSelector";
import PricingTable from "@/components/PricingTable";

export default function Pricing() {
  const { user, isAuthenticated, logout } = useAuth();
  const [lang, setLang] = useState<Language>(() => readStoredUiLang() as Language);
  const t = TRANSLATIONS[lang];

  useEffect(() => {
    const syncLang = () => setLang(readStoredUiLang() as Language);
    window.addEventListener(KATATALK_UI_LANG_EVENT, syncLang);
    return () => window.removeEventListener(KATATALK_UI_LANG_EVENT, syncLang);
  }, []);

  const { data: subscription } = trpc.profile.getSubscription.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const creditBalance = subscription?.creditBalance ?? subscription?.remainingAnalysisCount ?? 0;

  const handleLogin = () => {
    window.location.href = getLoginUrl();
  };

  const handleLogout = async () => {
    await logout();
    toast.success(t.logoutSuccess);
  };

  return (
    <div className="min-h-screen" style={{ background: "oklch(0.13 0.005 285)" }}>
      {/* ─── Top Navigation Bar ─── */}
      <header
        className="sticky top-0 z-40 border-b"
        style={{
          background: "rgba(16, 16, 22, 0.92)",
          borderColor: "rgba(255,255,255,0.06)",
          backdropFilter: "blur(16px)",
        }}
      >
        <div className="container flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/">
            <div className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity">
              <div
                className="w-7 h-7 rounded-md flex items-center justify-center"
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
                className="text-sm font-semibold text-amber-100 hidden sm:block"
                style={{ fontFamily: "'Noto Serif KR', serif" }}
              >
                KataTalk
              </span>
            </div>
          </Link>

          {/* Right controls */}
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <>
                <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <div className="w-6 h-6 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(201, 168, 76, 0.2)" }}
                  >
                    <User className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <span className="text-xs font-medium text-amber-200" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                    {user?.name || user?.email || "User"}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{
                      background: "rgba(201, 168, 76, 0.15)",
                      color: "#C9A84C",
                    }}
                  >
                    {lang === "ko"
                      ? `크레딧 ${creditBalance}`
                      : lang === "en"
                        ? `Credits ${creditBalance}`
                        : lang === "zh"
                          ? `积分 ${creditBalance}`
                          : `クレジット ${creditBalance}`}
                  </span>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 hover:bg-white/5"
                  style={{ color: "#94a3b8", fontFamily: "'Noto Sans KR', sans-serif" }}
                >
                  <LogOut className="w-3.5 h-3.5" />
                  {t.logout}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleLogin}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 hover:bg-white/5"
                  style={{ color: "#94a3b8", fontFamily: "'Noto Sans KR', sans-serif" }}
                >
                  <LogIn className="w-3.5 h-3.5" />
                  {t.login}
                </button>
                <button
                  onClick={handleLogin}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "#e2e8f0",
                    fontFamily: "'Noto Sans KR', sans-serif",
                  }}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  {t.signup}
                </button>
              </>
            )}

            {/* Divider */}
            <div className="w-px h-5 mx-1" style={{ background: "rgba(255,255,255,0.1)" }} />

            {/* Language Selector */}
            <LanguageSelector
              current={lang}
              onChange={next => {
                setLang(next);
                persistUiLang(next);
              }}
            />
          </div>
        </div>
      </header>

      {/* ─── Main Content ─── */}
      <main className="container">
        {/* Back to Home */}
        <div className="pt-6">
          <Link href="/">
            <button
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 hover:bg-white/5"
              style={{
                color: "#94a3b8",
                border: "1px solid rgba(255,255,255,0.08)",
                fontFamily: "'Noto Sans KR', sans-serif",
              }}
            >
              <ArrowLeft className="w-4 h-4" />
              {t.backToUpload}
            </button>
          </Link>
        </div>

        {/* Pricing Table */}
        <PricingTable
          t={t}
          locale={lang}
          isAuthenticated={isAuthenticated}
          onRequireLogin={() => {
            window.location.href = getLoginUrl();
          }}
        />

        {/* Footer */}
        <footer className="py-8 border-t text-center" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <p className="text-xs text-slate-600" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            {t.footerPowered}
          </p>
          <p className="text-xs text-slate-700 mt-1" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
            {t.footerDisclaimer}
          </p>
        </footer>
      </main>
    </div>
  );
}
