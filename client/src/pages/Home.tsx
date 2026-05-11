// =============================================================
// Home Page: KataTalk — Upload + Analysis Results only (no pricing)
// =============================================================

import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, ArrowLeft, User, LogIn, UserPlus, Crown, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
import { MOCK_DATA, TRANSLATIONS, Language, type AnalysisReport } from "@/lib/mockData";
import { MAX_SGF_FILE_BYTES, SGF_UPLOAD_FORM_FIELD } from "@shared/const";
import LanguageSelector from "@/components/LanguageSelector";
import GameInfoHeader from "@/components/GameInfoHeader";
import MistakeCard from "@/components/MistakeCard";
import UploadHero from "@/components/UploadHero";

const HERO_IMAGE =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663648529385/J5iSKFXJDtYwWjNTkpCAQf/baduk-hero-banner-a8g9rYbRNcDesQ8M9KrgCA.webp";

type View = "upload" | "loading" | "result";

export default function Home() {
  const { user, isAuthenticated, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [lang, setLang] = useState<Language>("ko");
  const [view, setView] = useState<View>("upload");
  const [report, setReport] = useState<AnalysisReport>(MOCK_DATA);
  const t = TRANSLATIONS[lang];

  // Fetch subscription info if authenticated
  const { data: subscription } = trpc.profile.getSubscription.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const handleLogin = () => {
    window.location.href = getLoginUrl();
  };

  const handleLogout = async () => {
    await logout();
    toast.success(t.logoutSuccess);
  };

  // Auth Guard: block upload for unauthenticated users
  const handleAnalyzeRequest = async (file: File) => {
    if (!isAuthenticated) {
      toast.error(t.loginRequired, {
        description: lang === "ko" ? "기보 분석은 로그인 후 이용 가능합니다." :
          lang === "en" ? "Please log in to use the analysis feature." :
          lang === "zh" ? "请登录后使用分析功能。" : "分析機能をご利用いただくにはログインが必要です。",
        action: {
          label: t.login,
          onClick: handleLogin,
        },
      });
      return;
    }

    if (file.size > MAX_SGF_FILE_BYTES) {
      toast.error(
        lang === "ko" ? "파일이 너무 큽니다." :
        lang === "en" ? "File is too large." :
        lang === "zh" ? "文件太大。" : "ファイルが大きすぎます。",
        {
          description:
            lang === "ko" ? `SGF는 최대 ${MAX_SGF_FILE_BYTES / (1024 * 1024)}MB까지 업로드할 수 있습니다.` :
            lang === "en" ? `SGF uploads are limited to ${MAX_SGF_FILE_BYTES / (1024 * 1024)} MB.` :
            lang === "zh" ? `SGF 文件最大 ${MAX_SGF_FILE_BYTES / (1024 * 1024)} MB。` :
            `SGFは最大${MAX_SGF_FILE_BYTES / (1024 * 1024)}MBまでです。`,
        }
      );
      return;
    }

    // Show loading state and call /api/analyze (multipart SGF + language)
    setView("loading");
    try {
      const formData = new FormData();
      formData.append(SGF_UPLOAD_FORM_FIELD, file);
      formData.append("language", lang);

      const response = await fetch("/api/analyze", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const payload = await response.json().catch(() => ({})) as {
        success?: boolean;
        message?: string;
        data?: AnalysisReport;
        meta?: { mock?: boolean; message?: string };
      };

      if (!response.ok || payload.success === false) {
        const msg =
          typeof payload.message === "string" && payload.message.trim()
            ? payload.message
            : !response.ok
              ? `Analysis failed (${response.status})`
              : "Analysis failed";
        throw new Error(msg);
      }

      if (!payload.success || !payload.data) {
        throw new Error("Analysis response was empty");
      }

      setReport(payload.data);

      // Analysis complete — show results
      setView("result");
      toast.success(
        lang === "ko" ? "분석이 완료되었습니다!" :
        lang === "en" ? "Analysis complete!" :
        lang === "zh" ? "分析完成！" : "分析が完了しました！"
      );
    } catch (error: any) {
      setView("upload");
      toast.error(
        lang === "ko" ? "분석 중 오류가 발생했습니다." :
        lang === "en" ? "An error occurred during analysis." :
        lang === "zh" ? "分析过程中发生错误。" : "分析中にエラーが発生しました。",
        { description: error.message }
      );
    }
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
                {/* User Profile Badge */}
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
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{
                      background: subscription?.subscriptionTier === "premium" ? "rgba(201, 168, 76, 0.2)" :
                        subscription?.subscriptionTier === "basic" ? "rgba(100, 200, 150, 0.2)" : "rgba(255,255,255,0.06)",
                      color: subscription?.subscriptionTier === "premium" ? "#C9A84C" :
                        subscription?.subscriptionTier === "basic" ? "#6ee7b7" : "#94a3b8",
                    }}
                  >
                    {subscription?.subscriptionTier?.toUpperCase() || "FREE"}
                  </span>
                </div>

                {/* Logout */}
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
                {/* Login */}
                <button
                  onClick={handleLogin}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 hover:bg-white/5"
                  style={{ color: "#94a3b8", fontFamily: "'Noto Sans KR', sans-serif" }}
                >
                  <LogIn className="w-3.5 h-3.5" />
                  {t.login}
                </button>

                {/* Signup */}
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

            {/* Subscribe CTA → navigates to /pricing */}
            <button
              onClick={() => setLocation("/pricing")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 hover:scale-105"
              style={{
                background: "linear-gradient(135deg, #C9A84C, #A08030)",
                color: "#000",
                boxShadow: "0 2px 12px rgba(201, 168, 76, 0.25)",
                fontFamily: "'Noto Sans KR', sans-serif",
              }}
            >
              <Crown className="w-3.5 h-3.5" />
              {t.subscribe}
            </button>

            {/* Divider */}
            <div className="w-px h-5 mx-1" style={{ background: "rgba(255,255,255,0.1)" }} />

            {/* Language Selector */}
            <LanguageSelector current={lang} onChange={setLang} />
          </div>
        </div>
      </header>

      {/* ─── Main Content ─── */}
      <main className="container">
        {view === "upload" ? (
          <>
            {/* Upload Hero Section with Auth Guard */}
            <UploadHero
              t={t}
              onAnalyze={handleAnalyzeRequest}
              isAuthenticated={isAuthenticated}
              onLoginRequired={() => {
                toast.error(t.loginRequired, {
                  description: lang === "ko" ? "기보 분석은 로그인 후 이용 가능합니다." :
                    lang === "en" ? "Please log in to use the analysis feature." :
                    lang === "zh" ? "请登录后使用分析功能。" : "分析機能をご利用いただくにはログインが必要です。",
                  action: {
                    label: t.login,
                    onClick: handleLogin,
                  },
                });
              }}
            />

            {/* Profile Summary (only for authenticated users) */}
            {isAuthenticated && (
              <div className="max-w-lg mx-auto mb-12">
                <div
                  className="rounded-xl px-5 py-4 flex items-center justify-between"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center"
                      style={{ background: "rgba(201, 168, 76, 0.15)", border: "1px solid rgba(201, 168, 76, 0.3)" }}
                    >
                      <User className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <div className="text-xs text-slate-500" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                        {t.profilePlan}
                      </div>
                      <div className="text-sm font-semibold text-amber-200" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                        {subscription?.subscriptionTier === "premium" ? "Premium" :
                          subscription?.subscriptionTier === "basic" ? "Basic" : t.free}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                      {t.profileRemaining}
                    </div>
                    <div
                      className="text-lg font-bold text-amber-300"
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      {`${subscription?.remainingAnalysisCount ?? 0} / ${subscription?.maxAnalysisCount ?? 3}`}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : view === "loading" ? (
          /* ─── Loading State ─── */
          <section className="py-20 md:py-32 flex flex-col items-center justify-center">
            <div className="relative mb-8">
              {/* Animated Go stone ring */}
              <div className="w-24 h-24 rounded-full border-4 border-amber-400/30 animate-pulse" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-12 rounded-full animate-spin"
                  style={{
                    background: "conic-gradient(from 0deg, transparent 0%, #C9A84C 50%, transparent 100%)",
                  }}
                />
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full" style={{ background: "oklch(0.13 0.005 285)" }} />
              </div>
            </div>
            <h3
              className="text-xl font-bold text-amber-100 mb-2"
              style={{ fontFamily: "'Noto Serif KR', serif" }}
            >
              {t.analyzing}
            </h3>
            <p className="text-sm text-slate-400 text-center max-w-sm" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
              {lang === "ko" ? "KataGo AI가 기보를 분석하고 있습니다. 잠시만 기다려 주세요..." :
               lang === "en" ? "KataGo AI is analyzing your game. Please wait..." :
               lang === "zh" ? "KataGo AI正在分析棋谱，请稍候..." : "KataGo AIが棋譜を分析中です。しばらくお待ちください..."}
            </p>
            <div className="mt-6 flex gap-1.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full bg-amber-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </section>
        ) : (
          <>
            {/* Back to Upload button */}
            <div className="pt-6">
              <button
                onClick={() => setView("upload")}
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
            </div>

            {/* Analysis Results */}
            <div className="py-6 md:py-10">
              <GameInfoHeader report={report} t={t} lang={lang} heroImageUrl={HERO_IMAGE} />

              {/* Mistakes Section */}
              <section>
                <div className="flex items-center gap-3 mb-5">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                    <h2
                      className="text-lg font-bold text-amber-100"
                      style={{ fontFamily: "'Noto Serif KR', serif" }}
                    >
                      {t.topMistakes}
                    </h2>
                  </div>
                  <div
                    className="px-2.5 py-0.5 rounded-full text-xs font-medium"
                    style={{
                      background: "rgba(201, 168, 76, 0.15)",
                      border: "1px solid rgba(201, 168, 76, 0.3)",
                      color: "#C9A84C",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {report.top_mistakes.length}
                    {lang === "en" ? " " : ""}
                    {t.mistakeCount}
                  </div>
                </div>

                {/* Mistake Cards */}
                <div className="flex flex-col gap-5">
                  {report.top_mistakes.map((mistake, i) => (
                    <MistakeCard
                      key={`${mistake.turn}-${mistake.player}`}
                      mistake={mistake}
                      index={i}
                      t={t}
                      lang={lang}
                    />
                  ))}
                </div>
              </section>
            </div>
          </>
        )}

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
