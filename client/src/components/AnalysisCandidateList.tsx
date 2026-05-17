import type { AnalysisResultKeyMoveCandidateV1 } from "@shared/analysisResultViewModel";
import type { Language } from "@/lib/mockData";
import { isFinalPositionTurnFromRaw } from "@shared/analysisResultUiHelpers";
import {
  getAnalysisResultUiStrings,
  normalizeAnalysisResultLang,
  translateCandidateLabelKey,
  translateLearningEventChipPrefix,
} from "@shared/analysisResultI18n";
import { compactCandidateLimitV3 } from "@shared/analysisReviewUiV2";

type Props = {
  raw: unknown;
  candidates: AnalysisResultKeyMoveCandidateV1[];
  selectedTurnIndex: number | null;
  onSelectTurnIndex: (turnIndex: number) => void;
  selectedCandidateTurnIndex?: number | null;
  onSelectCandidate?: (turnIndex: number) => void;
  variationTurnIndexes?: Set<number>;
  lang: Language;
};

export default function AnalysisCandidateList({
  raw,
  candidates,
  selectedTurnIndex,
  onSelectTurnIndex,
  selectedCandidateTurnIndex = null,
  onSelectCandidate,
  variationTurnIndexes,
  lang,
}: Props) {
  const uiLang = normalizeAnalysisResultLang(lang);
  const t = getAnalysisResultUiStrings(uiLang);
  const visible = candidates.filter((c) => !isFinalPositionTurnFromRaw(raw, c.turnIndex));

  return (
    <section className="mb-3 min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:mb-6 sm:p-6">
      <h2 className="mb-2 text-base font-bold text-amber-100 sm:mb-4 sm:text-lg" style={{ fontFamily: "'Noto Serif KR', serif" }}>
        {t.candidatesTitle}
      </h2>
      {visible.length === 0 ? (
        <p className="text-sm text-slate-500">{t.candidatesEmpty}</p>
      ) : (
        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
          {visible.slice(0, compactCandidateLimitV3()).map((c) => {
            const sel = selectedTurnIndex === c.turnIndex;
            const candidateSelected = selectedCandidateTurnIndex === c.turnIndex;
            const hasVariation = variationTurnIndexes?.has(c.turnIndex) ?? false;
            const chipPrefix = c.productRole === "decisive"
              ? t.productPrefixDecisive
              : c.productRole === "review"
                ? t.productPrefixReview
                : c.learningEvent
                  ? translateLearningEventChipPrefix(c.learningEvent.eventType, uiLang)
                  : null;
            const chipMove = c.learningEvent?.candidateMove ?? c.playedMove;
            return (
              <button
                key={c.turnIndex}
                type="button"
                onClick={() => {
                  onSelectTurnIndex(c.turnIndex);
                  onSelectCandidate?.(c.turnIndex);
                }}
                className={`w-[136px] shrink-0 rounded-xl border px-3 py-2 text-left transition-colors sm:w-[148px] ${
                  candidateSelected
                    ? "border-amber-400/70 bg-amber-950/30"
                    : sel
                      ? "border-amber-400/40 bg-black/25"
                      : "border-white/10 bg-black/20 hover:border-white/20"
                }`}
                aria-label={`${t.chartAriaTurn} ${c.turnIndex}`}
              >
                <div className="truncate text-[11px] font-mono text-amber-400/90">
                  {chipPrefix ? `${chipPrefix} #${c.turnIndex} · ${chipMove ?? "—"}` : `#${c.turnIndex} · ${c.playedMove}`}
                </div>
                <div className="mt-1 truncate text-sm font-medium text-amber-50">{translateCandidateLabelKey(c.labelKey, uiLang)}</div>
                <div className="mt-1 truncate text-[10px] text-slate-400">
                  {hasVariation ? t.candidateChipReferenceAvailable : t.candidateChipMemo}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
