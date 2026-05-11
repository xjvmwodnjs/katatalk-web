// =============================================================
// MistakeCard: Individual mistake analysis card with expandable PV viewer
// Updated for Record<Language, string> i18n data structure
// =============================================================

import { useState } from "react";
import { ChevronDown, ChevronUp, AlertTriangle, TrendingDown, MapPin } from "lucide-react";
import { Mistake, Translations, Language, getSeverity } from "@/lib/mockData";
import BadukBoard from "./BadukBoard";

interface MistakeCardProps {
  mistake: Mistake;
  index: number;
  t: Translations;
  lang: Language;
}

const SEVERITY_STYLES = {
  critical: {
    border: "border-red-500/40",
    headerBg: "from-red-950/60 to-transparent",
    badge: "bg-red-500/20 text-red-300 border-red-500/30",
    dot: "bg-red-500",
    barColor: "#E05252",
    glow: "shadow-red-900/30",
  },
  major: {
    border: "border-amber-500/40",
    headerBg: "from-amber-950/60 to-transparent",
    badge: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    dot: "bg-amber-500",
    barColor: "#C9A84C",
    glow: "shadow-amber-900/30",
  },
  moderate: {
    border: "border-blue-500/30",
    headerBg: "from-blue-950/40 to-transparent",
    badge: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    dot: "bg-blue-400",
    barColor: "#60A5FA",
    glow: "shadow-blue-900/20",
  },
};

export default function MistakeCard({ mistake, index, t, lang }: MistakeCardProps) {
  const [pvOpen, setPvOpen] = useState(false);
  const severity = getSeverity(mistake.winrate_drop_percent);
  const styles = SEVERITY_STYLES[severity];
  const playerLabel = mistake.player === "B" ? t.black : t.white;
  const severityLabel = t.severity[severity];
  const zone = mistake.zone[lang];
  const explanation = mistake.llm_explanation[lang];

  const barWidth = Math.min((mistake.winrate_drop_percent / 30) * 100, 100);

  return (
    <div
      className={`rounded-xl border ${styles.border} overflow-hidden card-enter shadow-xl ${styles.glow}`}
      style={{
        animationDelay: `${index * 150}ms`,
        background: "rgba(22, 22, 28, 0.85)",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Card Header */}
      <div className={`bg-gradient-to-r ${styles.headerBg} px-5 py-4`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {/* Move number badge */}
            <div
              className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm"
              style={{
                background: "rgba(201, 168, 76, 0.15)",
                border: "1px solid rgba(201, 168, 76, 0.3)",
                color: "#C9A84C",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {mistake.turn}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span
                  className="text-base font-bold text-amber-100"
                  style={{ fontFamily: "'Noto Serif KR', serif" }}
                >
                  {mistake.turn}{t.turn} ({playerLabel}) — {zone}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${styles.badge}`}
                >
                  <AlertTriangle className="w-3 h-3" />
                  {severityLabel}
                </span>
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <MapPin className="w-3 h-3" />
                  {zone}
                </span>
              </div>
            </div>
          </div>

          {/* Winrate drop */}
          <div className="flex-shrink-0 text-right">
            <div
              className="text-2xl font-bold"
              style={{
                color: styles.barColor,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              -{mistake.winrate_drop_percent}%
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-1 justify-end">
              <TrendingDown className="w-3 h-3" />
              {t.winrateDrop}
            </div>
          </div>
        </div>

        {/* Winrate drop bar */}
        <div className="mt-3">
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            <div
              className="h-full rounded-full bar-fill"
              style={{
                width: `${barWidth}%`,
                background: `linear-gradient(90deg, ${styles.barColor}88, ${styles.barColor})`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Card Body - AI Commentary */}
      <div className="px-5 py-4">
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} />
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            {t.aiExplanation}
          </span>
        </div>
        <p
          className="text-sm leading-relaxed text-slate-300"
          style={{ fontFamily: "'Noto Sans KR', sans-serif", lineHeight: "1.8" }}
        >
          {explanation}
        </p>
      </div>

      {/* PV Toggle Button */}
      <div className="px-5 pb-4">
        <button
          onClick={() => setPvOpen(!pvOpen)}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all duration-200"
          style={{
            background: pvOpen
              ? "rgba(201, 168, 76, 0.15)"
              : "rgba(255,255,255,0.04)",
            border: pvOpen
              ? "1px solid rgba(201, 168, 76, 0.4)"
              : "1px solid rgba(255,255,255,0.08)",
            color: pvOpen ? "#C9A84C" : "#94a3b8",
          }}
        >
          {pvOpen ? (
            <>
              <ChevronUp className="w-4 h-4" />
              {t.hidePV}
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4" />
              {t.viewPV}
            </>
          )}
        </button>
      </div>

      {/* PV Viewer - Expandable */}
      <div
        className="overflow-hidden transition-all duration-300 ease-out"
        style={{ maxHeight: pvOpen ? "600px" : "0px" }}
      >
        <div
          className="px-5 pb-6 border-t"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <div className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full" style={{ background: "#C9A84C" }} />
              <h4
                className="text-sm font-semibold text-amber-300"
                style={{ fontFamily: "'Noto Serif KR', serif" }}
              >
                {t.pvTitle}
              </h4>
            </div>
            <p className="text-xs text-slate-500 mb-4" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
              {t.pvDescription}
            </p>

            {pvOpen && (
              <div className="flex justify-center">
                <BadukBoard pv={mistake.pv} player={mistake.player} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
