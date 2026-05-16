import type { AnalysisResultVariationPreviewV1 } from "@shared/analysisResultViewModel";
import type { Language } from "@/lib/mockData";
import { getAnalysisResultUiStrings, normalizeAnalysisResultLang } from "@shared/analysisResultI18n";
import { hasDisplayableVariationPvV2, variationIdV2 } from "@shared/analysisReviewUiV2";

type Props = {
  previews: AnalysisResultVariationPreviewV1[];
  selectedVariationId: string | null;
  onSelectVariation: (row: AnalysisResultVariationPreviewV1) => void;
  onBackToMainline: () => void;
  lang: Language;
};

export default function AnalysisVariationPreview({
  previews,
  selectedVariationId,
  onSelectVariation,
  onBackToMainline,
  lang,
}: Props) {
  const uiLang = normalizeAnalysisResultLang(lang);
  const t = getAnalysisResultUiStrings(uiLang);
  const row = previews.find((p) => variationIdV2(p) === selectedVariationId) ?? null;

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
      {previews.length === 0 ? (
        <p className="text-sm text-slate-500">{t.variationEmpty}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {previews.map((p) => {
              const id = variationIdV2(p);
              const active = id === selectedVariationId;
              const displayable = hasDisplayableVariationPvV2(p);
              return (
                <button
                  key={id}
                  type="button"
                  disabled={!displayable}
                  onClick={() => {
                    if (displayable) {
                      onSelectVariation(p);
                    }
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-mono ${
                    active
                      ? "border-amber-400/70 bg-amber-400/10 text-amber-100"
                      : "border-white/10 text-slate-300 hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-45"
                  }`}
                  aria-label={`${t.variationShowOnBoard} ${p.turnIndex}`}
                >
                  #{p.turnIndex}
                </button>
              );
            })}
          </div>
          {!row ? (
            <p className="text-sm text-slate-500">{t.variationSelectHint}</p>
          ) : (
            <div className="rounded-lg bg-black/25 border border-white/10 p-4">
              <div className="text-xs text-slate-500 mb-2 font-mono">
                {t.variationTurn} #{row.turnIndex} · {t.variationPlayed} {row.playedMove} · {t.variationCandidate}{" "}
                {row.bestMove ?? "—"}
              </div>
              {row.pv.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {row.pv.map((m, i) => (
                    <span
                      key={`${row.turnIndex}-${i}-${m}`}
                      className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-sm font-mono text-amber-100"
                    >
                      {i + 1}. {m}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">{t.variationEmpty}</p>
              )}
              <button
                type="button"
                onClick={onBackToMainline}
                className="mt-4 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:border-white/25"
              >
                {t.reviewBackToMainline}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
