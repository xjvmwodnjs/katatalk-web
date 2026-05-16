import type { AnalysisResultKeyMoveCandidateV1 } from "@shared/analysisResultViewModel";
import type { Language } from "@/lib/mockData";
import { isFinalPositionTurnFromRaw, mapReasonPhraseForUi, uiTextContainsForbiddenLabel } from "@shared/analysisResultUiHelpers";
import {
  getAnalysisResultUiStrings,
  normalizeAnalysisResultLang,
  translateCandidateLabelKey,
  internalReferenceSignalLabel,
} from "@shared/analysisResultI18n";

type Props = {
  raw: unknown;
  candidates: AnalysisResultKeyMoveCandidateV1[];
  selectedTurnIndex: number | null;
  onSelectTurnIndex: (turnIndex: number) => void;
  selectedVariationTurnIndex?: number | null;
  variationTurnIndexes?: Set<number>;
  onSelectVariation?: (turnIndex: number) => void;
  lang: Language;
};

export default function AnalysisCandidateList({
  raw,
  candidates,
  selectedTurnIndex,
  onSelectTurnIndex,
  selectedVariationTurnIndex = null,
  variationTurnIndexes,
  onSelectVariation,
  lang,
}: Props) {
  const uiLang = normalizeAnalysisResultLang(lang);
  const t = getAnalysisResultUiStrings(uiLang);
  const visible = candidates.filter((c) => !isFinalPositionTurnFromRaw(raw, c.turnIndex));

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 mb-6">
      <h2 className="text-lg font-bold text-amber-100 mb-4" style={{ fontFamily: "'Noto Serif KR', serif" }}>
        {t.candidatesTitle}
      </h2>
      {visible.length === 0 ? (
        <p className="text-sm text-slate-500">{t.candidatesEmpty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visible.map((c) => {
            const sel = selectedTurnIndex === c.turnIndex;
            const variationSelected = selectedVariationTurnIndex === c.turnIndex;
            const hasVariation = variationTurnIndexes?.has(c.turnIndex) ?? false;
            return (
              <article
                key={c.turnIndex}
                className={`text-left rounded-xl border p-4 transition-colors ${
                  sel ? "border-amber-400/60 bg-amber-950/30" : "border-white/10 bg-black/20"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectTurnIndex(c.turnIndex)}
                  className="block w-full text-left rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300/60"
                  aria-label={`${t.chartAriaTurn} ${c.turnIndex}`}
                >
                  <div className="text-xs font-mono text-amber-400/90 mb-1">
                    #{c.turnIndex} · {c.player}
                    {sel ? (
                      <span className="ml-2 text-[10px] text-amber-300/90 normal-case">· {t.candidateSelected}</span>
                    ) : null}
                  </div>
                </button>
                <div className="text-sm text-amber-50 mb-2 font-medium">{translateCandidateLabelKey(c.labelKey, uiLang)}</div>
                <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-slate-300">
                  <dt className="text-slate-500">{t.playedMove}</dt>
                  <dd className="font-mono">{c.playedMove}</dd>
                  <dt className="text-slate-500">{t.candidateMove}</dt>
                  <dd className="font-mono">{c.bestMove ?? "—"}</dd>
                  <dt className="text-slate-500">{t.bsi}</dt>
                  <dd>{c.bsiScore != null ? c.bsiScore.toFixed(0) : "—"}</dd>
                  <dt className="text-slate-500">{t.adi}</dt>
                  <dd>{c.adiScore != null ? c.adiScore.toFixed(2) : "—"}</dd>
                  <dt className="text-slate-500">{t.dsSelected}</dt>
                  <dd>{c.deepSearchSelected ? t.yesShort : t.noShort}</dd>
                  <dt className="text-slate-500">{t.dsCompleted}</dt>
                  <dd>{c.deepSearchCompleted ? t.yesShort : t.noShort}</dd>
                </dl>
                <div className="mt-2 flex flex-wrap gap-1">
                  {c.reasons.slice(0, 4).map((r) => {
                    let mapped = mapReasonPhraseForUi(r, uiLang);
                    if (uiTextContainsForbiddenLabel(mapped, uiLang)) {
                      mapped = internalReferenceSignalLabel(uiLang);
                    }
                    return (
                      <span
                        key={r}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-400"
                      >
                        {mapped}
                      </span>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectTurnIndex(c.turnIndex)}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:border-white/25"
                  >
                    {t.reviewMainlineButton}
                  </button>
                  <button
                    type="button"
                    disabled={!hasVariation || !onSelectVariation}
                    onClick={() => onSelectVariation?.(c.turnIndex)}
                    className={`rounded-lg border px-3 py-1.5 text-xs ${
                      variationSelected
                        ? "border-amber-400/70 bg-amber-400/10 text-amber-100"
                        : "border-white/10 text-slate-300 hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-45"
                    }`}
                    aria-label={`${t.variationShowOnBoard} ${c.turnIndex}`}
                  >
                    {!hasVariation ? t.variationNoDisplayable : variationSelected ? t.variationSelectedOnBoard : t.variationShowOnBoard}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
