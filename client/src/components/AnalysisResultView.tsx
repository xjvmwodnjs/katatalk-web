import { useCallback, useEffect, useMemo, useState } from "react";
import { buildAnalysisResultViewModel } from "@/lib/analysisResultViewModel";
import type { Language } from "@/lib/mockData";
import AnalysisWinratePanel from "@/components/AnalysisWinratePanel";
import AnalysisCandidateList from "@/components/AnalysisCandidateList";
import AnalysisVariationPreview from "@/components/AnalysisVariationPreview";
import BadukBoardView from "@/components/BadukBoardView";
import BoardTurnNavigation from "@/components/BoardTurnNavigation";
import { collectBadukBoardGhostMarkersV1 } from "@shared/badukBoardViewV1";
import {
  clampSelectedTurnIndexV1,
  isBoardKeyboardNavKeyV1,
  isBoardTurnNavigationInteractiveV1,
  nextTurnIndexFromBoardKeyboardV1,
  shouldHandleBoardKeyboardNavEventV1,
  shouldIgnoreBoardKeyboardNavFocusV1,
  shouldShowBoardTurnNavigationV1,
} from "@shared/boardNavigationV1";
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
      if (first != null && !v.sgfPlayback.placeholder) {
        setSelectedTurnIndex(clampSelectedTurnIndexV1(first, v.sgfPlayback.totalMoves));
      } else {
        setSelectedTurnIndex(first);
      }
    } else {
      setSelectedTurnIndex(null);
    }
  }, [data]);

  const vm = useMemo(
    () => buildAnalysisResultViewModel(data, { selectedTurnIndex }),
    [data, selectedTurnIndex]
  );

  const showBoardNav =
    vm.kind === "katago-worker-v1" &&
    shouldShowBoardTurnNavigationV1({
      vmKind: vm.kind,
      sgfPlaceholder: vm.sgfPlayback.placeholder,
    });
  const boardNavTotalMoves =
    vm.kind === "katago-worker-v1" && !vm.sgfPlayback.placeholder
      ? vm.sgfPlayback.totalMoves
      : 0;
  const boardNavTurnIndex =
    vm.kind === "katago-worker-v1" && !vm.sgfPlayback.placeholder
      ? vm.sgfPlayback.selectedTurnIndex
      : 0;

  const selectTurnIndex = useCallback(
    (raw: number | null) => {
      if (raw == null) {
        setSelectedTurnIndex(null);
        return;
      }
      if (showBoardNav) {
        setSelectedTurnIndex(clampSelectedTurnIndexV1(raw, boardNavTotalMoves));
        return;
      }
      const n = Math.trunc(Number(raw));
      setSelectedTurnIndex(Number.isFinite(n) ? n : null);
    },
    [showBoardNav, boardNavTotalMoves]
  );

  const boardGhosts = useMemo(() => {
    if (vm.kind !== "katago-worker-v1" || vm.sgfPlayback.placeholder) {
      return [];
    }
    const occupied = vm.sgfPlayback.stones.map((st) => `${st.x},${st.y}`);
    return collectBadukBoardGhostMarkersV1({
      boardSize: vm.sgfPlayback.boardSize,
      occupiedKeys: occupied,
      selectedTurnIndex: vm.sgfPlayback.selectedTurnIndex,
      candidates: vm.keyMoveCandidates,
      variationPreview: vm.variationPreview,
    });
  }, [vm]);

  useEffect(() => {
    if (!showBoardNav) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) {
        return;
      }
      if (!shouldHandleBoardKeyboardNavEventV1(e) || !isBoardKeyboardNavKeyV1(e.key)) {
        return;
      }
      if (!isBoardTurnNavigationInteractiveV1(boardNavTotalMoves)) {
        return;
      }
      if (shouldIgnoreBoardKeyboardNavFocusV1(document.activeElement)) {
        return;
      }
      const next = nextTurnIndexFromBoardKeyboardV1(e.key, boardNavTurnIndex, boardNavTotalMoves);
      e.preventDefault();
      selectTurnIndex(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showBoardNav, boardNavTurnIndex, boardNavTotalMoves, selectTurnIndex]);

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
        onSelectTurnIndex={selectTurnIndex}
        lang={lang}
      />

      <AnalysisCandidateList
        raw={data}
        candidates={vm.keyMoveCandidates}
        selectedTurnIndex={selectedTurnIndex}
        onSelectTurnIndex={selectTurnIndex}
        lang={lang}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <AnalysisVariationPreview
          previews={vm.variationPreview}
          selectedTurnIndex={selectedTurnIndex}
          lang={lang}
        />
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex flex-col min-h-[200px]">
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
              <p className="text-xs text-slate-500 mb-2" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
                {t.boardSnapshotHint}
              </p>
              <p className="text-[11px] text-slate-600 mb-3">{t.boardViewOnlyNote}</p>
              {showBoardNav ? (
                <BoardTurnNavigation
                  selectedTurnIndex={boardNavTurnIndex}
                  totalMoves={boardNavTotalMoves}
                  onSelectTurnIndex={selectTurnIndex}
                  lang={uiLang}
                />
              ) : null}
              <BadukBoardView
                boardSize={vm.sgfPlayback.boardSize}
                stones={vm.sgfPlayback.stones}
                lastMove={vm.sgfPlayback.lastMove}
                ghosts={boardGhosts}
                lang={uiLang}
              />
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
