import { useMemo } from "react";
import type { AnalysisResultWinratePointV1 } from "@shared/analysisResultViewModel";
import type { Language } from "@/lib/mockData";

const LABELS: Record<
  Language,
  { yAxis: string; empty: string; toggle: string; perspectiveNote: string }
> = {
  ko: {
    yAxis: "KataGo 기준 승률 (%)",
    empty: "표시할 승률 추이가 없습니다.",
    toggle: "흑/백 관점 전환 — 준비 중",
    perspectiveNote: "KataGo 출력 관점이며 흑/백 고정 해석이 아닙니다.",
  },
  en: {
    yAxis: "KataGo winrate (%)",
    empty: "No winrate series to display.",
    toggle: "Black/white perspective — coming soon",
    perspectiveNote: "Shown as KataGo output; not fixed as black or white winrate.",
  },
  zh: {
    yAxis: "KataGo 胜率 (%)",
    empty: "没有可显示的胜率序列。",
    toggle: "黑/白视角 — 准备中",
    perspectiveNote: "为 KataGo 输出视角，不作黑白固定解读。",
  },
  ja: {
    yAxis: "KataGo 勝率 (%)",
    empty: "表示できる勝率系列がありません。",
    toggle: "黒白視点の切替 — 準備中",
    perspectiveNote: "KataGo 出力の視点であり、黒白固定の解釈ではありません。",
  },
};

type Props = {
  series: AnalysisResultWinratePointV1[];
  selectedTurnIndex: number | null;
  onSelectTurnIndex: (turnIndex: number) => void;
  lang: Language;
};

function clampWinratePct(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(100, Math.max(0, n));
}

export default function AnalysisWinratePanel({ series, selectedTurnIndex, onSelectTurnIndex, lang }: Props) {
  const L = LABELS[lang];
  const pts = useMemo(() => series.filter((p) => p.displayWinrate != null), [series]);

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
    const ys = pts.map((p) => padT + (1 - clampWinratePct(p.displayWinrate ?? 0) / 100) * ih);
    const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join(" ");
    const circ = pts.map((p, i) => ({ cx: xs[i]!, cy: ys[i]!, ti: p.turnIndex }));
    return { polyline: d, circles: circ };
  }, [pts]);

  if (pts.length === 0) {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h2 className="text-lg font-bold text-amber-100" style={{ fontFamily: "'Noto Serif KR', serif" }}>
            {lang === "ko" ? "승률 / 흐름" : lang === "en" ? "Winrate / flow" : lang === "zh" ? "胜率 / 走势" : "勝率 / 推移"}
          </h2>
          <button
            type="button"
            disabled
            className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-slate-500 cursor-not-allowed opacity-70"
          >
            {L.toggle}
          </button>
        </div>
        <p className="text-sm text-slate-500">{L.empty}</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
        <h2 className="text-lg font-bold text-amber-100" style={{ fontFamily: "'Noto Serif KR', serif" }}>
          {lang === "ko" ? "승률 / 흐름" : lang === "en" ? "Winrate / flow" : lang === "zh" ? "胜率 / 走势" : "勝率 / 推移"}
        </h2>
        <button
          type="button"
          disabled
          className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-slate-500 cursor-not-allowed opacity-70"
        >
          {L.toggle}
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-3">{L.perspectiveNote}</p>
      <div className="overflow-x-auto">
        <svg viewBox="0 0 560 200" className="w-full max-w-3xl h-48 select-none" role="img" aria-label={L.yAxis}>
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
            {L.yAxis}
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
                aria-label={`turn ${c.ti}`}
              />
            );
          })}
        </svg>
      </div>
    </section>
  );
}
