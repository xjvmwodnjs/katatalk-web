import type { AnalysisResultVariationPreviewV1 } from "@shared/analysisResultViewModel";
import type { Language } from "@/lib/mockData";

type Props = {
  previews: AnalysisResultVariationPreviewV1[];
  selectedTurnIndex: number | null;
  lang: Language;
};

export default function AnalysisVariationPreview({ previews, selectedTurnIndex, lang }: Props) {
  const row = previews.find((p) => p.turnIndex === selectedTurnIndex) ?? null;

  const titleBase =
    lang === "ko" ? "KataGo 참고도" : lang === "en" ? "KataGo reference line" : lang === "zh" ? "KataGo 参考图" : "KataGo 参考";

  const sub =
    row?.source === "deep-search"
      ? lang === "ko"
        ? "Deep Search 참고도"
        : lang === "en"
          ? "Deep Search reference"
          : lang === "zh"
            ? "Deep Search 参考"
            : "Deep Search 参照"
      : row?.source === "multi-turn"
        ? lang === "ko"
          ? "Multi-turn 참고도"
          : lang === "en"
            ? "Multi-turn reference"
            : lang === "zh"
              ? "Multi-turn 参考"
              : "Multi-turn 参照"
        : "";

  const empty =
    lang === "ko"
      ? "표시할 참고도 없음"
      : lang === "en"
        ? "No reference line to show"
        : lang === "zh"
          ? "无参考变化可显示"
          : "表示する参考がありません";

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 mb-6">
      <h2 className="text-lg font-bold text-amber-100 mb-1" style={{ fontFamily: "'Noto Serif KR', serif" }}>
        {titleBase}
      </h2>
      {sub ? <p className="text-xs text-slate-400 mb-4 font-mono">{sub}</p> : <p className="text-xs text-slate-500 mb-4">—</p>}
      {!row || row.pv.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="rounded-lg bg-black/25 border border-white/10 p-4">
          <div className="text-xs text-slate-500 mb-2 font-mono">
            {lang === "ko" ? "수순" : "Turn"} #{row.turnIndex} · {lang === "ko" ? "실전수" : "Played"} {row.playedMove}{" "}
            · {lang === "ko" ? "후보" : "Candidate"} {row.bestMove ?? "—"}
          </div>
          <div className="flex flex-wrap gap-2">
            {row.pv.map((m, i) => (
              <span
                key={`${row.turnIndex}-${i}-${m}`}
                className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-sm font-mono text-amber-100"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
