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
}

const LANGUAGES: { code: Language; label: string; native: string }[] = [
  { code: "ko", label: "Korean", native: "한국어" },
  { code: "en", label: "English", native: "English" },
  { code: "zh", label: "Chinese", native: "中文" },
  { code: "ja", label: "Japanese", native: "日本語" },
];

export default function LanguageSelector({ current, onChange }: LanguageSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentLang = LANGUAGES.find((l) => l.code === current)!;

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
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200"
        style={{
          background: open ? "rgba(201, 168, 76, 0.15)" : "rgba(255,255,255,0.06)",
          border: open ? "1px solid rgba(201, 168, 76, 0.4)" : "1px solid rgba(255,255,255,0.1)",
          color: open ? "#C9A84C" : "#94a3b8",
        }}
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
          style={{
            background: "rgba(20, 20, 26, 0.95)",
            border: "1px solid rgba(255,255,255,0.1)",
            backdropFilter: "blur(16px)",
          }}
        >
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => {
                onChange(lang.code);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors duration-150"
              style={{
                color: lang.code === current ? "#C9A84C" : "#94a3b8",
                background:
                  lang.code === current
                    ? "rgba(201, 168, 76, 0.1)"
                    : "transparent",
                fontFamily: "'Noto Sans KR', sans-serif",
              }}
              onMouseEnter={(e) => {
                if (lang.code !== current) {
                  (e.currentTarget as HTMLElement).style.background =
                    "rgba(255,255,255,0.05)";
                  (e.currentTarget as HTMLElement).style.color = "#e2e8f0";
                }
              }}
              onMouseLeave={(e) => {
                if (lang.code !== current) {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "#94a3b8";
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
