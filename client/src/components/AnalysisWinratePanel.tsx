import { useMemo } from "react";
import type { AnalysisResultWinratePointV1 } from "@shared/analysisResultViewModel";
import type { Language } from "@/lib/mockData";
import {
  getAnalysisResultUiStrings,
  normalizeAnalysisResultLang,
  translateWinrateDisplayLabelKey,
} from "@shared/analysisResultI18n";
import type { WinrateDisplayLabelKeyV1 } from "@shared/winratePerspectiveV1";

type Props = {
  series: AnalysisResultWinratePointV1[];
  selectedTurnIndex: number | null;
  onSelectTurnIndex: (turnIndex: number) => void;
  lang: Language;
  /** Full mainline timeline chart (vs sparse candidate turns) */
  fullTimeline?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
};

function clampWinratePct(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(100, Math.max(0, n));
}

export default function AnalysisWinratePanel({
  series,
  selectedTurnIndex,
  onSelectTurnIndex,
  lang,
  fullTimeline = false,
  collapsed = false,
  onToggleCollapsed,
}: Props) {
  const uiLang = normalizeAnalysisResultLang(lang);
  const t = getAnalysisResultUiStrings(uiLang);
  const pts = useMemo(
    () => series.filter((p) => p.perspective.normalized.displayWinrate != null),
    [series]
  );

  const winrateYAxisLabel = useMemo(() => {
    const key: WinrateDisplayLabelKeyV1 =
      pts[0]?.perspective.normalized.displayLabelKey ?? "katagoOutputWinrate";
    return translateWinrateDisplayLabelKey(key, uiLang);
  }, [pts, uiLang]);

  const { polyline, circles } = useMemo(() => {
    const w = 560;
    const h = 200;
    const padL = 44;
    const padR = 16;
    const padT = 12;
    const padB = 28;
    const iw = w - padL - padR;
    const ih = h - padT - padB;
    if (pts.length === 0) {
      return { polyline: "", circles: [] as { cx: number; cy: number; ti: number }[] };
    }
    const xs = pts.map((_, i) => padL + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw));
    const ys = pts.map(
      (p) => padT + (1 - clampWinratePct(p.perspective.normalized.displayWinrate ?? 0) / 100) * ih
    );
    const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join(" ");
    const circ = pts.map((p, i) => ({ cx: xs[i]!, cy: ys[i]!, ti: p.turnIndex }));
    return { polyline: d, circles: circ };
  }, [pts]);

  if (pts.length === 0) {
    return (
      <section className="mb-3 min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:mb-6 sm:p-6">
        <div className="mb-3 flex flex-col gap-2 sm:mb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <h2 className="text-base font-bold text-amber-100 sm:text-lg" style={{ fontFamily: "'Noto Serif KR', serif" }}>
            {t.winrateTitle}
          </h2>
          <div className="flex min-w-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:border-white/25"
            >
              {collapsed ? t.winrateExpand : t.winrateCollapse}
            </button>
            <button
              type="button"
              disabled
              className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-slate-500 cursor-not-allowed opacity-70"
            >
              {t.winrateToggleNote}
            </button>
          </div>
        </div>
        {!collapsed ? <p className="text-sm text-slate-500">{t.winrateEmpty}</p> : null}
      </section>
    );
  }

  return (
    <section className="mb-3 min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:mb-6 sm:p-6">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <h2 className="text-base font-bold text-amber-100 sm:text-lg" style={{ fontFamily: "'Noto Serif KR', serif" }}>
          {t.winrateTitle}
        </h2>
        <div className="flex min-w-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:border-white/25"
          >
            {collapsed ? t.winrateExpand : t.winrateCollapse}
          </button>
          <button
            type="button"
            disabled
            className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-slate-500 cursor-not-allowed opacity-70"
          >
            {t.winrateToggleNote}
          </button>
        </div>
      </div>
      {!collapsed ? (
        <>
          <p className="text-xs text-slate-500 mb-1">{t.winratePerspectiveNote}</p>
          {fullTimeline ? (
            <p className="text-xs text-slate-500 mb-1">{t.winrateFullTimelineNote}</p>
          ) : null}
          <p className="text-xs text-slate-600 mb-3">{t.winrateClickHint}</p>
          <div className="min-w-0 overflow-hidden">
        <svg viewBox="0 0 560 200" className="h-36 w-full max-w-full select-none sm:h-48" role="img" aria-label={winrateYAxisLabel}>
          <rect x="0" y="0" width="560" height="200" fill="rgba(0,0,0,0.2)" rx="8" />
          {[0, 25, 50, 75, 100].map((pct) => {
            const y = 12 + (1 - pct / 100) * 160;
            return (
              <g key={pct}>
                <line x1="44" y1={y} x2="544" y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                <text x="4" y={y + 4} fill="#64748b" fontSize="10" fontFamily="JetBrains Mono, monospace">
                  {pct}
                </text>
              </g>
            );
          })}
          <text x="44" y="196" fill="#94a3b8" fontSize="11" fontFamily="Noto Sans KR, sans-serif">
            {winrateYAxisLabel}
          </text>
          {polyline ? (
            <path d={polyline} fill="none" stroke="#C9A84C" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ) : null}
          {circles.map((c) => {
            const sel = selectedTurnIndex === c.ti;
            return (
              <circle
                key={c.ti}
                cx={c.cx}
                cy={c.cy}
                r={sel ? 7 : 5}
                fill={sel ? "#E8D48B" : "#334155"}
                stroke={sel ? "#fff" : "#94a3b8"}
                strokeWidth={sel ? 2 : 1}
                className="cursor-pointer hover:opacity-90"
                onClick={() => onSelectTurnIndex(c.ti)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectTurnIndex(c.ti);
                  }
                }}
                aria-label={`${t.chartAriaTurn} ${c.ti}`}
              />
            );
          })}
        </svg>
          </div>
        </>
      ) : null}
    </section>
  );
}
