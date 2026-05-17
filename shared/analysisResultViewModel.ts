/**
 * Analysis result → UI-friendly ViewModel v1.
 * 바둑판 렌더·승률 그래프 컴포넌트·LLM·top_mistakes 생성 없음.
 */

import type { AnalysisPlanCandidateReasonV1, AnalysisPlanV1 } from "./analysisPlanV1";
import type { AdiV1Result, AdiV1Signal } from "./adiV1";
import type { BsiV1Result, BsiV1Signal } from "./bsiV1";
import type { DeepSearchPlanCandidateV1, DeepSearchPlanV1Result } from "./deepSearchPlanV1";
import type { DeepSearchResultsV1Result, DeepSearchSingleResultOkV1 } from "./deepSearchResultsV1";
import {
  buildAnalysisLearningEventsV1,
  isAnalysisLearningEventsV1,
  normalizeAnalysisLearningEventsV1,
  type AnalysisLearningEventV1,
  type AnalysisLearningEventsV1,
} from "./analysisLearningEventsV1";
import {
  parseProductGameResultV1,
  parseProductGameResultV1FromSgf,
  type ProductDecisiveMoveV1,
  type ProductGameResultV1,
  type ProductReviewMoveV1,
} from "./analysisProductEventsV1";
import { buildProductDecisiveMoveV1 } from "./decisiveMoveSelectorV1";
import { buildProductReviewMovesV1 } from "./reviewMovesSelectorV1";
import {
  buildExplanationPlanForDecisiveMoveV1,
  buildExplanationPlanForReviewMoveV1,
  type ExplanationPlanV1,
} from "./explanationPlannerV1";
import type { TurnAnalysisEntryV1, TurnAnalysisEntrySuccessV1 } from "./multiTurnKatagoAnalysisV1";
import {
  buildSgfPlaybackStateV1,
  readSgfContentFromResultPayload,
  type SgfPlaybackPlaceholderV1,
  type SgfPlaybackViewModelV1,
} from "./sgfPlaybackV1";
import { normalizeWinratePerspectiveV1, type WinratePerspectivePointV1 } from "./winratePerspectiveV1";
import { isWinrateTimelineV1, type WinrateTimelinePointV1, type WinrateTimelineV1 } from "./winrateTimelineV1";

export type AnalysisResultVmWarningCodeV1 =
  | "beta_numeric_reference"
  | "mock_demo_disclaimer"
  | "unknown_result_format";

export type AnalysisResultVmWarningV1 = {
  code: AnalysisResultVmWarningCodeV1;
  params?: Record<string, string | number>;
};

/** UI 번역 키 — `translatePlaceholderMessageKey` */
export const SGF_PLACEHOLDER_NO_SOURCE = "sgf_ph_no_source";
export const SGF_PLACEHOLDER_MOCK_SCOPE = "sgf_ph_mock_scope";
export const SGF_PLACEHOLDER_UNKNOWN = "sgf_ph_unknown";

const NEUTRAL_LABEL_KEYS = [
  "ar_label_review_candidate",
  "ar_label_followup_candidate",
  "ar_label_large_delta",
  "ar_label_played_vs_candidate_gap",
] as const;

