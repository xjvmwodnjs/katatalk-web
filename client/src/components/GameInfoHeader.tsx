// =============================================================
// GameInfoHeader: Summary of game metadata with winrate gauge
// Updated for Record<Language, string> i18n data structure
// =============================================================

import { Calendar, Hash, Trophy, Layers } from "lucide-react";
import { AnalysisReport, Translations, Language } from "@/lib/mockData";

interface GameInfoHeaderProps {
  report: AnalysisReport;
  t: Translations;
  lang: Language;
  heroImageUrl: string;
}

export default function GameInfoHeader({ report, t, lang, heroImageUrl }: GameInfoHeaderProps) {
  const { game_info } = report;
  const winrate = game_info.final_winrate_black;

  return (
    <div className="relative rounded-2xl overflow-hidden mb-8">
      {/* Hero background */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${heroImageUrl})` }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, rgba(10,10,14,0.92) 0%, rgba(10,10,14,0.75) 50%, rgba(10,10,14,0.88) 100%)",
        }}
      />

      {/* Subtle grid overlay */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `
            linear-gradient(rgba(201, 168, 76, 0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(201, 168, 76, 0.08) 1px, transparent 1px)
          `,
          backgroundSize: "32px 32px",
        }}
      />

      <div className="relative px-6 py-8 md:px-10 md:py-10">
        {/* Title */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-1 h-6 rounded-full"
              style={{ background: "linear-gradient(180deg, #C9A84C, #8B6914)" }}
            />
            <span
              className="text-xs font-medium uppercase tracking-widest text-amber-400/70"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              AI Analysis Report
            </span>
          </div>
          <h1
            className="text-2xl md:text-3xl font-bold text-amber-100"
            style={{ fontFamily: "'Noto Serif KR', serif" }}
          >
            {t.title}
          </h1>
          <p className="text-sm text-slate-400 mt-1" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
            {t.subtitle}
          </p>
        </div>

        {/* Players */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shadow-lg"
              style={{
                background: "radial-gradient(circle at 35% 30%, #555, #111 70%)",
                border: "2px solid rgba(201,168,76,0.4)",
                color: "#C9A84C",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              B
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.blackPlayer}</div>
              <div className="text-sm font-semibold text-slate-200" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                {game_info.black_player}
              </div>
            </div>
          </div>

          <div className="text-slate-600 font-bold text-lg">VS</div>

          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shadow-lg"
              style={{
                background: "radial-gradient(circle at 35% 30%, #fff, #ddd 70%)",
                border: "2px solid rgba(201,168,76,0.3)",
                color: "#333",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              W
            </div>
            <div>
              <div className="text-xs text-slate-500">{t.whitePlayer}</div>
              <div className="text-sm font-semibold text-slate-200" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                {game_info.white_player}
              </div>
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatItem icon={<Calendar className="w-3.5 h-3.5" />} label={t.date} value={game_info.date} />
          <StatItem icon={<Hash className="w-3.5 h-3.5" />} label={t.totalMoves} value={`${game_info.total_moves}${t.moves}`} />
          <StatItem icon={<Trophy className="w-3.5 h-3.5" />} label={t.result} value={game_info.result[lang]} highlight />
          <StatItem icon={<Layers className="w-3.5 h-3.5" />} label={t.finalWinrate} value={`${winrate}%`} highlight />
        </div>

        {/* Winrate bar */}
        <div className="mt-5">
          <div className="flex justify-between text-xs text-slate-500 mb-1.5">
            <span>{t.blackPlayer} {winrate}%</span>
            <span>{t.whitePlayer} {(100 - winrate).toFixed(1)}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{
                width: `${winrate}%`,
                background: "linear-gradient(90deg, #555 0%, #888 40%, #C9A84C 100%)",
              }}
            />
          </div>
        </div>

        {/* Engine tag */}
        <div className="mt-4 flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#4ade80" }} />
          <span className="text-xs text-slate-500" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            {t.analysisBy}
          </span>
        </div>
      </div>
    </div>
  );
}

function StatItem({
  icon,
  label,
  value,
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="rounded-lg px-3 py-2.5"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-center gap-1.5 text-slate-500 mb-1">
        {icon}
        <span className="text-[10px] uppercase tracking-wider" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          {label}
        </span>
      </div>
      <div
        className="text-sm font-semibold"
        style={{
          color: highlight ? "#C9A84C" : "#e2e8f0",
          fontFamily: "'Noto Sans KR', sans-serif",
        }}
      >
        {value}
      </div>
    </div>
  );
}
