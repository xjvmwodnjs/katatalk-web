import { useCallback, useEffect, useMemo, useState } from "react";
import { buildAnalysisResultViewModel } from "@/lib/analysisResultViewModel";
import type { Language } from "@/lib/mockData";
import AnalysisWinratePanel from "@/components/AnalysisWinratePanel";
import AnalysisCandidateList from "@/components/AnalysisCandidateList";
import BadukBoardView from "@/components/BadukBoardView";
import BoardTurnNavigation from "@/components/BoardTurnNavigation";
import { collectBadukBoardGhostMarkersV1 } from "@shared/badukBoardViewV1";
import {
  backToMainlineStateV3,
  canEnterTryPlayModeV3,
  canPlaceTryPlayStoneV3,
  candidateSelectedStateV3,
  hasRenderableVariationOverlayV2,
  nextTryPlayColorV3,
  nextWinrateCollapsedV2,
  readCompactGameInfoV2,
  renderableVariationTurnIndexesV2,
  variationReviewStateV3,
  variationIdV2,
  type AnalysisReviewModeV3,
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
  internalReferenceSignalLabel,
  normalizeAnalysisResultLang,
  translateLearningEventSourceLabel,
  translatePlaceholderMessageKey,
  translateSgfPlaybackWarning,
  translateVmWarning,
} from "@shared/analysisResultI18n";
import { mapReasonPhraseForUi, uiTextContainsForbiddenLabel } from "@shared/analysisResultUiHelpers";

type Props = {
  data: unknown;
  lang: Language;
};

type TryPlayStone = { x: number; y: number; color: "B" | "W"; gtp: string; kind: "try"; order: number };
type AnalysisResultUiStrings = ReturnType<typeof getAnalysisResultUiStrings>;

function productPlanSummaryText(summaryKey: string, t: AnalysisResultUiStrings): string {
  switch (summaryKey) {
    case "ep_summary_decisive_loser_perspective_candidate":
      return t.productSummaryDecisive;
    case "ep_summary_review_timeline_context_candidate":
      return t.productSummaryTimeline;
    case "ep_summary_review_learning_candidate":
      return t.productSummaryLearning;
    default:
      return t.productSummaryDefault;
  }
}

function productPlanBulletText(type: string, t: AnalysisResultUiStrings): string {
  switch (type) {
    case "score_loss":
      return t.productBulletScoreLoss;
    case "winrate_loss":
      return t.productBulletWinrateLoss;
    case "bsi":
      return t.productBulletBsi;
    case "adi":
      return t.productBulletAdi;
    case "deep_search":
      return t.productBulletDeepSearch;
    case "timeline_context":
      return t.productBulletTimelineContext;
    case "pv":
      return t.productBulletPv;
    case "learning_event":
      return t.productBulletLearningEvent;
    default:
      return t.productBulletDefault;
  }
}