const DEFAULT_VM_WARNINGS: AnalysisResultVmWarningV1[] = [{ code: "beta_numeric_reference" }];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function isKatagoWorkerV1Payload(data: unknown): data is Record<string, unknown> {
  return isPlainObject(data) && data.source === "katago-worker-v1";
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function labelKeyForIndex(i: number): string {
  return NEUTRAL_LABEL_KEYS[i % NEUTRAL_LABEL_KEYS.length]!;
}

function turnReasonFromPlan(analysisPlan: AnalysisPlanV1 | undefined, turnIndex: number): AnalysisPlanCandidateReasonV1 | null {
  if (!analysisPlan?.candidateTurns) {
    return null;
  }
  const row = analysisPlan.candidateTurns.find((c) => c.turnIndex === turnIndex);
  return row?.reason ?? null;
}

function turnReasonFromTurnAnalyses(turnAnalyses: TurnAnalysisEntryV1[] | undefined, turnIndex: number): AnalysisPlanCandidateReasonV1 | null {
  if (!turnAnalyses) {
    return null;
  }
  const row = turnAnalyses.find((t) => t.turnIndex === turnIndex);
  return row && "reason" in row ? row.reason : null;
}

function isFinalPositionTurn(
  turnIndex: number,
  analysisPlan: AnalysisPlanV1 | undefined,
  turnAnalyses: TurnAnalysisEntryV1[] | undefined
): boolean {
  return (
    turnReasonFromPlan(analysisPlan, turnIndex) === "final_position" ||
    turnReasonFromTurnAnalyses(turnAnalyses, turnIndex) === "final_position"
  );
}

function extractPvFromTopMove(topMove: unknown): string[] {
  if (!isPlainObject(topMove)) {
    return [];
  }
  const pv = topMove.pv;
  if (!Array.isArray(pv)) {
    return [];
  }
  const out: string[] = [];
  for (const x of pv) {
    if (typeof x === "string") {
      const t = x.trim();
      if (t) {
        out.push(t);
      }
    }
  }
  return out;
}

function extractPvFromCandidateMoves(entry: TurnAnalysisEntrySuccessV1): string[] {
  const first = entry.candidateMoves?.[0];
  if (!first || typeof first.move !== "string") {
    return [];
  }
  /** pv 배열이 없을 때는 후보만 반환(길이 정보는 pvLength 로만 표현됨) */
  return [first.move];
}

function getTurnAnalysisOk(turnAnalyses: TurnAnalysisEntryV1[] | undefined, turnIndex: number): TurnAnalysisEntrySuccessV1 | null {
  if (!turnAnalyses) {
    return null;
  }
  const row = turnAnalyses.find((t) => t.turnIndex === turnIndex);
  if (!row || row.status !== "ok") {
    return null;
  }
  return row;
}

function getDeepOkRow(
  deep: DeepSearchResultsV1Result | undefined,
  turnIndex: number
): DeepSearchSingleResultOkV1 | null {
  if (!deep?.enabled || !deep.results) {
    return null;
  }
  const r = deep.results.find((x) => x.turnIndex === turnIndex && x.status === "ok");
  return r && r.status === "ok" ? r : null;
}

function findBsi(bsi: BsiV1Result | undefined, turnIndex: number): BsiV1Signal | null {
  return bsi?.signals?.find((s) => s.turnIndex === turnIndex) ?? null;
}

function findAdi(adi: AdiV1Result | undefined, turnIndex: number): AdiV1Signal | null {
  return adi?.signals?.find((s) => s.turnIndex === turnIndex) ?? null;
}

export type AnalysisResultWinratePointV1 = {
  turnIndex: number;
  player: "B" | "W" | null;
  /** KataGo 원시 0~1 (없으면 null) — mirrors `perspective.rawWinrate` */
  rawWinrate: number | null;
  /** 0~100 표시용 — mirrors `perspective.normalized.displayWinrate` */
  displayWinrate: number | null;
  displayPerspective: "katago_output";
  currentPlayer: "B" | "W" | null;
  playerToMove: "B" | "W" | null;
  confidence: "provisional" | "verified";
  /** Normalized perspective (black/white null until verified) */
  perspective: WinratePerspectivePointV1;
};

export type AnalysisResultKeyMoveCandidateV1 = {
  turnIndex: number;
  player: "B" | "W";
  playedMove: string;
  bestMove: string | null;
  /** UI에서 `translateCandidateLabelKey` */
  labelKey: string;
  bsiScore: number | null;
  adiScore: number | null;
  deepSearchSelected: boolean;
  deepSearchCompleted: boolean;
  reasons: string[];
  learningEvent?: AnalysisLearningEventV1;
  productRole?: "decisive" | "review";
};

export type AnalysisResultVariationPreviewV1 = {
  turnIndex: number;
  playedMove: string;
  bestMove: string | null;
  pv: string[];
  source: "deep-search" | "multi-turn";
};

export type AnalysisProductReviewV1 = {
  version: "product-review-v1";
  gameResult: ProductGameResultV1;
  decisiveMove: ProductDecisiveMoveV1 | null;
  reviewMoves: ProductReviewMoveV1[];
  explanationPlans: ExplanationPlanV1[];
  source: "deterministic-product-events-v1";
};

export type KatagoWorkerV1AnalysisViewModel = {
  kind: "katago-worker-v1";
  summary: {
    engine: "KataGo";
    isMock: false;
    source: "katago-worker-v1";
    totalMoves: number;
    hasMultiTurn: boolean;
    hasBsi: boolean;
    hasAdi: boolean;
    hasDeepSearchPlan: boolean;
    hasDeepSearchResults: boolean;
    deepSearchEnabled: boolean;
  };
  productReviewV1: AnalysisProductReviewV1 | null;
  graph: {
    winrateSeries: AnalysisResultWinratePointV1[];
    /** true when chart uses `winrateTimelineV1` (full mainline) */
    winrateSeriesFromTimeline: boolean;
  };
  learningEvents: AnalysisLearningEventsV1;
  keyMoveCandidates: AnalysisResultKeyMoveCandidateV1[];
  variationPreview: AnalysisResultVariationPreviewV1[];
  warnings: AnalysisResultVmWarningV1[];
  /** SGF 원문(`sgf_content`/`sgfContent`)이 있으면 재생 ViewModel, 없으면 placeholder */
  sgfPlayback: SgfPlaybackViewModelV1;
};

export type MockLegacyAnalysisViewModel = {
  kind: "mock-legacy";
  summary: {
    engine: "mock";
    isMock: true;
    source: "mock-legacy";
    totalMoves: number | null;
    hasMultiTurn: false;
    hasBsi: false;
    hasAdi: false;
    hasDeepSearchPlan: false;
    hasDeepSearchResults: false;
    deepSearchEnabled: false;
  };
  productReviewV1: null;
  graph: { winrateSeries: [], winrateSeriesFromTimeline: false };
  learningEvents: AnalysisLearningEventsV1;
  keyMoveCandidates: [];
  variationPreview: [];
  warnings: AnalysisResultVmWarningV1[];
  sgfPlayback: SgfPlaybackPlaceholderV1;
};

export type UnknownAnalysisViewModel = {
  kind: "unknown";
  summary: {
    engine: "unknown";
    isMock: boolean;
    source: string | null;
    totalMoves: null;
    hasMultiTurn: false;
    hasBsi: false;
    hasAdi: false;
    hasDeepSearchPlan: false;
    hasDeepSearchResults: false;
    deepSearchEnabled: false;
  };
  productReviewV1: null;
  graph: { winrateSeries: [], winrateSeriesFromTimeline: false };
  learningEvents: AnalysisLearningEventsV1;
  keyMoveCandidates: [];
  variationPreview: [];
  warnings: AnalysisResultVmWarningV1[];
  sgfPlayback: SgfPlaybackPlaceholderV1;
};

export type BuildAnalysisResultViewModelOpts = {
  /** null 이면 메인라인 마지막 수까지 재생 */
  selectedTurnIndex?: number | null;
};

export type AnalysisResultViewModel = KatagoWorkerV1AnalysisViewModel | MockLegacyAnalysisViewModel | UnknownAnalysisViewModel;

function timelinePointToWinrateSeriesPoint(pt: WinrateTimelinePointV1): AnalysisResultWinratePointV1 | null {
  if (pt.status !== "ok" || pt.displayWinrate == null) {
    return null;
  }
  const perspective = normalizeWinratePerspectiveV1({
    rawWinrate: pt.rawWinrate,
    turnIndex: pt.turnIndex,
    player: pt.player,
    currentPlayer: pt.currentPlayer,
    playerToMove: pt.currentPlayer,
  });
  return {
    turnIndex: pt.turnIndex,
    player: pt.player,
    rawWinrate: perspective.rawWinrate,
    displayWinrate: perspective.normalized.displayWinrate,
    displayPerspective: "katago_output",
    currentPlayer: pt.currentPlayer,
    playerToMove: pt.currentPlayer,
    confidence: "provisional",
    perspective,
  };
}

function buildWinrateSeriesFromTimeline(timeline: WinrateTimelineV1): AnalysisResultWinratePointV1[] {
  const out: AnalysisResultWinratePointV1[] = [];
  for (const pt of timeline.points) {
    const row = timelinePointToWinrateSeriesPoint(pt);
    if (row) {
      out.push(row);
    }
  }
  out.sort((a, b) => a.turnIndex - b.turnIndex);
  return out;
}

export function buildWinrateSeriesPreferTimeline(
  result: Record<string, unknown>,
  turnAnalyses: TurnAnalysisEntryV1[] | undefined,
  bsi: BsiV1Result | undefined
): { series: AnalysisResultWinratePointV1[]; fromTimeline: boolean } {
  const timelineRaw = result.winrateTimelineV1;
  if (isWinrateTimelineV1(timelineRaw) && timelineRaw.enabled && timelineRaw.completedCount > 0) {
    const series = buildWinrateSeriesFromTimeline(timelineRaw);
    if (series.length > 0) {
      return { series, fromTimeline: true };
    }
  }
  return { series: buildWinrateSeries(turnAnalyses, bsi), fromTimeline: false };
}

function buildWinrateSeries(
  turnAnalyses: TurnAnalysisEntryV1[] | undefined,
  bsi: BsiV1Result | undefined
): AnalysisResultWinratePointV1[] {
  const out: AnalysisResultWinratePointV1[] = [];
  if (!turnAnalyses) {
    return out;
  }
  const okRows = turnAnalyses.filter((t): t is TurnAnalysisEntrySuccessV1 => t.status === "ok");
  const sorted = [...okRows].sort((a, b) => a.turnIndex - b.turnIndex);
  for (const t of sorted) {
    const wr = t.moveSummary?.played?.winrate;
    const perspective = normalizeWinratePerspectiveV1({
      rawWinrate: wr,
      turnIndex: t.turnIndex,
      player: t.player,
      currentPlayer: t.player,
      playerToMove: t.player,
    });
    const bsiRow = findBsi(bsi, t.turnIndex);
    const conf = bsiRow?.interpretationStatus === "verified" ? "verified" : "provisional";
    const cp = perspective.evidence.currentPlayer ?? t.player;
    const ptm = perspective.evidence.playerToMove ?? t.player;
    out.push({
      turnIndex: t.turnIndex,
      player: t.player,
      rawWinrate: perspective.rawWinrate,
      displayWinrate: perspective.normalized.displayWinrate,
      displayPerspective: "katago_output",
      currentPlayer: cp,
      playerToMove: ptm,
      confidence: conf,
      perspective,
    });
  }
  return out;
}

function mergeReasons(planReasons: string[] | undefined, extras: string[]): string[] {
  const base = planReasons?.filter((s) => typeof s === "string" && s.trim()) ?? [];
  const seen = new Set(base.map((s) => s.trim().toLowerCase()));
  const add: string[] = [];
  for (const e of extras) {
    const k = e.trim().toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      add.push(e);
    }
  }
  return [...base, ...add];
}

