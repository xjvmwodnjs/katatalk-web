import type { AdiV1Result } from "./adiV1";
import type { AnalysisPlanV1 } from "./analysisPlanV1";
import {
  buildAnalysisLearningEventsV1,
  isAnalysisLearningEventsV1,
  normalizeAnalysisLearningEventsV1,
  type AnalysisLearningEventV1,
  type AnalysisLearningEventsV1,
} from "./analysisLearningEventsV1";
import type { BsiV1Result } from "./bsiV1";
import type { DeepSearchResultsV1Result } from "./deepSearchResultsV1";
import {
  parseProductGameResultV1,
  parseProductGameResultV1FromSgf,
  type ProductColorV1,
  type ProductDecisiveMoveV1,
  type ProductGameResultV1,
  type ProductReviewMoveV1,
} from "./analysisProductEventsV1";
import { buildProductDecisiveMoveV1 } from "./decisiveMoveSelectorV1";
import {
  buildExplanationPlanForDecisiveMoveV1,
  buildExplanationPlanForReviewMoveV1,
  type ExplanationPlanV1,
} from "./explanationPlannerV1";
import {
  buildExplanationPlanV2ForDecisiveMove,
  buildExplanationPlanV2ForReviewMove,
  type ExplanationPlanV2,
} from "./explanationPlannerV2";
import { attachConceptTagsToProductMoveV1, type ConceptTaggerOwnershipSummaryV1 } from "./conceptTaggerV1";
import { attachCandidateComparisonToProductMoveV1 } from "./candidateComparisonV1";
import type { TurnAnalysisEntrySuccessV1, TurnAnalysisEntryV1 } from "./multiTurnKatagoAnalysisV1";
import { buildProductReviewMovesV1 } from "./reviewMovesSelectorV1";
import { readSgfContentFromResultPayload } from "./sgfPlaybackV1";
import { isWinrateTimelineV1, type WinrateTimelineV1 } from "./winrateTimelineV1";

export const PRODUCT_REVIEW_WORKBENCH_V1_VERSION = "product-review-workbench-v1" as const;

export type WorkbenchStatusV1 = "ok" | "unsupported";

export type WorkbenchCandidateTraceV1 = {
  turnIndex: number;
  player: ProductColorV1 | null;
  playedMove: string | null;
  recommendedMove: string | null;
  bsiScore: number | null;
  adiScore: number | null;
  scoreLoss: number | null;
  winrateLoss: number | null;
  playedMoveRank: number | null;
  deepSearchEvidence: boolean;
  timelineContext: boolean;
  learningEventId: string | null;
  learningEventType: string | null;
  finalPositionExcluded: boolean;
  evidenceSources: string[];
};

export type WorkbenchRejectedCandidateV1 = {
  turnIndex: number;
  reasons: string[];
};

export type ProductReviewWorkbenchV1 = {
  version: typeof PRODUCT_REVIEW_WORKBENCH_V1_VERSION;
  status: WorkbenchStatusV1;
  unsupportedReason: string | null;
  gameSummary: {
    boardSize: number | null;
    totalMoves: number | null;
    komi: number | null;
    resultType: ProductGameResultV1["resultType"];
    winnerColor: ProductColorV1 | null;
    loserColor: ProductColorV1 | null;
    margin: number | null;
  };
  sourceSummary: {
    source: string | null;
    metaMock: boolean | null;
    timelineEnabled: boolean | null;
    timelineCompleted: boolean | null;
    deepSearchEnabled: boolean | null;
    deepSearchCompleted: boolean | null;
  };
  learningEventsSummary: Array<{
    turnIndex: number;
    eventType: string;
    score: number;
    confidence: string;
    evidenceSource: string[];
    finalPositionExcluded: boolean;
  }>;
  candidatePoolSummary: WorkbenchCandidateTraceV1[];
  decisiveMoveTrace: {
    selected: ProductDecisiveMoveV1 | null;
    selectedReason: string | null;
    v25EvidenceBreakdown: ProductDecisiveMoveV1["evidence"]["v25"] | null;
    conceptTagsV1: ProductDecisiveMoveV1["conceptTagsV1"];
    forbiddenConceptClaims: ProductDecisiveMoveV1["forbiddenConceptClaims"];
    candidateComparisonV1: ProductDecisiveMoveV1["candidateComparisonV1"] | null;
    loserColorRequired: boolean;
    positiveLossEvidenceRequired: boolean;
    rejectedCandidates: WorkbenchRejectedCandidateV1[];
  };
  reviewMovesTrace: {
    selected: Array<{
      turnIndex: number;
      category: string;
      rankingScore: number;
      evidence: string[];
      v25Taxonomy: string | null;
      v25EvidenceTypes: string[];
      v25Ranking: Record<string, number> | null;
      conceptTagsV1: ProductReviewMoveV1["conceptTagsV1"];
      forbiddenConceptClaims: ProductReviewMoveV1["forbiddenConceptClaims"];
      candidateComparisonV1: ProductReviewMoveV1["candidateComparisonV1"] | null;
      decisiveDuplicateExcluded: boolean;
    }>;
    playerDiversityApplied: boolean;
    rejectedCandidates: WorkbenchRejectedCandidateV1[];
  };
  explanationPlanTrace: Array<{
    targetType: string;
    turnIndex: number;
    titleKey: string;
    summaryKey: string;
    evidenceBullets: string[];
    caveats: string[];
    referenceLinePvLength: number;
  }>;
  explanationPlanV2Trace: Array<{
    audience: string;
    targetType: string;
    turnIndex: number;
    titleKey: string;
    summaryKey: string;
    bullets: string[];
    forbiddenClaims: string[];
    caveats: string[];
  }>;
  uiSummary: Array<{
    turnIndex: number;
    chipLabel: string;
    memoSummary: string;
    referenceAvailable: boolean;
    tryPlayImpact: "none";
  }>;
  safety: {
    sgfContentRedacted: boolean;
    secretLikeValuesRedacted: boolean;
    forbiddenLabelsPresent: string[];
  };
};

