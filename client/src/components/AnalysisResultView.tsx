import { useEffect, useMemo, useState } from "react";
import { buildAnalysisResultViewModel } from "@/lib/analysisResultViewModel";
import type { Language } from "@/lib/mockData";
import AnalysisWinratePanel from "@/components/AnalysisWinratePanel";
import AnalysisCandidateList from "@/components/AnalysisCandidateList";
import AnalysisVariationPreview from "@/components/AnalysisVariationPreview";
import {
  getAnalysisResultUiStrings,
  normalizeAnalysisResultLang,
  translatePlaceholderMessageKey,
  translateSgfPlaybackWarning,
  translateVmWarning,
} from "@shared/analysisResultI18n";

type Props = {
  data: unknown;
  lang: Language;
};

export default function AnalysisResultView({ data, lang }: Props) {
  const [selectedTurnIndex, setSelectedTurnIndex] = useState<number | null>(null);
  const uiLang = normalizeAnalysisResultLang(lang);
  const t = getAnalysisResultUiStrings(uiLang);

  useEffect(() => {
    const v = buildAnalysisResultViewModel(data);
    if (v.kind === "katago-worker-v1") {
      const first = v.keyMoveCandidates[0]?.turnIndex ?? v.graph.winrateSeries[0]?.turnIndex ?? null;
      setSelectedTurnIndex(first);
    } else {
      setSelectedTurnIndex(null);
    }
  }, [data]);

  const vm = useMemo(
    () => buildAnalysisResultViewModel(data, { selectedTurnIndex }),
    [data, selectedTurnIndex]
  );

  if (vm.kind === "mock-legacy") {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-6 md:p-8 mb-8">
        <p className="text-amber-100 font-medium mb-2" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
          {t.mockBanner}
        </p>
        <p className="text-sm text-slate-400">{t.betaNote}</p>
      </div>
    );
  }

  if (vm.kind === "unknown") {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-6 md:p-8 mb-8">
        <p className="text-red-100 font-medium">{t.unknownBanner}</p>
      </div>
    );
  }

  const s = vm.summary;
  const yn = (v: boolean) => (v ? t.yesShort : t.noShort);

  return (
    <div className="space-y-6 mb-8">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-8">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-widest text-amber-400/80 font-mono">
          <span>v1</span>
          <span className="rounded-full border border-amber-500/30 px-2 py-0.5 text-[10px] normal-case text-amber-200/90">
            {t.summaryStatusComplete}
          </span>
        </div>
        <h1
          className="text-2xl md:text-3xl font-bold text-amber-100 mb-2"
          style={{ fontFamily: "'Noto Serif KR', serif" }}
        >
          {t.summaryTitle}
        </h1>
        <p className="text-sm text-amber-50/90 mb-4 border-l-2 border-amber-400/50 pl-3">{t.betaNote}</p>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <div className="rounded-lg bg-black/20 px-3 py-2 border border-white/5">
            <dt className="text-slate-500 text-xs">{t.engine}</dt>
            <dd className="text-amber-100 font-mono">{s.engine}</dd>
          </div>
          <div className="rounded-lg bg-black/20 px-3 py-2 border border-white/5">
            <dt className="text-slate-500 text-xs">{t.totalMoves}</dt>
            <dd className="text-amber-100 font-mono">{s.totalMoves}</dd>
          </div>
          <div className="rounded-lg bg-black/20 px-3 py-2 border border-white/5 sm:col-span-2 lg:col-span-1">
            <dt className="text-slate-500 text-xs">{t.flagsSectionTitle}</dt>
            <dd className="text-amber-100 font-mono text-xs leading-relaxed">
              {t.flagMT}:{yn(s.hasMultiTurn)} · {t.flagBSI}:{yn(s.hasBsi)} · {t.flagADI}:{yn(s.hasAdi)} · {t.flagDSP}:
              {yn(s.hasDeepSearchPlan)} · {t.flagDSR}:{yn(s.hasDeepSearchResults)}
            </dd>
          </div>
          <div className="rounded-lg bg-black/20 px-3 py-2 border border-white/5 sm:col-span-2 lg:col-span-3">
            <dt className="text-slate-500 text-xs">{t.deepSearchRowTitle}</dt>
            <dd className="text-amber-100 text-sm">{s.deepSearchEnabled ? t.dsOn : t.dsOff}</dd>
          </div>
        </dl>
        {vm.warnings.length > 0 ? (
          <ul className="mt-4 text-xs text-slate-400 space-y-1 list-disc pl-5">
            {vm.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{translateVmWarning(w, uiLang)}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <AnalysisWinratePanel
        series={vm.graph.winrateSeries}
        selectedTurnIndex={selectedTurnIndex}
        onSelectTurnIndex={setSelectedTurnIndex}
        lang={lang}
      />

      <AnalysisCandidateList
        raw={data}
        candidates={vm.keyMoveCandidates}
        selectedTurnIndex={selectedTurnIndex}
        onSelectTurnIndex={setSelectedTurnIndex}
        lang={lang}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <AnalysisVariationPreview
          previews={vm.variationPreview}
          selectedTurnIndex={selectedTurnIndex}
          lang={lang}
        />
        <section className="rounded-2xl border border-dashed border-white/15 bg-black/15 p-6 flex flex-col justify-center min-h-[200px]">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">{t.boardTitle}</h3>
            <span
              className="text-[10px] px-2 py-0.5 rounded-full border border-white/15 text-slate-500 font-mono uppercase tracking-wide"
              aria-label={t.boardBadge}
            >
              {t.boardBadge}
            </span>
          </div>
          {vm.sgfPlayback.placeholder ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-400" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                {translatePlaceholderMessageKey(vm.sgfPlayback.messageKey, uiLang)}
              </p>
              <p className="text-xs text-slate-600">{t.boardPhGrid}</p>
              {vm.sgfPlayback.totalMovesHint != null ? (
                <p className="text-[11px] font-mono text-slate-500">
                  {t.totalMoves}: {vm.sgfPlayback.totalMovesHint}
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-600 mb-3" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                {t.boardSnapshotHint}
              </p>
              <dl className="text-sm text-slate-400 space-y-2 font-mono">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 shrink-0" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                    {t.boardDebugOrder}
                  </dt>
                  <dd className="text-amber-100">{vm.sgfPlayback.selectedTurnIndex}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 shrink-0" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                    {t.boardDebugLast}
                  </dt>
                  <dd className="text-amber-100">
                    {vm.sgfPlayback.lastMove
                      ? `${vm.sgfPlayback.lastMove.gtp} · (${vm.sgfPlayback.lastMove.x},${vm.sgfPlayback.lastMove.y})`
                      : t.boardNoLast}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 shrink-0" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                    {t.boardDebugStones}
                  </dt>
                  <dd className="text-amber-100">{vm.sgfPlayback.stones.length}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 shrink-0" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                    {t.boardDebugSz}
                  </dt>
                  <dd className="text-amber-100">{vm.sgfPlayback.boardSize}</dd>
                </div>
              </dl>
              {vm.sgfPlayback.warnings.length > 0 ? (
                <ul className="mt-3 text-[11px] text-amber-200/80 space-y-1 list-disc pl-4">
                  {vm.sgfPlayback.warnings.map((w, i) => (
                    <li key={`${w.code}-${i}-${JSON.stringify(w.params ?? {})}`}>
                      {translateSgfPlaybackWarning(w, uiLang)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
