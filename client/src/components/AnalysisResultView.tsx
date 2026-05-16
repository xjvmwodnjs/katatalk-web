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
  displayableVariationTurnIndexesV2,
  hasDisplayableVariationPvV2,
  reviewModeForSelectedVariationV2,
  selectedVariationByIdV2,
  variationIdV2,
} from "@shared/analysisReviewUiV2";
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
  const [selectedVariationId, setSelectedVariationId] = useState<string | null>(null);
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
    setSelectedVariationId(null);
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
  const selectedVariation = useMemo(
    () => (vm.kind === "katago-worker-v1" ? selectedVariationByIdV2(vm.variationPreview, selectedVariationId) : null),
    [vm, selectedVariationId]
  );
  const reviewMode = reviewModeForSelectedVariationV2(selectedVariation ? selectedVariationId : null);
  const variationTurnIndexes = useMemo(
    () => (vm.kind === "katago-worker-v1" ? displayableVariationTurnIndexesV2(vm.variationPreview) : new Set<number>()),
    [vm]
  );

  const selectTurnIndex = useCallback(
    (raw: number | null) => {
      if (raw == null) {
        setSelectedTurnIndex(null);
        setSelectedVariationId(null);
        return;
      }
      if (showBoardNav) {
        setSelectedTurnIndex(clampSelectedTurnIndexV1(raw, boardNavTotalMoves));
        setSelectedVariationId(null);
        return;
      }
      const n = Math.trunc(Number(raw));
      setSelectedTurnIndex(Number.isFinite(n) ? n : null);
      setSelectedVariationId(null);
    },
    [showBoardNav, boardNavTotalMoves]
  );

  const selectVariationByTurnIndex = useCallback(
    (turnIndex: number) => {
      if (vm.kind !== "katago-worker-v1") {
        return;
      }
      const row = vm.variationPreview.find((p) => p.turnIndex === turnIndex && hasDisplayableVariationPvV2(p));
      if (!row) {
        return;
      }
      if (showBoardNav) {
        setSelectedTurnIndex(clampSelectedTurnIndexV1(row.turnIndex, boardNavTotalMoves));
      } else {
        setSelectedTurnIndex(row.turnIndex);
      }
      setSelectedVariationId(variationIdV2(row));
    },
    [vm, showBoardNav, boardNavTotalMoves]
  );

  const selectVariationRow = useCallback(
    (row: { turnIndex: number; source: "deep-search" | "multi-turn" }) => {
      if (vm.kind !== "katago-worker-v1") {
        return;
      }
      const found = vm.variationPreview.find((p) => variationIdV2(p) === variationIdV2(row) && hasDisplayableVariationPvV2(p));
      if (!found) {
        return;
      }
      if (showBoardNav) {
        setSelectedTurnIndex(clampSelectedTurnIndexV1(found.turnIndex, boardNavTotalMoves));
      } else {
        setSelectedTurnIndex(found.turnIndex);
      }
      setSelectedVariationId(variationIdV2(found));
    },
    [vm, showBoardNav, boardNavTotalMoves]
  );

  const backToMainline = useCallback(() => {
    setSelectedVariationId(null);
  }, []);

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
      selectedVariation,
    });
  }, [vm, selectedVariation]);

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
    <div className="space-y-4 mb-8">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-amber-500/30 px-2 py-0.5 font-mono text-[10px] text-amber-200/90">
            {t.summaryStatusComplete}
          </span>
          <span className="text-slate-400">{t.engine}: <span className="font-mono text-amber-100">{s.engine}</span></span>
          <span className="text-slate-400">{t.totalMoves}: <span className="font-mono text-amber-100">{s.totalMoves}</span></span>
          <span className="text-slate-500">
            {t.flagMT}:{yn(s.hasMultiTurn)} · {t.flagBSI}:{yn(s.hasBsi)} · {t.flagADI}:{yn(s.hasAdi)} · {t.flagDSR}:{yn(s.hasDeepSearchResults)}
          </span>
        </div>
        {vm.warnings.length > 0 ? (
          <ul className="mt-2 text-xs text-slate-400 space-y-1 list-disc pl-5">
            {vm.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{translateVmWarning(w, uiLang)}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:items-start">
        <div className="space-y-4">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:p-5 flex flex-col min-h-[200px]">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">{t.boardTitle}</h3>
            <span
              className="text-[10px] px-2 py-0.5 rounded-full border border-white/15 text-slate-500 font-mono uppercase tracking-wide"
              aria-label={t.boardBadge}
            >
              {t.boardBadge}
            </span>
            {reviewMode === "variation" ? (
              <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-100">
                {t.variationSelectedOnBoard}
              </span>
            ) : null}
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
              {reviewMode === "variation" ? (
                <button
                  type="button"
                  onClick={backToMainline}
                  className="mx-auto mt-3 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:border-white/25"
                >
                  {t.reviewBackToMainline}
                </button>
              ) : null}
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

          <AnalysisWinratePanel
            series={vm.graph.winrateSeries}
            selectedTurnIndex={selectedTurnIndex}
            onSelectTurnIndex={selectTurnIndex}
            lang={lang}
            fullTimeline={vm.kind === "katago-worker-v1" ? vm.graph.winrateSeriesFromTimeline : false}
          />
        </div>

        <div className="space-y-4">
          <AnalysisCandidateList
            raw={data}
            candidates={vm.keyMoveCandidates}
            selectedTurnIndex={selectedTurnIndex}
            onSelectTurnIndex={selectTurnIndex}
            selectedVariationTurnIndex={selectedVariation?.turnIndex ?? null}
            variationTurnIndexes={variationTurnIndexes}
            onSelectVariation={selectVariationByTurnIndex}
            lang={lang}
          />

          <AnalysisVariationPreview
            previews={vm.variationPreview}
            selectedVariationId={selectedVariation ? selectedVariationId : null}
            onSelectVariation={selectVariationRow}
            onBackToMainline={backToMainline}
            lang={lang}
          />

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="text-lg font-bold text-amber-100 mb-3" style={{ fontFamily: "'Noto Serif KR', serif" }}>
              {t.analysisMemoTitle}
            </h2>
            <div className="space-y-2 text-sm text-slate-300" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
              <p>{selectedVariation ? t.analysisMemoVariation : t.analysisMemoCandidate}</p>
              <p>{t.analysisMemoPvCaution}</p>
              <p>{t.analysisMemoSignalCaution}</p>
              <p className="text-xs text-slate-500">{t.analysisMemoNoLlM}</p>
            </div>
            <button
              type="button"
              disabled
              className="mt-4 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-500 opacity-70 cursor-not-allowed"
            >
              {t.tryPlayDisabled}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