export default function AnalysisResultView({ data, lang }: Props) {
  const [selectedTurnIndex, setSelectedTurnIndex] = useState<number | null>(null);
  const [selectedVariationId, setSelectedVariationId] = useState<string | null>(null);
  const [selectedCandidateTurnIndex, setSelectedCandidateTurnIndex] = useState<number | null>(null);
  const [reviewMode, setReviewMode] = useState<AnalysisReviewModeV3>("mainline");
  const [tryPlayStones, setTryPlayStones] = useState<TryPlayStone[]>([]);
  const [winrateCollapsed, setWinrateCollapsed] = useState(false);
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
    setSelectedCandidateTurnIndex(null);
    setReviewMode("mainline");
    setTryPlayStones([]);
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
  const canTryPlay = vm.kind === "katago-worker-v1" && canEnterTryPlayModeV3(vm.sgfPlayback.placeholder);
  const actualStoneKeys = useMemo(() => {
    if (vm.kind !== "katago-worker-v1" || vm.sgfPlayback.placeholder) {
      return new Set<string>();
    }
    return new Set(vm.sgfPlayback.stones.map((st) => `${st.x},${st.y}`));
  }, [vm]);
  const selectedVariation = useMemo(() => {
    if (vm.kind !== "katago-worker-v1" || selectedVariationId == null || vm.sgfPlayback.placeholder) {
      return null;
    }
    if (!("boardSize" in vm.sgfPlayback)) {
      return null;
    }
    const row = vm.variationPreview.find((p) => variationIdV2(p) === selectedVariationId) ?? null;
    return row && hasRenderableVariationOverlayV2(row, vm.sgfPlayback.boardSize, actualStoneKeys) ? row : null;
  }, [vm, selectedVariationId, actualStoneKeys]);
  const variationTurnIndexes = useMemo(
    () =>
      vm.kind === "katago-worker-v1" && !vm.sgfPlayback.placeholder && "boardSize" in vm.sgfPlayback
        ? renderableVariationTurnIndexesV2(vm.variationPreview, vm.sgfPlayback.boardSize, actualStoneKeys)
        : new Set<number>(),
    [vm, actualStoneKeys]
  );
  const gameInfo = useMemo(() => readCompactGameInfoV2(data, uiLang), [data, uiLang]);
  const selectedCandidate = useMemo(
    () =>
      vm.kind === "katago-worker-v1" && selectedCandidateTurnIndex != null
      && (reviewMode === "candidate-selected" || reviewMode === "variation-review")
        ? vm.keyMoveCandidates.find((c) => c.turnIndex === selectedCandidateTurnIndex) ?? null
        : null,
    [vm, selectedCandidateTurnIndex, reviewMode]
  );
  const selectedLearningEvent = selectedCandidate?.learningEvent ?? null;
  const selectedProductPlan = useMemo(() => {
    if (vm.kind !== "katago-worker-v1" || selectedCandidate == null || vm.productReviewV1 == null) {
      return null;
    }
    return vm.productReviewV1.explanationPlans.find((plan) => plan.turnIndex === selectedCandidate.turnIndex) ?? null;
  }, [vm, selectedCandidate]);
  const selectedLearningEventScore =
    typeof selectedLearningEvent?.score === "number" && Number.isFinite(selectedLearningEvent.score)
      ? selectedLearningEvent.score
      : null;
  const selectedLearningEventWinrateDelta =
    typeof selectedLearningEvent?.signals.winrateDelta === "number" && Number.isFinite(selectedLearningEvent.signals.winrateDelta)
      ? selectedLearningEvent.signals.winrateDelta
      : null;
  const selectedLearningEventScoreLeadDelta =
    typeof selectedLearningEvent?.signals.scoreLeadDelta === "number" && Number.isFinite(selectedLearningEvent.signals.scoreLeadDelta)
      ? selectedLearningEvent.signals.scoreLeadDelta
      : null;
  const selectedLearningEventSources = Array.isArray(selectedLearningEvent?.evidence.source)
    ? selectedLearningEvent.evidence.source.map((source) => translateLearningEventSourceLabel(source, uiLang))
    : [];
  const selectedCandidateVariation = useMemo(() => {
    if (vm.kind !== "katago-worker-v1" || selectedCandidateTurnIndex == null || vm.sgfPlayback.placeholder) {
      return null;
    }
    if (!("boardSize" in vm.sgfPlayback)) {
      return null;
    }
    const boardSize = vm.sgfPlayback.boardSize;
    return (
      vm.variationPreview.find(
        (p) =>
          p.turnIndex === selectedCandidateTurnIndex &&
          hasRenderableVariationOverlayV2(p, boardSize, actualStoneKeys)
      ) ?? null
    );
  }, [vm, selectedCandidateTurnIndex, actualStoneKeys]);

  const selectTurnIndex = useCallback(
    (raw: number | null) => {
      if (raw == null) {
        setSelectedTurnIndex(null);
        setSelectedVariationId(null);
        setSelectedCandidateTurnIndex(null);
        setReviewMode("mainline");
        setTryPlayStones([]);
        return;
      }
      if (showBoardNav) {
        setSelectedTurnIndex(clampSelectedTurnIndexV1(raw, boardNavTotalMoves));
        setSelectedVariationId(null);
        setSelectedCandidateTurnIndex(null);
        setReviewMode("mainline");
        setTryPlayStones([]);
        return;
      }
      const n = Math.trunc(Number(raw));
      setSelectedTurnIndex(Number.isFinite(n) ? n : null);
      setSelectedVariationId(null);
      setSelectedCandidateTurnIndex(null);
      setReviewMode("mainline");
      setTryPlayStones([]);
    },
    [showBoardNav, boardNavTotalMoves]
  );

  const selectCandidate = useCallback(
    (turnIndex: number) => {
      if (showBoardNav) {
        setSelectedTurnIndex(clampSelectedTurnIndexV1(turnIndex, boardNavTotalMoves));
      } else {
        setSelectedTurnIndex(turnIndex);
      }
      const next = candidateSelectedStateV3(
        { selectedVariationId, selectedCandidateTurnIndex, reviewMode, tryPlayStoneCount: tryPlayStones.length },
        turnIndex
      );
      setSelectedCandidateTurnIndex(next.selectedCandidateTurnIndex);
      setSelectedVariationId(next.selectedVariationId);
      setTryPlayStones([]);
      setReviewMode(next.reviewMode);
    },
    [showBoardNav, boardNavTotalMoves, selectedVariationId, selectedCandidateTurnIndex, reviewMode, tryPlayStones.length]
  );

  const selectVariationByTurnIndex = useCallback(
    (turnIndex: number) => {
      if (vm.kind !== "katago-worker-v1" || vm.sgfPlayback.placeholder || !("boardSize" in vm.sgfPlayback)) {
        return;
      }
      const boardSize = vm.sgfPlayback.boardSize;
      const row = vm.variationPreview.find(
        (p) => p.turnIndex === turnIndex && hasRenderableVariationOverlayV2(p, boardSize, actualStoneKeys)
      );
      if (!row) {
        return;
      }
      if (showBoardNav) {
        setSelectedTurnIndex(clampSelectedTurnIndexV1(row.turnIndex, boardNavTotalMoves));
      } else {
        setSelectedTurnIndex(row.turnIndex);
      }
      const next = variationReviewStateV3(
        { selectedVariationId, selectedCandidateTurnIndex, reviewMode, tryPlayStoneCount: tryPlayStones.length },
        variationIdV2(row),
        true
      );
      setSelectedCandidateTurnIndex(row.turnIndex);
      setTryPlayStones([]);
      setSelectedVariationId(next.selectedVariationId);
      setReviewMode(next.reviewMode);
    },
    [vm, actualStoneKeys, showBoardNav, boardNavTotalMoves, selectedVariationId, selectedCandidateTurnIndex, reviewMode, tryPlayStones.length]
  );

  const backToMainline = useCallback(() => {
    const next = backToMainlineStateV3({
      selectedVariationId,
      selectedCandidateTurnIndex,
      reviewMode,
      tryPlayStoneCount: tryPlayStones.length,
    });
    setSelectedVariationId(next.selectedVariationId);
    setSelectedCandidateTurnIndex(next.selectedCandidateTurnIndex);
    setTryPlayStones([]);
    setReviewMode(next.reviewMode);
  }, [selectedVariationId, selectedCandidateTurnIndex, reviewMode, tryPlayStones.length]);

  const enterTryPlayMode = useCallback(() => {
    if (vm.kind !== "katago-worker-v1" || !canEnterTryPlayModeV3(vm.sgfPlayback.placeholder)) {
      return;
    }
    setSelectedVariationId(null);
    setSelectedCandidateTurnIndex(null);
    setTryPlayStones([]);
    setReviewMode("try-play");
  }, [vm]);

  const undoTryPlay = useCallback(() => {
    setTryPlayStones((prev) => prev.slice(0, -1));
  }, []);

  const resetTryPlay = useCallback(() => {
    setTryPlayStones([]);
  }, []);

  const occupiedKeys = useMemo(() => {
    if (vm.kind !== "katago-worker-v1" || vm.sgfPlayback.placeholder) {
      return new Set<string>();
    }
    return new Set([...vm.sgfPlayback.stones.map((st) => `${st.x},${st.y}`), ...tryPlayStones.map((st) => `${st.x},${st.y}`)]);
  }, [vm, tryPlayStones]);

  const handleTryPlayPoint = useCallback(
    (x: number, y: number) => {
      if (reviewMode !== "try-play" || vm.kind !== "katago-worker-v1" || vm.sgfPlayback.placeholder) {
        return;
      }
      if (!canPlaceTryPlayStoneV3(occupiedKeys, x, y)) {
        return;
      }
      const color = nextTryPlayColorV3(vm.sgfPlayback.currentPlayer, tryPlayStones.length);
      const order = tryPlayStones.length + 1;
      setTryPlayStones((prev) => [...prev, { x, y, color, gtp: `try-${x}-${y}-${order}`, kind: "try", order }]);
    },
    [reviewMode, vm, occupiedKeys, tryPlayStones]
  );

  const toggleWinrateCollapsed = useCallback(() => {
    setWinrateCollapsed((v) => nextWinrateCollapsedV2(v));
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
      overlayMode: reviewMode,
      selectedVariation: reviewMode === "variation-review" ? selectedVariation : null,
      pvStartColor: vm.sgfPlayback.currentPlayer,
      tryPlayStones: reviewMode === "try-play" ? tryPlayStones : [],
    });
  }, [vm, selectedVariation, reviewMode, tryPlayStones]);

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
    <div className="mb-8 max-w-full space-y-3 overflow-hidden sm:space-y-4">
      <section className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] sm:gap-x-3 sm:gap-y-2 sm:text-xs">
          <span className="rounded-full border border-amber-500/30 px-2 py-0.5 font-mono text-[10px] text-amber-200/90">
            {t.summaryStatusComplete}
          </span>
          <span className="text-slate-400">{t.blackPlayer}: <span className="text-amber-100">{gameInfo.blackPlayer ?? "—"}</span></span>
          <span className="text-slate-400">{t.whitePlayer}: <span className="text-amber-100">{gameInfo.whitePlayer ?? "—"}</span></span>
          <span className="text-slate-400">{t.gameResult}: <span className="text-amber-100">{gameInfo.resultText ?? "—"}</span></span>
          <span className="text-slate-400">{t.analysisModel}: <span className="font-mono text-amber-100">{s.engine}</span></span>
          <span className="text-slate-400">{t.totalMoves}: <span className="font-mono text-amber-100">{s.totalMoves}</span></span>
          <span className="text-slate-500 hidden sm:inline">
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

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:items-start">
        <div className="min-w-0 space-y-3">
          <section className="flex min-h-[200px] min-w-0 flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:p-4 md:p-5">
          <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">{t.boardTitle}</h3>
            <span
              className="text-[10px] px-2 py-0.5 rounded-full border border-white/15 text-slate-500 font-mono uppercase tracking-wide"
              aria-label={t.boardBadge}
            >
              {t.boardBadge}
            </span>
            {reviewMode === "variation-review" && selectedVariation ? (
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
              <BadukBoardView
                boardSize={vm.sgfPlayback.boardSize}
                stones={vm.sgfPlayback.stones}
                lastMove={vm.sgfPlayback.lastMove}
                ghosts={boardGhosts}
                lang={uiLang}
                onPointClick={reviewMode === "try-play" ? handleTryPlayPoint : undefined}
              />
              {showBoardNav ? (
                <div className="mt-2 min-w-0">
                  <BoardTurnNavigation
                    selectedTurnIndex={boardNavTurnIndex}
                    totalMoves={boardNavTotalMoves}
                    onSelectTurnIndex={selectTurnIndex}
                    lang={uiLang}
                  />
                </div>
              ) : null}
              {reviewMode === "variation-review" || reviewMode === "try-play" ? (
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
            collapsed={winrateCollapsed}
            onToggleCollapsed={toggleWinrateCollapsed}
          />
        </div>

        <div className="min-w-0 space-y-3">
          <AnalysisCandidateList
            raw={data}
            candidates={vm.keyMoveCandidates}
            selectedTurnIndex={selectedTurnIndex}
            onSelectTurnIndex={selectTurnIndex}
            selectedCandidateTurnIndex={selectedCandidate?.turnIndex ?? null}
            onSelectCandidate={selectCandidate}
            variationTurnIndexes={variationTurnIndexes}
            lang={lang}
          />

          <section className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:p-5">
            <h2 className="mb-2 text-base font-bold text-amber-100 sm:mb-3 sm:text-lg" style={{ fontFamily: "'Noto Serif KR', serif" }}>
              {t.analysisMemoTitle}
            </h2>
            <div className="space-y-1.5 text-xs text-slate-300 sm:space-y-2 sm:text-sm" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
              <p>
                {reviewMode === "try-play"
                  ? t.tryPlayNotice
                  : selectedProductPlan
                    ? productPlanSummaryText(selectedProductPlan.summaryKey, t)
                    : selectedLearningEvent
                    ? t.analysisMemoLearningEvent
                    : selectedCandidate
                      ? t.analysisMemoCandidate
                      : t.analysisMemoSelectCandidate}
              </p>
              {selectedProductPlan ? (
                <ul className="list-disc space-y-1 pl-4 text-xs text-slate-400">
                  {selectedProductPlan.evidenceBullets.slice(0, 4).map((bullet, index) => (
                    <li key={`${bullet.type}-${index}`}>
                      {productPlanBulletText(bullet.type, t)}
                      {typeof bullet.value === "number" ? `: ${bullet.value.toFixed(bullet.unit === "ratio" ? 3 : 1)}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              {selectedLearningEvent?.signals.deepSearchCompleted ? <p>{t.analysisMemoDeepSearchEvidence}</p> : null}
              {selectedVariation ? <p>{t.analysisMemoVariation}</p> : null}
              <p>{t.analysisMemoPvCaution}</p>
              <p>{t.analysisMemoSignalCaution}</p>
              <p className="text-xs text-slate-500">{t.analysisMemoNoLlM}</p>
            </div>
            {selectedCandidate ? (
              <dl className="mt-3 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 rounded-xl border border-white/10 bg-black/20 p-3 text-xs sm:grid-cols-2 sm:gap-x-3 sm:gap-y-2">
                <dt className="text-slate-500">{t.variationTurn}</dt>
                <dd className="min-w-0 truncate font-mono text-amber-100">#{selectedCandidate.turnIndex}</dd>
                <dt className="text-slate-500">{t.playedMove}</dt>
                <dd className="min-w-0 truncate font-mono text-amber-100">{selectedCandidate.playedMove}</dd>
                <dt className="text-slate-500">{t.candidateMove}</dt>
                <dd className="min-w-0 truncate font-mono text-amber-100">{selectedCandidate.bestMove ?? "—"}</dd>
                <dt className="text-slate-500">{t.bsi}</dt>
                <dd className="text-slate-200">{selectedCandidate.bsiScore != null ? selectedCandidate.bsiScore.toFixed(0) : "—"}</dd>
                <dt className="text-slate-500">{t.adi}</dt>
                <dd className="text-slate-200">{selectedCandidate.adiScore != null ? selectedCandidate.adiScore.toFixed(2) : "—"}</dd>
                <dt className="text-slate-500">{t.dsSelected}</dt>
                <dd className="text-slate-200">{selectedCandidate.deepSearchSelected ? t.yesShort : t.noShort}</dd>
                <dt className="text-slate-500">{t.dsCompleted}</dt>
                <dd className="text-slate-200">{selectedCandidate.deepSearchCompleted ? t.yesShort : t.noShort}</dd>
                <dt className="text-slate-500">{t.variationPvState}</dt>
                <dd className="text-slate-200">{selectedCandidateVariation ? t.yesShort : t.noShort}</dd>
                {selectedLearningEvent ? (
                  <>
                    <dt className="text-slate-500">{t.learningEventConfidence}</dt>
                    <dd className="min-w-0 truncate font-mono text-slate-200">{selectedLearningEvent.confidence}</dd>
                    <dt className="text-slate-500">{t.learningEventScore}</dt>
                    <dd className="min-w-0 truncate font-mono text-slate-200">
                      {selectedLearningEventScore != null ? selectedLearningEventScore.toFixed(1) : "—"}
                    </dd>
                    <dt className="text-slate-500">{t.learningEventWinrateDelta}</dt>
                    <dd className="min-w-0 truncate font-mono text-slate-200">
                      {selectedLearningEventWinrateDelta != null ? selectedLearningEventWinrateDelta.toFixed(1) : "—"}
                    </dd>
                    <dt className="text-slate-500">{t.learningEventScoreLeadDelta}</dt>
                    <dd className="min-w-0 truncate font-mono text-slate-200">
                      {selectedLearningEventScoreLeadDelta != null ? selectedLearningEventScoreLeadDelta.toFixed(1) : "—"}
                    </dd>
                    <dt className="col-span-2 text-slate-500">{t.learningEventSources}</dt>
                    <dd className="col-span-2 min-w-0 truncate font-mono text-[11px] text-slate-300">
                      {selectedLearningEventSources.length > 0 ? selectedLearningEventSources.join(" · ") : "—"}
                    </dd>
                  </>
                ) : null}
                <dt className="col-span-2 text-slate-500">{t.variationReasons}</dt>
                <dd className="col-span-2 flex min-w-0 flex-wrap gap-1">
                  {selectedCandidate.reasons.length > 0
                    ? selectedCandidate.reasons.slice(0, 4).map((r) => {
                        let mapped = mapReasonPhraseForUi(r, uiLang);
                        if (uiTextContainsForbiddenLabel(mapped, uiLang)) {
                          mapped = internalReferenceSignalLabel(uiLang);
                        }
                        return (
                          <span key={r} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                            {mapped}
                          </span>
                        );
                      })
                    : "—"}
                </dd>
              </dl>
            ) : null}
            <div className="mt-3 flex min-w-0 flex-wrap gap-2">
              <button
                type="button"
                disabled={!selectedCandidateVariation}
                onClick={() => selectedCandidateVariation && selectVariationByTurnIndex(selectedCandidateVariation.turnIndex)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {selectedCandidateVariation ? t.variationShowOnBoard : t.variationNoDisplayable}
              </button>
              <button
                type="button"
                onClick={enterTryPlayMode}
                disabled={!canTryPlay}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {canTryPlay ? t.tryPlayEnter : t.tryPlayDisabled}
              </button>
              {reviewMode === "try-play" ? (
                <>
                  <button
                    type="button"
                    onClick={undoTryPlay}
                    disabled={tryPlayStones.length === 0}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {t.tryPlayUndo}
                  </button>
                  <button
                    type="button"
                    onClick={resetTryPlay}
                    disabled={tryPlayStones.length === 0}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {t.tryPlayReset}
                  </button>
                </>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
