// =============================================================
// Supabase 로그인/회원가입 (Google OAuth + 이메일·비밀번호)
// 비밀번호 저장·검증은 전부 Supabase Auth에 위임
// =============================================================

import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { mapAuthErrorToKorean } from "@/lib/authErrorMessages";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MIN_PASSWORD_LEN = 8;

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  useEffect(() => {
    if (authLoading) return;
    if (isAuthenticated) {
      setLocation("/");
    }
  }, [authLoading, isAuthenticated, setLocation]);

  useEffect(() => {
    if (import.meta.env.VITE_AUTH_PROVIDER !== "supabase") {
      toast.error("Supabase 인증이 비활성화되어 있습니다. VITE_AUTH_PROVIDER=supabase 로 설정하세요.");
    }
    if (!supabase) {
      toast.error("Supabase 환경변수(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)가 없습니다.");
    }
  }, []);

  const validatePasswordClient = () => {
    if (password.length < MIN_PASSWORD_LEN) {
      toast.error(`비밀번호는 ${MIN_PASSWORD_LEN}자 이상이어야 합니다.`);
      return false;
    }
    return true;
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    if (!validatePasswordClient()) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        toast.error(mapAuthErrorToKorean(error));
        return;
      }
      toast.success("로그인되었습니다.");
      setLocation("/");
    } catch (err) {
      toast.error(mapAuthErrorToKorean(err instanceof Error ? err : null));
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    if (!validatePasswordClient()) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
        },
      });
      if (error) {
        toast.error(mapAuthErrorToKorean(error));
        return;
      }
      toast.success("회원가입 요청이 완료되었습니다. 이메일 인증이 필요한 경우 메일함을 확인해 주세요.");
      setMode("signin");
    } catch (err) {
      toast.error(mapAuthErrorToKorean(err instanceof Error ? err : null));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    if (!supabase) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/`,
        },
      });
      if (error) {
        toast.error(mapAuthErrorToKorean(error));
      }
    } catch (err) {
      toast.error(mapAuthErrorToKorean(err instanceof Error ? err : null));
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    if (!supabase) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        toast.error(mapAuthErrorToKorean(error));
        return;
      }
      toast.success("로그아웃되었습니다.");
    } finally {
      setBusy(false);
    }
  };

  if (import.meta.env.VITE_AUTH_PROVIDER !== "supabase") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "oklch(0.13 0.005 285)" }}>
        <p className="text-slate-400 text-center text-sm" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
          Supabase 인증을 사용하려면 VITE_AUTH_PROVIDER=supabase 와 Supabase 환경변수를 설정하세요.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: "oklch(0.13 0.005 285)" }}>
      <div
        className="w-full max-w-md rounded-2xl p-8 border"
        style={{
          background: "rgba(255,255,255,0.03)",
          borderColor: "rgba(255,255,255,0.08)",
        }}
      >
        <h1
          className="text-2xl font-bold text-amber-100 mb-1 text-center"
          style={{ fontFamily: "'Noto Serif KR', serif" }}
        >
          KataTalk 로그인
        </h1>
        <p className="text-xs text-slate-500 text-center mb-8" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
          Google 또는 이메일로 로그인합니다. 비밀번호는 Supabase에서만 처리됩니다.
        </p>

        <Button
          type="button"
          variant="outline"
          className="w-full mb-6 h-11 border-slate-600 text-slate-100 hover:bg-white/5 inline-flex items-center justify-center gap-2"
          disabled={busy || !supabase}
          onClick={handleGoogle}
          style={{ fontFamily: "'Noto Sans KR', sans-serif" }}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden /> : null}
          <span>Google로 로그인</span>
        </Button>

        <div className="flex gap-2 mb-6">
          <Button
            type="button"
            variant={mode === "signin" ? "default" : "ghost"}
            className="flex-1"
            onClick={() => setMode("signin")}
            disabled={busy}
          >
            로그인
          </Button>
          <Button
            type="button"
            variant={mode === "signup" ? "default" : "ghost"}
            className="flex-1"
            onClick={() => setMode("signup")}
            disabled={busy}
          >
            회원가입
          </Button>
        </div>

        <form onSubmit={mode === "signin" ? handleEmailSignIn : handleEmailSignUp} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-slate-300">
              이메일
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="bg-black/20 border-slate-600 text-slate-100"
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-slate-300">
              비밀번호 ({MIN_PASSWORD_LEN}자 이상)
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD_LEN}
              className="bg-black/20 border-slate-600 text-slate-100"
            />
          </div>
          <Button
            type="submit"
            className="w-full h-11 font-semibold inline-flex items-center justify-center gap-2"
            disabled={busy || !supabase}
            style={{
              background: "linear-gradient(135deg, #C9A84C, #A08030)",
              color: "#000",
              fontFamily: "'Noto Sans KR', sans-serif",
            }}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden /> : null}
            <span>
              {busy ? "처리 중…" : mode === "signin" ? "이메일로 로그인" : "이메일로 회원가입"}
            </span>
          </Button>
        </form>

        <div className="mt-6 flex flex-col gap-3 text-center text-sm">
          <Link href="/">
            <span className="text-slate-500 hover:text-amber-200/80 cursor-pointer" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
              ← 홈으로
            </span>
          </Link>
          {supabase ? (
            <button
              type="button"
              className="text-slate-600 hover:text-slate-400 text-xs"
              onClick={handleLogout}
              disabled={busy}
            >
              로그아웃 (세션 초기화)
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