function extrasFromSignals(adi?: AdiV1Signal | null, bsi?: BsiV1Signal | null): string[] {
  const r: string[] = [];
  if (adi?.adiScore != null && adi.adiScore >= 0.65) {
    r.push("signal_high_adi");
  }
  if (bsi?.bsiScore != null && bsi.bsiScore >= 45) {
    r.push("signal_bsi");
  }
  if (bsi?.playedMoveRank != null && bsi.playedMoveRank > 3) {
    r.push("played_candidate_rank_gap");
  }
  return r;
}

type CandidateAcc = {
  turnIndex: number;
  player: "B" | "W";
  playedMove: string;
  bestMove: string | null;
  selectionScore?: number;
  adiScore: number | null;
  bsiScore: number | null;
  planReasons?: string[];
  fromPlan: boolean;
};

function buildCandidateAccumulator(
  analysisPlan: AnalysisPlanV1 | undefined,
  turnAnalyses: TurnAnalysisEntryV1[] | undefined,
  plan: DeepSearchPlanV1Result | undefined,
  adi: AdiV1Result | undefined,
  bsi: BsiV1Result | undefined,
  max: number
): CandidateAcc[] {
  const byTurn = new Map<number, CandidateAcc>();
  const push = (acc: CandidateAcc) => {
    if (isFinalPositionTurn(acc.turnIndex, analysisPlan, turnAnalyses)) {
      return;
    }
    if (!byTurn.has(acc.turnIndex)) {
      byTurn.set(acc.turnIndex, acc);
    }
  };

  const planCands = plan?.candidates;
  if (Array.isArray(planCands)) {
    for (const c of planCands as DeepSearchPlanCandidateV1[]) {
      if (byTurn.size >= max) {
        break;
      }
      if (!c || typeof c.turnIndex !== "number") {
        continue;
      }
      const adiRow = findAdi(adi, c.turnIndex);
      const bsiRow = findBsi(bsi, c.turnIndex);
      push({
        turnIndex: c.turnIndex,
        player: c.player,
        playedMove: c.playedMove,
        bestMove: c.bestMove,
        selectionScore: c.selectionScore,
        adiScore: typeof c.adiScore === "number" ? c.adiScore : adiRow?.adiScore ?? null,
        bsiScore: typeof c.bsiScore === "number" ? c.bsiScore : bsiRow?.bsiScore ?? null,
        planReasons: Array.isArray(c.reasons) ? (c.reasons as string[]) : undefined,
        fromPlan: true,
      });
    }
  }

  const adiSignals = [...(adi?.signals ?? [])].filter((s) => s.status === "scored" && typeof s.adiScore === "number");
  adiSignals.sort((a, b) => (b.adiScore ?? 0) - (a.adiScore ?? 0));
  for (const s of adiSignals) {
    if (byTurn.size >= max) {
      break;
    }
    if (byTurn.has(s.turnIndex)) {
      continue;
    }
    if (isFinalPositionTurn(s.turnIndex, analysisPlan, turnAnalyses)) {
      continue;
    }
    const bsiRow = findBsi(bsi, s.turnIndex);
    push({
      turnIndex: s.turnIndex,
      player: s.player,
      playedMove: s.playedMove,
      bestMove: s.bestMove,
      selectionScore: undefined,
      adiScore: s.adiScore ?? null,
      bsiScore: bsiRow?.bsiScore ?? null,
      fromPlan: false,
    });
  }

  const bsiSignals = [...(bsi?.signals ?? [])].filter((s) => s.status === "scored" && typeof s.bsiScore === "number");
  bsiSignals.sort((a, b) => (b.bsiScore ?? 0) - (a.bsiScore ?? 0));
  for (const s of bsiSignals) {
    if (byTurn.size >= max) {
      break;
    }
    if (byTurn.has(s.turnIndex)) {
      continue;
    }
    if (isFinalPositionTurn(s.turnIndex, analysisPlan, turnAnalyses)) {
      continue;
    }
    const adiRow = findAdi(adi, s.turnIndex);
    push({
      turnIndex: s.turnIndex,
      player: s.player,
      playedMove: s.playedMove,
      bestMove: s.bestMove,
      selectionScore: undefined,
      adiScore: adiRow?.adiScore ?? null,
      bsiScore: s.bsiScore ?? null,
      fromPlan: false,
    });
  }

  const rows = Array.from(byTurn.values());
  rows.sort((a, b) => {
    const sa = a.selectionScore ?? a.adiScore ?? 0;
    const sb = b.selectionScore ?? b.adiScore ?? 0;
    if (sb !== sa) {
      return sb - sa;
    }
    const aa = a.adiScore ?? 0;
    const ab = b.adiScore ?? 0;
    if (ab !== aa) {
      return ab - aa;
    }
    const ba = a.bsiScore ?? 0;
    const bb = b.bsiScore ?? 0;
    return bb - ba;
  });
  return rows.slice(0, max);
}

