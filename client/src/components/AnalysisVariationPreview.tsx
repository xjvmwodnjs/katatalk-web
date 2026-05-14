import type { AnalysisResultVariationPreviewV1 } from "@shared/analysisResultViewModel";
import type { Language } from "@/lib/mockData";
import { getAnalysisResultUiStrings, normalizeAnalysisResultLang } from "@shared/analysisResultI18n";

type Props = {
  previews: AnalysisResultVariationPreviewV1[];
  selectedTurnIndex: number | null;
  lang: Language;
};

export default function AnalysisVariationPreview({ previews, selectedTurnIndex, lang }: Props) {
  const uiLang = normalizeAnalysisResultLang(lang);
  const t = getAnalysisResultUiStrings(uiLang);
  const row = previews.find((p) => p.turnIndex === selectedTurnIndex) ?? null;

  const sub =
    row?.source === "deep-search"
      ? t.variationSubDeep
      : row?.source === "multi-turn"
        ? t.variationSubMulti
        : "";

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 mb-6">
      <h2 className="text-lg font-bold text-amber-100 mb-1" style={{ fontFamily: "'Noto Serif KR', serif" }}>
        {t.variationTitle}
      </h2>
      {sub ? <p className="text-xs text-slate-400 mb-2 font-mono">{sub}</p> : <p className="text-xs text-slate-500 mb-2">—</p>}
      <p className="text-xs text-slate-600 mb-4">{t.variationPvDisclaimer}</p>
      {!row || row.pv.length === 0 ? (
        <p className="text-sm text-slate-500">{t.variationEmpty}</p>
      ) : (
        <div className="rounded-lg bg-black/25 border border-white/10 p-4">
          <div className="text-xs text-slate-500 mb-2 font-mono">
            {t.variationTurn} #{row.turnIndex} · {t.variationPlayed} {row.playedMove} · {t.variationCandidate}{" "}
            {row.bestMove ?? "—"}
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
