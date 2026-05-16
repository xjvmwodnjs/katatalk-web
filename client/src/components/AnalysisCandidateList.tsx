import type { AnalysisResultKeyMoveCandidateV1 } from "@shared/analysisResultViewModel";
import type { Language } from "@/lib/mockData";
import { isFinalPositionTurnFromRaw } from "@shared/analysisResultUiHelpers";
import {
  getAnalysisResultUiStrings,
  normalizeAnalysisResultLang,
  translateCandidateLabelKey,
} from "@shared/analysisResultI18n";

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
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 mb-6">
      <h2 className="text-lg font-bold text-amber-100 mb-4" style={{ fontFamily: "'Noto Serif KR', serif" }}>
        {t.candidatesTitle}
      </h2>
      {visible.length === 0 ? (
        <p className="text-sm text-slate-500">{t.candidatesEmpty}</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {visible.slice(0, 5).map((c) => {
            const sel = selectedTurnIndex === c.turnIndex;
            const candidateSelected = selectedCandidateTurnIndex === c.turnIndex;
            const hasVariation = variationTurnIndexes?.has(c.turnIndex) ?? false;
            return (
              <button
                key={c.turnIndex}
                type="button"
                onClick={() => {
                  onSelectTurnIndex(c.turnIndex);
                  onSelectCandidate?.(c.turnIndex);
                }}
                className={`min-w-[148px] rounded-xl border px-3 py-2 text-left transition-colors ${
                  candidateSelected
                    ? "border-amber-400/70 bg-amber-950/30"
                    : sel
                      ? "border-amber-400/40 bg-black/25"
                      : "border-white/10 bg-black/20 hover:border-white/20"
                }`}
                aria-label={`${t.chartAriaTurn} ${c.turnIndex}`}
              >
                <div className="text-[11px] font-mono text-amber-400/90">#{c.turnIndex} · {c.playedMove}</div>
                <div className="mt-1 text-sm font-medium text-amber-50">{translateCandidateLabelKey(c.labelKey, uiLang)}</div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
                  <span>BSI {c.bsiScore != null ? c.bsiScore.toFixed(0) : "—"}</span>
                  <span>ADI {c.adiScore != null ? c.adiScore.toFixed(2) : "—"}</span>
                  <span>{hasVariation ? t.variationShowOnBoard : t.variationNoDisplayable}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