function buildKeyMoveVmList(
  acc: CandidateAcc[],
  plan: DeepSearchPlanV1Result | undefined,
  deep: DeepSearchResultsV1Result | undefined,
  adi: AdiV1Result | undefined,
  bsi: BsiV1Result | undefined
): AnalysisResultKeyMoveCandidateV1[] {
  const planTurns = new Set((plan?.candidates ?? []).map((c) => c.turnIndex));
  const out: AnalysisResultKeyMoveCandidateV1[] = [];
  let i = 0;
  for (const row of acc) {
    const adiRow = findAdi(adi, row.turnIndex);
    const bsiRow = findBsi(bsi, row.turnIndex);
    const deepOk = getDeepOkRow(deep, row.turnIndex);
    const extras = extrasFromSignals(adiRow, bsiRow);
    const reasons = mergeReasons(row.planReasons, extras);
    const labelKey = labelKeyForIndex(i);
    i += 1;
    out.push({
      turnIndex: row.turnIndex,
      player: row.player,
      playedMove: row.playedMove,
      bestMove: row.bestMove,
      labelKey,
      bsiScore: row.bsiScore,
      adiScore: row.adiScore,
      deepSearchSelected: planTurns.has(row.turnIndex),
      deepSearchCompleted: deepOk != null,
      reasons,
    });
  }
  return out;
}

