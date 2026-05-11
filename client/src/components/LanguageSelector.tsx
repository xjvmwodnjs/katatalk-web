// =============================================================
// Design Philosophy: "바둑판 위의 데이터 연구소"
// LanguageSelector: Dropdown for KO / EN / ZH / JA switching
// =============================================================

import { useState, useRef, useEffect } from "react";
import { Globe, ChevronDown, Check } from "lucide-react";
import { Language } from "@/lib/mockData";

interface LanguageSelectorProps {
  current: Language;
  onChange: (lang: Language) => void;
  /** 로그인 등 밝은 헤더에서 대비 확보 */
  tone?: "dark" | "light";
}

const LANGUAGES: { code: Language; label: string; native: string }[] = [
  { code: "ko", label: "Korean", native: "한국어" },
  { code: "en", label: "English", native: "English" },
  { code: "zh", label: "Chinese", native: "中文" },
  { code: "ja", label: "Japanese", native: "日本語" },
];

export default function LanguageSelector({
  current,
  onChange,
  tone = "dark",
}: LanguageSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentLang = LANGUAGES.find((l) => l.code === current)!;
  const isLight = tone === "light";

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 focus-visible:ring-offset-2"
        style={
          isLight
            ? {
                background: open ? "rgba(201, 168, 76, 0.2)" : "rgba(28, 25, 23, 0.06)",
                border: open ? "1px solid rgba(160, 128, 48, 0.55)" : "1px solid rgba(28, 25, 23, 0.12)",
                color: open ? "#7c5e12" : "#44403c",
              }
            : {
                background: open ? "rgba(201, 168, 76, 0.15)" : "rgba(255,255,255,0.06)",
                border: open ? "1px solid rgba(201, 168, 76, 0.4)" : "1px solid rgba(255,255,255,0.1)",
                color: open ? "#C9A84C" : "#94a3b8",
              }
        }
      >
        <Globe className="w-4 h-4" />
        <span style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
          {currentLang.native}
        </span>
        <ChevronDown
          className="w-3.5 h-3.5 transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-40 rounded-xl overflow-hidden z-50 shadow-2xl"
          style={
            isLight
              ? {
                  background: "#ffffff",
                  border: "1px solid rgba(28, 25, 23, 0.12)",
                  boxShadow: "0 16px 40px rgba(0,0,0,0.12)",
                }
              : {
                  background: "rgba(20, 20, 26, 0.95)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  backdropFilter: "blur(16px)",
                }
          }
        >
          {LANGUAGES.map((lang) => (
            <button
              type="button"
              key={lang.code}
              onClick={() => {
                onChange(lang.code);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors duration-150"
              style={
                isLight
                  ? {
                      color: lang.code === current ? "#7c5e12" : "#57534e",
                      background:
                        lang.code === current ? "rgba(201, 168, 76, 0.12)" : "transparent",
                      fontFamily: "'Noto Sans KR', sans-serif",
                    }
                  : {
                      color: lang.code === current ? "#C9A84C" : "#94a3b8",
                      background:
                        lang.code === current ? "rgba(201, 168, 76, 0.1)" : "transparent",
                      fontFamily: "'Noto Sans KR', sans-serif",
                    }
              }
              onMouseEnter={(e) => {
                if (lang.code !== current) {
                  (e.currentTarget as HTMLElement).style.background = isLight
                    ? "rgba(28, 25, 23, 0.06)"
                    : "rgba(255,255,255,0.05)";
                  (e.currentTarget as HTMLElement).style.color = isLight ? "#1c1917" : "#e2e8f0";
                }
              }}
              onMouseLeave={(e) => {
                if (lang.code !== current) {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = isLight ? "#57534e" : "#94a3b8";
                }
              }}
            >
              <span>{lang.native}</span>
              {lang.code === current && <Check className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