type CandidateAccumulator = WorkbenchCandidateTraceV1 & {
  rankingScore: number;
  reasons: Set<string>;
  evidenceSourcesSet: Set<string>;
};

const FORBIDDEN_LABELS = [
  ["패착", " ", "확정"].join(""),
  ["완착", " ", "확정"].join(""),
  ["악", "수"].join(""),
  ["정", "답"].join(""),
  ["best", " ", "move"].join(""),
  ["blun", "der"].join(""),
] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

export function unwrapProductReviewWorkbenchInputV1(data: unknown): unknown {
  if (!isPlainObject(data)) {
    return data;
  }
  if (data.source === "katago-worker-v1") {
    return data;
  }
  const inner = data.data;
  if (isPlainObject(inner) && inner.source === "katago-worker-v1") {
    return inner;
  }
  return data;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asColor(v: unknown): ProductColorV1 | null {
  return v === "B" || v === "W" ? v : null;
}

function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function nonNegative(v: unknown): number | null {
  const n = finiteNumber(v);
  return n != null && n >= 0 ? n : null;
}

function positive(v: unknown): number | null {
  const n = finiteNumber(v);
  return n != null && n > 0 ? n : null;
}

function readGameInfo(result: Record<string, unknown>): Record<string, unknown> {
  return isPlainObject(result.game_info) ? result.game_info : {};
}

function readTotalMoves(result: Record<string, unknown>): number | null {
  const gameInfo = readGameInfo(result);
  const fromGameInfo = finiteNumber(gameInfo.total_moves);
  if (fromGameInfo != null) return Math.trunc(fromGameInfo);
  const plan = isPlainObject(result.analysisPlan) ? result.analysisPlan : null;
  const fromPlan = finiteNumber(plan?.totalMoves);
  return fromPlan == null ? null : Math.trunc(fromPlan);
}

function readBoardSize(result: Record<string, unknown>): number | null {
  const plan = isPlainObject(result.analysisPlan) ? result.analysisPlan : null;
  const fromPlan = finiteNumber(plan?.boardSize);
  if (fromPlan != null) return Math.trunc(fromPlan);
  const topBoardSize = finiteNumber(result.boardSize);
  return topBoardSize == null ? null : Math.trunc(topBoardSize);
}

function readKomi(result: Record<string, unknown>): number | null {
  const gameInfo = readGameInfo(result);
  const fromGameInfo = finiteNumber(gameInfo.komi);
  if (fromGameInfo != null) return fromGameInfo;
  const plan = isPlainObject(result.analysisPlan) ? result.analysisPlan : null;
  return finiteNumber(plan?.komi);
}

function readRawResult(result: Record<string, unknown>): string | null {
  const gameInfo = readGameInfo(result);
  const value = gameInfo.result;
  return typeof value === "string" ? value : null;
}

function makeGameResult(result: Record<string, unknown>): ProductGameResultV1 {
  const sgfText = readSgfContentFromResultPayload(result);
  if (sgfText != null && sgfText.trim().length > 0) {
    return parseProductGameResultV1FromSgf(sgfText);
  }
  return parseProductGameResultV1(readRawResult(result));
}

function isFinalPosition(turnIndex: number, result: Record<string, unknown>, totalMoves: number | null): boolean {
  const plan = isPlainObject(result.analysisPlan) ? (result.analysisPlan as AnalysisPlanV1) : undefined;
  if (plan?.candidateTurns?.some((c) => c.turnIndex === turnIndex && c.reason === "final_position")) return true;
  const turnAnalyses = asArray(result.turnAnalyses) as TurnAnalysisEntryV1[];
  if (turnAnalyses.some((t) => t.turnIndex === turnIndex && "reason" in t && t.reason === "final_position")) return true;
  return totalMoves != null && turnIndex === totalMoves;
}

function scoreLossFromTurn(turn: TurnAnalysisEntrySuccessV1): number | null {
  const best = turn.moveSummary?.best;
  const played = turn.moveSummary?.played;
  if (typeof best?.scoreLead === "number" && typeof played?.scoreLead === "number") return Math.max(0, best.scoreLead - played.scoreLead);
  if (typeof best?.scoreMean === "number" && typeof played?.scoreMean === "number") return Math.max(0, best.scoreMean - played.scoreMean);
  return null;
}

function winrateLossFromTurn(turn: TurnAnalysisEntrySuccessV1): number | null {
  const best = turn.moveSummary?.best?.winrate;
  const played = turn.moveSummary?.played?.winrate;
  return typeof best === "number" && typeof played === "number" ? Math.max(0, Math.min(1, best - played)) : null;
}

function contribution(value: number | null, cap: number, weight: number): number {
  if (value == null || cap <= 0) return 0;
  return Math.min(1, value / cap) * weight;
}

function candidateFor(map: Map<number, CandidateAccumulator>, turnIndex: number): CandidateAccumulator {
  let row = map.get(turnIndex);
  if (row == null) {
    row = {
      turnIndex,
      player: null,
      playedMove: null,
      recommendedMove: null,
      bsiScore: null,
      adiScore: null,
      scoreLoss: null,
      winrateLoss: null,
      playedMoveRank: null,
      deepSearchEvidence: false,
      timelineContext: false,
      learningEventId: null,
      learningEventType: null,
      finalPositionExcluded: false,
      evidenceSources: [],
      evidenceSourcesSet: new Set(),
      rankingScore: 0,
      reasons: new Set(),
    };
    map.set(turnIndex, row);
  }
  return row;
}

function addEvidence(row: CandidateAccumulator, source: string): void {
  row.evidenceSourcesSet.add(source);
  row.evidenceSources = Array.from(row.evidenceSourcesSet).sort();
}

function maxMaybe(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function setIdentity(row: CandidateAccumulator, args: { player?: ProductColorV1 | null; playedMove?: string | null; recommendedMove?: string | null }): void {
  if (row.player == null && args.player != null) row.player = args.player;
  if (row.playedMove == null && typeof args.playedMove === "string") row.playedMove = args.playedMove;
  if (row.recommendedMove == null && typeof args.recommendedMove === "string") row.recommendedMove = args.recommendedMove;
}

function buildLearningEvents(result: Record<string, unknown>): AnalysisLearningEventsV1 {
  const analysisPlan = isPlainObject(result.analysisPlan) ? (result.analysisPlan as AnalysisPlanV1) : undefined;
  const turnAnalyses = asArray(result.turnAnalyses) as TurnAnalysisEntryV1[];
  const bsi = isPlainObject(result.bsiV1) ? (result.bsiV1 as BsiV1Result) : undefined;
  const adi = isPlainObject(result.adiV1) ? (result.adiV1 as AdiV1Result) : undefined;
  const deepSearchPlan = isPlainObject(result.deepSearchPlan) ? result.deepSearchPlan : undefined;
  const deepSearchResults = isPlainObject(result.deepSearchResults) ? (result.deepSearchResults as DeepSearchResultsV1Result) : undefined;
  const winrateTimeline = isWinrateTimelineV1(result.winrateTimelineV1) ? result.winrateTimelineV1 : undefined;
  if (isAnalysisLearningEventsV1(result.learningEventsV1)) {
    return normalizeAnalysisLearningEventsV1(result.learningEventsV1, { analysisPlan, turnAnalyses });
  }
  return buildAnalysisLearningEventsV1({
    analysisPlan,
    turnAnalyses,
    bsi,
    adi,
    deepSearchPlan: deepSearchPlan as never,
    deepSearchResults,
    winrateTimeline,
  });
}

function buildCandidatePool(result: Record<string, unknown>, learningEvents: AnalysisLearningEventsV1, totalMoves: number | null): CandidateAccumulator[] {
  const map = new Map<number, CandidateAccumulator>();
  for (const event of learningEvents.events) {
    const row = candidateFor(map, event.turnIndex);
    row.learningEventId = event.id;
    row.learningEventType = event.eventType;
    setIdentity(row, { playedMove: event.playedMove, recommendedMove: event.candidateMove });
    row.bsiScore = maxMaybe(row.bsiScore, nonNegative(event.signals.bsiScore));
    row.adiScore = maxMaybe(row.adiScore, nonNegative(event.signals.adiScore));
    row.scoreLoss = maxMaybe(row.scoreLoss, positive(event.signals.scoreLeadDelta == null ? null : Math.abs(event.signals.scoreLeadDelta)));
    row.deepSearchEvidence ||= event.signals.deepSearchCompleted === true || event.signals.deepSearchChangedTop === true;
    row.rankingScore += contribution(event.score, 100, 20);
    addEvidence(row, "learningEventsV1");
    if (event.evidence.source.includes("winrateTimelineV1")) row.timelineContext = true;
  }
  for (const turn of asArray(result.turnAnalyses) as TurnAnalysisEntryV1[]) {
    const row = candidateFor(map, turn.turnIndex);
    setIdentity(row, {
      player: asColor(turn.player),
      playedMove: turn.playedMove,
      recommendedMove: turn.status === "ok" ? turn.comparisonReady?.bestMove ?? null : null,
    });
    if (turn.status === "ok") {
      row.scoreLoss = maxMaybe(row.scoreLoss, scoreLossFromTurn(turn));
      row.winrateLoss = maxMaybe(row.winrateLoss, winrateLossFromTurn(turn));
      row.playedMoveRank = typeof turn.comparisonReady?.playedMoveRank === "number" ? turn.comparisonReady.playedMoveRank : null;
      row.rankingScore += contribution(row.scoreLoss, 10, 35) + contribution(row.winrateLoss, 0.2, 30);
      addEvidence(row, "turnAnalyses");
    }
  }
  const bsi = isPlainObject(result.bsiV1) ? (result.bsiV1 as BsiV1Result) : null;
  for (const signal of bsi?.signals ?? []) {
    const row = candidateFor(map, signal.turnIndex);
    setIdentity(row, { player: asColor(signal.player), playedMove: signal.playedMove, recommendedMove: signal.bestMove });
    row.bsiScore = maxMaybe(row.bsiScore, nonNegative(signal.bsiScore));
    row.scoreLoss = maxMaybe(row.scoreLoss, nonNegative(signal.scoreBestMinusPlayed ?? signal.scoreDelta));
    row.winrateLoss = maxMaybe(row.winrateLoss, nonNegative(signal.winrateBestMinusPlayed ?? signal.winrateDelta));
    row.rankingScore += contribution(row.bsiScore, 100, 20);
    addEvidence(row, "bsiV1");
  }
  const adi = isPlainObject(result.adiV1) ? (result.adiV1 as AdiV1Result) : null;
  for (const signal of adi?.signals ?? []) {
    const row = candidateFor(map, signal.turnIndex);
    setIdentity(row, { player: asColor(signal.player), playedMove: signal.playedMove, recommendedMove: signal.bestMove });
    row.adiScore = maxMaybe(row.adiScore, nonNegative(signal.adiScore));
    row.deepSearchEvidence ||= signal.deepSearchCandidate === true;
    row.rankingScore += contribution(row.adiScore, 1, 24);
    addEvidence(row, "adiV1");
  }
  const deep = isPlainObject(result.deepSearchResults) ? (result.deepSearchResults as DeepSearchResultsV1Result) : null;
  for (const rowResult of deep?.results ?? []) {
    const row = candidateFor(map, rowResult.turnIndex);
    setIdentity(row, {
      player: asColor(rowResult.player),
      playedMove: rowResult.playedMove,
      recommendedMove: rowResult.status === "ok" ? rowResult.comparison.deepBestMove ?? rowResult.plannedBestMove : rowResult.plannedBestMove,
    });
    if (rowResult.status === "ok") {
      row.deepSearchEvidence = true;
      row.rankingScore += rowResult.comparison.plannedBestMoveStillTop === false ? 24 : 16;
      addEvidence(row, "deepSearchResultsV1");
    }
  }
  const timeline = isWinrateTimelineV1(result.winrateTimelineV1) ? result.winrateTimelineV1 : null;
  for (const point of timeline?.points ?? []) {
    if (point.status !== "ok") continue;
    const row = candidateFor(map, point.turnIndex);
    setIdentity(row, { player: asColor(point.player), playedMove: point.playedMove });
    row.timelineContext = true;
    addEvidence(row, "winrateTimelineV1");
  }
  return Array.from(map.values())
    .map((row) => ({ ...row, finalPositionExcluded: isFinalPosition(row.turnIndex, result, totalMoves) }))
    .sort((a, b) => b.rankingScore - a.rankingScore || b.turnIndex - a.turnIndex);
}

function rejectionReasons(row: CandidateAccumulator, gameResult: ProductGameResultV1, selectedDecisive: ProductDecisiveMoveV1 | null): string[] {
  const reasons: string[] = [];
  if (row.finalPositionExcluded) reasons.push("final_position_excluded");
  if (gameResult.loserColor == null) reasons.push("no_loser_color");
  if (gameResult.loserColor != null && row.player !== gameResult.loserColor) reasons.push("not_loser_color");
  if (!((row.scoreLoss ?? 0) > 0 || (row.winrateLoss ?? 0) > 0)) reasons.push("no_positive_loss_evidence");
  if (row.evidenceSources.length === 0) reasons.push("no_product_evidence_source");
  if (selectedDecisive?.turnIndex === row.turnIndex) reasons.push("selected_as_decisive");
  return reasons.length > 0 ? reasons : ["lower_ranked_candidate"];
}

function selectedReason(move: ProductDecisiveMoveV1 | null): string | null {
  if (move == null) return null;
  const evidence = move.evidence.source.join(",");
  const losses = [move.scoreLoss != null ? "positive_score_loss" : null, move.winrateLoss != null ? "positive_winrate_loss" : null]
    .filter(Boolean)
    .join(",");
  return `loser_color=${move.player}; ${losses}; evidence=${evidence}`;
}

function ownershipForTurn(turnAnalyses: TurnAnalysisEntryV1[], turnIndex: number): ConceptTaggerOwnershipSummaryV1 | null {
  const row = turnAnalyses.find((turn) => turn.turnIndex === turnIndex);
  return row?.status === "ok" ? { available: row.katago?.hasOwnership === true } : null;
}

function buildUiSummary(decisive: ProductDecisiveMoveV1 | null, reviews: ProductReviewMoveV1[], plans: ExplanationPlanV1[]): ProductReviewWorkbenchV1["uiSummary"] {
  const moves: Array<{ role: "decisive" | "review"; turnIndex: number; pv: string[] }> = [
    ...(decisive == null ? [] : [{ role: "decisive" as const, turnIndex: decisive.turnIndex, pv: decisive.evidence.pv ?? [] }]),
    ...reviews.map((move) => ({ role: "review" as const, turnIndex: move.turnIndex, pv: move.evidence.pv ?? [] })),
  ];
  return moves.map((move) => {
    const plan = plans.find((p) => p.turnIndex === move.turnIndex);
    return {
      turnIndex: move.turnIndex,
      chipLabel: move.role === "decisive" ? "ar_label_decisive_scene_candidate" : "ar_label_product_review_candidate",
      memoSummary: plan?.summaryKey ?? "missing_explanation_plan",
      referenceAvailable: move.pv.length > 0 || (plan?.referenceLine.pv.length ?? 0) > 0,
      tryPlayImpact: "none",
    };
  });
}

function buildExplanationPlanV2Trace(plans: ExplanationPlanV2[]): ProductReviewWorkbenchV1["explanationPlanV2Trace"] {
  return plans.map((plan) => ({
    audience: plan.audience,
    targetType: plan.targetType,
    turnIndex: plan.turnIndex,
    titleKey: plan.titleKey,
    summaryKey: plan.summaryKey,
    bullets: plan.bullets.map((bullet) => bullet.type),
    forbiddenClaims: plan.forbiddenClaims,
    caveats: plan.caveats,
  }));
}

export function redactWorkbenchTextV1(input: string): string {
  return input
    .replace(/\(;\s*(?=[\s\S]{0,200}(?:FF\[|GM\[|B\[|W\[))[\s\S]*?\)\s*/g, "[REDACTED_SGF]")
    .replace(/[A-Za-z]:\\(?:[^\\\r\n]+\\)+[^\s\r\n]+/g, "[REDACTED_PATH]")
    .replace(/\/(?:Users|home|opt|usr|var)\/[^\s"'`]+/g, "[REDACTED_PATH]")
    .replace(/(?:sk|pk|rk|key|token|secret)_[A-Za-z0-9_-]{12,}/gi, "[REDACTED_SECRET]")
    .replace(/[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, "[REDACTED_TOKEN]");
}

function assertNoForbiddenLabels(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_LABELS.filter((label) => lower.includes(label.toLowerCase()));
}

export function buildProductReviewWorkbenchV1(data: unknown): ProductReviewWorkbenchV1 {
  const payload = unwrapProductReviewWorkbenchInputV1(data);
  if (!isPlainObject(payload) || payload.source !== "katago-worker-v1") {
    return unsupportedWorkbench("unsupported_source");
  }
  if ((isPlainObject(payload.meta) && payload.meta.mock === true) || payload.isMock === true) {
    return unsupportedWorkbench("mock_result_unsupported");
  }

  const result = payload;
  const totalMoves = readTotalMoves(result);
  const gameResult = makeGameResult(result);
  const learningEvents = buildLearningEvents(result);
  const learningEventsForSummary = isAnalysisLearningEventsV1(result.learningEventsV1) ? result.learningEventsV1.events : learningEvents.events;
  const turnAnalyses = asArray(result.turnAnalyses) as TurnAnalysisEntryV1[];
  const sgfText = readSgfContentFromResultPayload(result);
  const bsi = isPlainObject(result.bsiV1) ? (result.bsiV1 as BsiV1Result) : undefined;
  const adi = isPlainObject(result.adiV1) ? (result.adiV1 as AdiV1Result) : undefined;
  const deep = isPlainObject(result.deepSearchResults) ? (result.deepSearchResults as DeepSearchResultsV1Result) : undefined;
  const timeline = isWinrateTimelineV1(result.winrateTimelineV1) ? (result.winrateTimelineV1 as WinrateTimelineV1) : undefined;
  const rawDecisive = buildProductDecisiveMoveV1({ gameResult, learningEvents, turnAnalyses, bsi, adi, deepSearchResults: deep, winrateTimeline: timeline, totalMoves });
  const decisive =
    rawDecisive == null
      ? null
      : attachCandidateComparisonToProductMoveV1(
          attachConceptTagsToProductMoveV1(rawDecisive, {
            sgfText,
            totalMoves,
            ownershipSummary: ownershipForTurn(turnAnalyses, rawDecisive.turnIndex),
            ladderEvidence: false,
          })
        );
  const reviewMoves = buildProductReviewMovesV1({ gameResult, decisiveMove: decisive, learningEvents, turnAnalyses, bsi, adi, deepSearchResults: deep, winrateTimeline: timeline, totalMoves, maxMoves: 5 }).map((move) =>
    attachCandidateComparisonToProductMoveV1(
      attachConceptTagsToProductMoveV1(move, {
        sgfText,
        totalMoves,
        ownershipSummary: ownershipForTurn(turnAnalyses, move.turnIndex),
        ladderEvidence: false,
      })
    )
  );
  const plans = [
    ...(decisive == null ? [] : [buildExplanationPlanForDecisiveMoveV1(decisive)]),
    ...reviewMoves.map((move) => buildExplanationPlanForReviewMoveV1(move)),
  ];
  const plansV2 = [
    ...(decisive == null ? [] : [buildExplanationPlanV2ForDecisiveMove(decisive, "dan")]),
    ...reviewMoves.map((move) => buildExplanationPlanV2ForReviewMove(move, "dan")),
  ];
  const pool = buildCandidatePool(result, learningEvents, totalMoves);
  const decisiveRejected = pool
    .filter((row) => row.turnIndex !== decisive?.turnIndex)
    .map((row) => ({ turnIndex: row.turnIndex, reasons: rejectionReasons(row, gameResult, decisive) }));
  const reviewSelectedTurns = new Set(reviewMoves.map((m) => m.turnIndex));
  const reviewRejected = pool
    .filter((row) => !reviewSelectedTurns.has(row.turnIndex))
    .map((row) => ({
      turnIndex: row.turnIndex,
      reasons: [
        ...(row.finalPositionExcluded ? ["final_position_excluded"] : []),
        ...(decisive?.turnIndex === row.turnIndex ? ["decisive_duplicate_excluded"] : []),
        ...(row.evidenceSources.length === 0 ? ["no_product_evidence_source"] : []),
        ...(!row.finalPositionExcluded && decisive?.turnIndex !== row.turnIndex && row.evidenceSources.length > 0 ? ["lower_ranked_or_diversity_limit"] : []),
      ],
    }));

  const report: ProductReviewWorkbenchV1 = {
    version: PRODUCT_REVIEW_WORKBENCH_V1_VERSION,
    status: "ok",
    unsupportedReason: null,
    gameSummary: {
      boardSize: readBoardSize(result),
      totalMoves,
      komi: readKomi(result),
      resultType: gameResult.resultType,
      winnerColor: gameResult.winnerColor,
      loserColor: gameResult.loserColor,
      margin: gameResult.margin,
    },
    sourceSummary: {
      source: typeof result.source === "string" ? result.source : null,
      metaMock: isPlainObject(result.meta) && typeof result.meta.mock === "boolean" ? result.meta.mock : null,
      timelineEnabled: isPlainObject(result.winrateTimelineV1) && typeof result.winrateTimelineV1.enabled === "boolean" ? result.winrateTimelineV1.enabled : null,
      timelineCompleted: isPlainObject(result.winrateTimelineV1) && typeof result.winrateTimelineV1.completedCount === "number" ? result.winrateTimelineV1.completedCount > 0 : null,
      deepSearchEnabled: deep?.enabled ?? null,
      deepSearchCompleted: typeof deep?.completedCount === "number" ? deep.completedCount > 0 : null,
    },
    learningEventsSummary: learningEventsForSummary.map((event: AnalysisLearningEventV1) => ({
      turnIndex: event.turnIndex,
      eventType: event.eventType,
      score: event.score,
      confidence: event.confidence,
      evidenceSource: event.evidence.source,
      finalPositionExcluded: isFinalPosition(event.turnIndex, result, totalMoves),
    })),
    candidatePoolSummary: pool.map(({ rankingScore: _rankingScore, reasons: _reasons, evidenceSourcesSet: _sources, ...row }) => row),
    decisiveMoveTrace: {
      selected: decisive,
      selectedReason: selectedReason(decisive),
      v25EvidenceBreakdown: decisive?.evidence.v25 ?? null,
      conceptTagsV1: decisive?.conceptTagsV1 ?? [],
      forbiddenConceptClaims: decisive?.forbiddenConceptClaims ?? [],
      candidateComparisonV1: decisive?.candidateComparisonV1 ?? null,
      loserColorRequired: gameResult.loserColor != null,
      positiveLossEvidenceRequired: true,
      rejectedCandidates: decisiveRejected,
    },
    reviewMovesTrace: {
      selected: reviewMoves.map((move) => ({
        turnIndex: move.turnIndex,
        category: move.category,
        rankingScore: move.evidence.v25?.rankingScore ?? pool.find((row) => row.turnIndex === move.turnIndex)?.rankingScore ?? 0,
        evidence: move.evidence.source,
        v25Taxonomy: move.evidence.v25?.taxonomy ?? null,
        v25EvidenceTypes: move.evidence.v25?.evidenceTypes ?? [],
        v25Ranking: move.evidence.v25?.ranking ?? null,
        conceptTagsV1: move.conceptTagsV1 ?? [],
        forbiddenConceptClaims: move.forbiddenConceptClaims ?? [],
        candidateComparisonV1: move.candidateComparisonV1 ?? null,
        decisiveDuplicateExcluded: decisive?.turnIndex === move.turnIndex,
      })),
      playerDiversityApplied: new Set(reviewMoves.map((move) => move.player)).size > 1,
      rejectedCandidates: reviewRejected,
    },
    explanationPlanTrace: plans.map((plan) => ({
      targetType: plan.targetType,
      turnIndex: plan.turnIndex,
      titleKey: plan.titleKey,
      summaryKey: plan.summaryKey,
      evidenceBullets: plan.evidenceBullets.map((bullet) => bullet.type),
      caveats: plan.caveats,
      referenceLinePvLength: plan.referenceLine.pv.length,
    })),
    explanationPlanV2Trace: buildExplanationPlanV2Trace(plansV2),
    uiSummary: buildUiSummary(decisive, reviewMoves, plans),
    safety: {
      sgfContentRedacted: true,
      secretLikeValuesRedacted: true,
      forbiddenLabelsPresent: [],
    },
  };
  const forbidden = assertNoForbiddenLabels(redactWorkbenchTextV1(JSON.stringify(report)));
  report.safety.forbiddenLabelsPresent = forbidden;
  return report;
}

function unsupportedWorkbench(reason: string): ProductReviewWorkbenchV1 {
  return {
    version: PRODUCT_REVIEW_WORKBENCH_V1_VERSION,
    status: "unsupported",
    unsupportedReason: reason,
    gameSummary: { boardSize: null, totalMoves: null, komi: null, resultType: "unknown", winnerColor: null, loserColor: null, margin: null },
    sourceSummary: { source: null, metaMock: null, timelineEnabled: null, timelineCompleted: null, deepSearchEnabled: null, deepSearchCompleted: null },
    learningEventsSummary: [],
    candidatePoolSummary: [],
    decisiveMoveTrace: { selected: null, selectedReason: null, v25EvidenceBreakdown: null, conceptTagsV1: [], forbiddenConceptClaims: [], candidateComparisonV1: null, loserColorRequired: false, positiveLossEvidenceRequired: true, rejectedCandidates: [] },
    reviewMovesTrace: { selected: [], playerDiversityApplied: false, rejectedCandidates: [] },
    explanationPlanTrace: [],
    explanationPlanV2Trace: [],
    uiSummary: [],
    safety: { sgfContentRedacted: true, secretLikeValuesRedacted: true, forbiddenLabelsPresent: [] },
  };
}

function mdValue(v: unknown): string {
  if (v == null) return "null";
  if (Array.isArray(v)) return v.length === 0 ? "[]" : v.join(", ");
  return String(v);
}

export function renderProductReviewWorkbenchMarkdownV1(report: ProductReviewWorkbenchV1): string {
  const lines: string[] = [];
  lines.push("# Local Algorithm Workbench v1");
  lines.push("");
  lines.push(`- version: \`${report.version}\``);
  lines.push(`- status: \`${report.status}\``);
  if (report.unsupportedReason != null) lines.push(`- unsupportedReason: \`${report.unsupportedReason}\``);
  lines.push("");
  lines.push("## Game Summary");
  for (const [key, value] of Object.entries(report.gameSummary)) lines.push(`- ${key}: \`${mdValue(value)}\``);
  lines.push("");
  lines.push("## Source Summary");
  for (const [key, value] of Object.entries(report.sourceSummary)) lines.push(`- ${key}: \`${mdValue(value)}\``);
  lines.push("");
  lines.push("## Learning Events Summary");
  for (const event of report.learningEventsSummary) {
    lines.push(`- #${event.turnIndex}: ${event.eventType}, score=${event.score}, confidence=${event.confidence}, sources=${event.evidenceSource.join(",")}, finalExcluded=${event.finalPositionExcluded}`);
  }
  if (report.learningEventsSummary.length === 0) lines.push("- none");
  lines.push("");
  lines.push("## Candidate Pool Summary");
  for (const c of report.candidatePoolSummary) {
    lines.push(`- #${c.turnIndex}: player=${mdValue(c.player)}, played=${mdValue(c.playedMove)}, recommended=${mdValue(c.recommendedMove)}, bsi=${mdValue(c.bsiScore)}, adi=${mdValue(c.adiScore)}, scoreLoss=${mdValue(c.scoreLoss)}, winrateLoss=${mdValue(c.winrateLoss)}, rank=${mdValue(c.playedMoveRank)}, deep=${c.deepSearchEvidence}, timeline=${c.timelineContext}, finalExcluded=${c.finalPositionExcluded}, sources=${c.evidenceSources.join(",")}`);
  }
  if (report.candidatePoolSummary.length === 0) lines.push("- none");
  lines.push("");
  lines.push("## DecisiveMove Trace");
  lines.push(`- selected: \`${report.decisiveMoveTrace.selected?.turnIndex ?? "null"}\``);
  lines.push(`- selectedReason: \`${mdValue(report.decisiveMoveTrace.selectedReason)}\``);
  lines.push(`- v25Taxonomy: \`${mdValue(report.decisiveMoveTrace.v25EvidenceBreakdown?.taxonomy ?? null)}\``);
  lines.push(`- v25EvidenceTypes: \`${mdValue(report.decisiveMoveTrace.v25EvidenceBreakdown?.evidenceTypes ?? [])}\``);
  lines.push(`- v25RankingScore: \`${mdValue(report.decisiveMoveTrace.v25EvidenceBreakdown?.rankingScore ?? null)}\``);
  lines.push(`- conceptTagsV1: \`${mdValue(report.decisiveMoveTrace.conceptTagsV1?.map((tag) => `${tag.tag}:${tag.confidence}`) ?? [])}\``);
  lines.push(`- forbiddenConceptClaims: \`${mdValue(report.decisiveMoveTrace.forbiddenConceptClaims?.map((claim) => `${claim.concept}:${claim.reason}`) ?? [])}\``);
  lines.push(`- candidateComparisonV1: \`${mdValue(report.decisiveMoveTrace.candidateComparisonV1?.comparisonType ?? null)}; deltas=${mdValue(report.decisiveMoveTrace.candidateComparisonV1?.deltas.map((delta) => `${delta.type}:${delta.severity}`) ?? [])}\``);
  for (const r of report.decisiveMoveTrace.rejectedCandidates) lines.push(`- rejected #${r.turnIndex}: ${r.reasons.join(", ")}`);
  lines.push("");
  lines.push("## ReviewMoves Trace");
  for (const s of report.reviewMovesTrace.selected) lines.push(`- selected #${s.turnIndex}: category=${s.category}, taxonomy=${mdValue(s.v25Taxonomy)}, rankingScore=${Math.round(s.rankingScore * 100) / 100}, evidence=${s.evidence.join(",")}, evidenceTypes=${s.v25EvidenceTypes.join(",")}, conceptTagsV1=${mdValue(s.conceptTagsV1?.map((tag) => `${tag.tag}:${tag.confidence}`) ?? [])}, forbiddenConceptClaims=${mdValue(s.forbiddenConceptClaims?.map((claim) => `${claim.concept}:${claim.reason}`) ?? [])}, candidateComparisonV1=${mdValue(s.candidateComparisonV1?.comparisonType ?? null)}:${mdValue(s.candidateComparisonV1?.deltas.map((delta) => `${delta.type}:${delta.severity}`) ?? [])}, reservedDuplicatePenalty=${mdValue(s.v25Ranking?.duplicatePenalty ?? 0)}`);
  if (report.reviewMovesTrace.selected.length === 0) lines.push("- selected: none");
  for (const r of report.reviewMovesTrace.rejectedCandidates) lines.push(`- rejected #${r.turnIndex}: ${r.reasons.join(", ")}`);
  lines.push(`- playerDiversityApplied: \`${report.reviewMovesTrace.playerDiversityApplied}\``);
  lines.push("");
  lines.push("## ExplanationPlan Trace");
  for (const p of report.explanationPlanTrace) lines.push(`- #${p.turnIndex}: target=${p.targetType}, title=${p.titleKey}, summary=${p.summaryKey}, bullets=${p.evidenceBullets.join(",")}, caveats=${p.caveats.join(",")}, pvLength=${p.referenceLinePvLength}`);
  if (report.explanationPlanTrace.length === 0) lines.push("- none");
  lines.push("");
  lines.push("## ExplanationPlanV2 Trace");
  for (const p of report.explanationPlanV2Trace) lines.push(`- #${p.turnIndex}: audience=${p.audience}, target=${p.targetType}, title=${p.titleKey}, summary=${p.summaryKey}, bullets=${p.bullets.join(",")}, forbiddenClaims=${p.forbiddenClaims.join(",")}, caveats=${p.caveats.join(",")}`);
  if (report.explanationPlanV2Trace.length === 0) lines.push("- none");
  lines.push("");
  lines.push("## UI Summary");
  for (const ui of report.uiSummary) lines.push(`- #${ui.turnIndex}: chip=${ui.chipLabel}, memo=${ui.memoSummary}, reference=${ui.referenceAvailable}, tryPlayImpact=${ui.tryPlayImpact}`);
  if (report.uiSummary.length === 0) lines.push("- none");
  lines.push("");
  lines.push("## Safety");
  lines.push(`- sgfContentRedacted: \`${report.safety.sgfContentRedacted}\``);
  lines.push(`- secretLikeValuesRedacted: \`${report.safety.secretLikeValuesRedacted}\``);
  lines.push(`- forbiddenLabelsPresent: \`${report.safety.forbiddenLabelsPresent.join(",") || "none"}\``);
  return redactWorkbenchTextV1(lines.join("\n")) + "\n";
}