function playerForLearningEvent(
  event: AnalysisLearningEventV1,
  turnAnalyses: TurnAnalysisEntryV1[] | undefined,
  plan: DeepSearchPlanV1Result | undefined,
  adi: AdiV1Result | undefined,
  bsi: BsiV1Result | undefined
): "B" | "W" {
  const turn = event.turnIndex;
  const ta = turnAnalyses?.find((t) => t.turnIndex === turn);
  if (ta?.player === "B" || ta?.player === "W") {
    return ta.player;
  }
  const p = plan?.candidates?.find((c) => c.turnIndex === turn);
  if (p?.player === "B" || p?.player === "W") {
    return p.player;
  }
  const a = adi?.signals?.find((s) => s.turnIndex === turn);
  if (a?.player === "B" || a?.player === "W") {
    return a.player;
  }
  const b = bsi?.signals?.find((s) => s.turnIndex === turn);
  if (b?.player === "B" || b?.player === "W") {
    return b.player;
  }
  return turn % 2 === 1 ? "B" : "W";
}

function learningEventsToKeyMoveVmList(
  learningEvents: AnalysisLearningEventsV1,
  plan: DeepSearchPlanV1Result | undefined,
  deep: DeepSearchResultsV1Result | undefined,
  adi: AdiV1Result | undefined,
  bsi: BsiV1Result | undefined,
  turnAnalyses: TurnAnalysisEntryV1[] | undefined
): AnalysisResultKeyMoveCandidateV1[] {
  const planTurns = new Set((plan?.candidates ?? []).map((c) => c.turnIndex));
  return learningEvents.events.map((event) => {
    const deepOk = getDeepOkRow(deep, event.turnIndex);
    const adiRow = findAdi(adi, event.turnIndex);
    const bsiRow = findBsi(bsi, event.turnIndex);
    const reasons = [
      event.eventType,
      ...event.evidence.source,
      ...(event.evidence.notes ?? []),
    ];
    return {
      turnIndex: event.turnIndex,
      player: playerForLearningEvent(event, turnAnalyses, plan, adi, bsi),
      playedMove: event.playedMove ?? "—",
      bestMove: event.candidateMove,
      labelKey: event.labelKey,
      bsiScore: event.signals.bsiScore ?? bsiRow?.bsiScore ?? null,
      adiScore: event.signals.adiScore ?? adiRow?.adiScore ?? null,
      deepSearchSelected: event.signals.deepSearchSelected ?? planTurns.has(event.turnIndex),
      deepSearchCompleted: event.signals.deepSearchCompleted ?? deepOk != null,
      reasons,
      learningEvent: event,
    };
  });
}

function readRawGameResult(result: Record<string, unknown>): string | null {
  const gi = result.game_info;
  if (!isPlainObject(gi)) {
    return null;
  }
  const raw = gi.result;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  if (!isPlainObject(raw)) {
    return null;
  }
  for (const key of ["raw", "sgf", "en", "ko", "ja", "zh"]) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function buildProductGameResultForVm(result: Record<string, unknown>, sgfText: string | null): ProductGameResultV1 {
  if (sgfText != null && sgfText.trim().length > 0) {
    return parseProductGameResultV1FromSgf(sgfText);
  }
  return parseProductGameResultV1(readRawGameResult(result));
}

function productSourceReasons(source: readonly string[]): string[] {
  return source.length > 0 ? source.map((s) => `product:${s}`) : ["product:deterministic"];
}

function productMoveToKeyMoveVm(
  move: ProductDecisiveMoveV1 | ProductReviewMoveV1,
  role: "decisive" | "review",
  deep: DeepSearchResultsV1Result | undefined,
  adi: AdiV1Result | undefined,
  bsi: BsiV1Result | undefined
): AnalysisResultKeyMoveCandidateV1 {
  const deepOk = getDeepOkRow(deep, move.turnIndex);
  const adiRow = findAdi(adi, move.turnIndex);
  const bsiRow = findBsi(bsi, move.turnIndex);
  return {
    turnIndex: move.turnIndex,
    player: move.player,
    playedMove: move.playedMove ?? "—",
    bestMove: move.recommendedMove,
    labelKey: role === "decisive" ? "ar_label_decisive_scene_candidate" : "ar_label_product_review_candidate",
    bsiScore: bsiRow?.bsiScore ?? null,
    adiScore: adiRow?.adiScore ?? null,
    deepSearchSelected: move.evidence.source.includes("deepSearchResultsV1"),
    deepSearchCompleted: deepOk != null,
    reasons: productSourceReasons(move.evidence.source),
    productRole: role,
  };
}

function productReviewToKeyMoveVmList(
  productReview: AnalysisProductReviewV1,
  deep: DeepSearchResultsV1Result | undefined,
  adi: AdiV1Result | undefined,
  bsi: BsiV1Result | undefined
): AnalysisResultKeyMoveCandidateV1[] {
  const out: AnalysisResultKeyMoveCandidateV1[] = [];
  if (productReview.decisiveMove != null) {
    out.push(productMoveToKeyMoveVm(productReview.decisiveMove, "decisive", deep, adi, bsi));
  }
  for (const move of productReview.reviewMoves) {
    out.push(productMoveToKeyMoveVm(move, "review", deep, adi, bsi));
  }
  return out;
}

function buildProductReviewV1(args: {
  gameResult: ProductGameResultV1;
  learningEvents: AnalysisLearningEventsV1;
  turnAnalyses: TurnAnalysisEntryV1[] | undefined;
  bsi: BsiV1Result | undefined;
  adi: AdiV1Result | undefined;
  deepSearchResults: DeepSearchResultsV1Result | undefined;
  winrateTimeline: WinrateTimelineV1 | undefined;
  totalMoves: number;
}): AnalysisProductReviewV1 | null {
  const decisiveMove =
    args.gameResult.loserColor == null
      ? null
      : buildProductDecisiveMoveV1({
          gameResult: args.gameResult,
          learningEvents: args.learningEvents,
          turnAnalyses: args.turnAnalyses,
          bsi: args.bsi,
          adi: args.adi,
          deepSearchResults: args.deepSearchResults,
          winrateTimeline: args.winrateTimeline,
          totalMoves: args.totalMoves,
        });
  const reviewMoves = buildProductReviewMovesV1({
    gameResult: args.gameResult,
    decisiveMove,
    learningEvents: args.learningEvents,
    turnAnalyses: args.turnAnalyses,
    bsi: args.bsi,
    adi: args.adi,
    deepSearchResults: args.deepSearchResults,
    winrateTimeline: args.winrateTimeline,
    totalMoves: args.totalMoves,
    maxMoves: 5,
  });
  if (decisiveMove == null && reviewMoves.length === 0) {
    return null;
  }
  return {
    version: "product-review-v1",
    gameResult: args.gameResult,
    decisiveMove,
    reviewMoves,
    explanationPlans: [
      ...(decisiveMove == null ? [] : [buildExplanationPlanForDecisiveMoveV1(decisiveMove)]),
      ...reviewMoves.map((move) => buildExplanationPlanForReviewMoveV1(move)),
    ],
    source: "deterministic-product-events-v1",
  };
}

function buildVariationPreview(
  keys: AnalysisResultKeyMoveCandidateV1[],
  turnAnalyses: TurnAnalysisEntryV1[] | undefined,
  deep: DeepSearchResultsV1Result | undefined
): AnalysisResultVariationPreviewV1[] {
  const previews: AnalysisResultVariationPreviewV1[] = [];
  for (const k of keys) {
    const deepOk = getDeepOkRow(deep, k.turnIndex);
    if (deepOk) {
      const pv = extractPvFromTopMove(deepOk.katago.topMove);
      previews.push({
        turnIndex: k.turnIndex,
        playedMove: k.playedMove,
        bestMove: deepOk.comparison.deepBestMove ?? k.bestMove,
        pv,
        source: "deep-search",
      });
      continue;
    }
    const ta = getTurnAnalysisOk(turnAnalyses, k.turnIndex);
    if (ta) {
      let pv = extractPvFromTopMove(ta.katago?.topMove);
      if (pv.length === 0) {
        pv = extractPvFromCandidateMoves(ta);
      }
      previews.push({
        turnIndex: k.turnIndex,
        playedMove: k.playedMove,
        bestMove: ta.comparisonReady?.bestMove ?? k.bestMove,
        pv,
        source: "multi-turn",
      });
      continue;
    }
    previews.push({
      turnIndex: k.turnIndex,
      playedMove: k.playedMove,
      bestMove: k.bestMove,
      pv: [],
      source: "multi-turn",
    });
  }
  return previews;
}

function readGameTotalMoves(result: Record<string, unknown>): number {
  const gi = result.game_info;
  if (isPlainObject(gi) && typeof gi.total_moves === "number" && Number.isFinite(gi.total_moves)) {
    return Math.trunc(gi.total_moves);
  }
  const ap = result.analysisPlan;
  if (isPlainObject(ap) && typeof ap.totalMoves === "number" && Number.isFinite(ap.totalMoves)) {
    return Math.trunc(ap.totalMoves);
  }
  return 0;
}

function isMockLegacyResult(data: unknown): boolean {
  if (!isPlainObject(data)) {
    return false;
  }
  const src = data.source;
  if (isPlainObject(src) && src.mock === true) {
    return true;
  }
  return false;
}

/**
 * `GET /api/analyze/:jobId` 의 `data`(또는 `analysis_jobs.result`)를 ViewModel 로 변환.
 * `selectedTurnIndex` 는 SGF 재생 스냅샷용(결과 JSON에 `sgf_content` 가 있을 때만 반영).
 */
export function buildAnalysisResultViewModel(data: unknown, opts?: BuildAnalysisResultViewModelOpts): AnalysisResultViewModel {
  if (isKatagoWorkerV1Payload(data)) {
    const result = data;
    const analysisPlan = (isPlainObject(result.analysisPlan) ? (result.analysisPlan as AnalysisPlanV1) : undefined) ?? undefined;
    const turnAnalyses = asArray(result.turnAnalyses) as TurnAnalysisEntryV1[];
    const plan = isPlainObject(result.deepSearchPlan) ? (result.deepSearchPlan as DeepSearchPlanV1Result) : undefined;
    const deep = isPlainObject(result.deepSearchResults) ? (result.deepSearchResults as DeepSearchResultsV1Result) : undefined;
    const adi = isPlainObject(result.adiV1) ? (result.adiV1 as AdiV1Result) : undefined;
    const bsi = isPlainObject(result.bsiV1) ? (result.bsiV1 as BsiV1Result) : undefined;
    const winrateTimeline = isWinrateTimelineV1(result.winrateTimelineV1) ? result.winrateTimelineV1 : undefined;

    const totalMoves = readGameTotalMoves(result);
    const sgfText = readSgfContentFromResultPayload(result);
    const multi = result.multiTurnAnalysis;
    const hasMulti = isPlainObject(multi) && typeof multi.attemptedCount === "number" && multi.attemptedCount > 0;

    const embeddedLearningEvents = isAnalysisLearningEventsV1(result.learningEventsV1)
      ? normalizeAnalysisLearningEventsV1(result.learningEventsV1, { analysisPlan, turnAnalyses })
      : null;
    const learningEvents =
      embeddedLearningEvents ??
      buildAnalysisLearningEventsV1({
        analysisPlan,
        turnAnalyses,
        bsi,
        adi,
        deepSearchPlan: plan,
        deepSearchResults: deep,
        winrateTimeline,
      });
    const productReviewV1 = buildProductReviewV1({
      gameResult: buildProductGameResultForVm(result, sgfText),
      learningEvents,
      turnAnalyses,
      bsi,
      adi,
      deepSearchResults: deep,
      winrateTimeline,
      totalMoves,
    });
    const acc = buildCandidateAccumulator(analysisPlan, turnAnalyses, plan, adi, bsi, 5);
    const keyMoveCandidates =
      productReviewV1 != null
        ? productReviewToKeyMoveVmList(productReviewV1, deep, adi, bsi)
        : learningEvents.events.length > 0
        ? learningEventsToKeyMoveVmList(learningEvents, plan, deep, adi, bsi, turnAnalyses)
        : buildKeyMoveVmList(acc, plan, deep, adi, bsi);
    const variationPreview = buildVariationPreview(keyMoveCandidates, turnAnalyses, deep);

    const sgfPlayback: SgfPlaybackViewModelV1 =
      sgfText != null && sgfText.trim().length > 0
        ? buildSgfPlaybackStateV1({
            sgfText,
            selectedTurnIndex: opts?.selectedTurnIndex ?? null,
            totalMovesHint: totalMoves,
          })
        : {
            placeholder: true,
            messageKey: SGF_PLACEHOLDER_NO_SOURCE,
            totalMovesHint: totalMoves > 0 ? totalMoves : null,
          };

    const { series: winrateSeries, fromTimeline: winrateSeriesFromTimeline } = buildWinrateSeriesPreferTimeline(
      result,
      turnAnalyses,
      bsi
    );

    const vm: KatagoWorkerV1AnalysisViewModel = {
      kind: "katago-worker-v1",
      summary: {
        engine: "KataGo",
        isMock: false,
        source: "katago-worker-v1",
        totalMoves,
        hasMultiTurn: hasMulti,
        hasBsi: (bsi?.signals?.length ?? 0) > 0,
        hasAdi: (adi?.signals?.length ?? 0) > 0,
        hasDeepSearchPlan: (plan?.candidates?.length ?? 0) > 0,
        hasDeepSearchResults: deep != null,
        deepSearchEnabled: deep?.enabled === true,
      },
      productReviewV1,
      graph: {
        winrateSeries,
        winrateSeriesFromTimeline,
      },
      learningEvents,
      keyMoveCandidates,
      variationPreview,
      warnings: [...DEFAULT_VM_WARNINGS],
      sgfPlayback,
    };
    return vm;
  }

  if (isMockLegacyResult(data) && isPlainObject(data)) {
    const gi = data.game_info;
    const tm =
      isPlainObject(gi) && typeof gi.total_moves === "number" && Number.isFinite(gi.total_moves) ? Math.trunc(gi.total_moves) : null;
    const vm: MockLegacyAnalysisViewModel = {
      kind: "mock-legacy",
      summary: {
        engine: "mock",
        isMock: true,
        source: "mock-legacy",
        totalMoves: tm,
        hasMultiTurn: false,
        hasBsi: false,
        hasAdi: false,
        hasDeepSearchPlan: false,
        hasDeepSearchResults: false,
        deepSearchEnabled: false,
      },
      productReviewV1: null,
      graph: { winrateSeries: [], winrateSeriesFromTimeline: false },
      learningEvents: { version: "learning-events-v1", events: [] },
      keyMoveCandidates: [],
      variationPreview: [],
      warnings: [{ code: "mock_demo_disclaimer" }, { code: "beta_numeric_reference" }],
      sgfPlayback: {
        placeholder: true,
        messageKey: SGF_PLACEHOLDER_MOCK_SCOPE,
        totalMovesHint: tm,
      },
    };
    return vm;
  }

  const src = isPlainObject(data) && data.source != null ? String(data.source) : null;
  return {
    kind: "unknown",
    summary: {
      engine: "unknown",
      isMock: false,
      source: src,
      totalMoves: null,
      hasMultiTurn: false,
      hasBsi: false,
      hasAdi: false,
      hasDeepSearchPlan: false,
      hasDeepSearchResults: false,
      deepSearchEnabled: false,
    },
    graph: { winrateSeries: [], winrateSeriesFromTimeline: false },
    productReviewV1: null,
    learningEvents: { version: "learning-events-v1", events: [] },
    keyMoveCandidates: [],
    variationPreview: [],
    warnings: [{ code: "unknown_result_format" }, { code: "beta_numeric_reference" }],
    sgfPlayback: {
      placeholder: true,
      messageKey: SGF_PLACEHOLDER_UNKNOWN,
      totalMovesHint: null,
    },
  };
}
