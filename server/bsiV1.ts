import type {
  BsiV1Confidence,
  BsiV1Perspective,
  BsiV1Result,
  BsiV1ScoreMetricUsed,
  BsiV1Severity,
  BsiV1Signal,
  BsiV1SignalComponents,
} from "@shared/bsiV1";
import { BSI_V1_COMPUTED_FROM, BSI_V1_VERSION } from "@shared/bsiV1";
import type {
  TurnAnalysisEntrySuccessV1,
  TurnAnalysisEntryV1,
  TurnAnalysisMoveSummaryV1,
} from "@shared/multiTurnKatagoAnalysisV1";
import { resolvePerTurnMoveLossV1 } from "@shared/perTurnLossPerspectiveV1";

/** multi-turn BSI 계산 시 엔진 상한(원시 stdout 없이 메타만) */
export type BsiV1ComputeOpts = {
  engineMaxVisits?: number | null;
  multiTurnMaxVisits?: number | null;
};

const Z_EXP_SCALE = 7;
const VISIT_CONF_BASE = 0.4;
const VISIT_CONF_VISIT_WEIGHT = 0.6;

type ScoreDetail = { value: number | null; metric: BsiV1ScoreMetricUsed };

function pickScoreDetail(row: TurnAnalysisMoveSummaryV1 | null | undefined): ScoreDetail {
  if (!row) {
    return { value: null, metric: "none" };
  }
  if (typeof row.scoreLead === "number" && Number.isFinite(row.scoreLead)) {
    return { value: row.scoreLead, metric: "scoreLead" };
  }
  if (typeof row.scoreMean === "number" && Number.isFinite(row.scoreMean)) {
    return { value: row.scoreMean, metric: "scoreMean" };
  }
  return { value: null, metric: "none" };
}

/**
 * scoreLead vs scoreMean 혼합 비교 금지. 둘 다 동일 축일 때만 `scoreBestMinusPlayed`.
 */
function resolveUniformScoreDelta(bestD: ScoreDetail, playedD: ScoreDetail): {
  unifiedMetric: BsiV1ScoreMetricUsed;
  scoreMetricMixed: boolean;
  scoreBestMinusPlayed: number | undefined;
} {
  const bm = bestD.metric;
  const pm = playedD.metric;
  const mixed = bm !== "none" && pm !== "none" && bm !== pm;
  if (mixed) {
    return { unifiedMetric: "none", scoreMetricMixed: true, scoreBestMinusPlayed: undefined };
  }
  if (bm === "scoreLead" && pm === "scoreLead" && bestD.value != null && playedD.value != null) {
    return {
      unifiedMetric: "scoreLead",
      scoreMetricMixed: false,
      scoreBestMinusPlayed: Math.max(0, bestD.value - playedD.value),
    };
  }
  if (bm === "scoreMean" && pm === "scoreMean" && bestD.value != null && playedD.value != null) {
    return {
      unifiedMetric: "scoreMean",
      scoreMetricMixed: false,
      scoreBestMinusPlayed: Math.max(0, bestD.value - playedD.value),
    };
  }
  return { unifiedMetric: "none", scoreMetricMixed: false, scoreBestMinusPlayed: undefined };
}

function pickWinrate(row: TurnAnalysisMoveSummaryV1 | null | undefined): number | null {
  if (!row) {
    return null;
  }
  if (typeof row.winrate === "number" && Number.isFinite(row.winrate)) {
    return row.winrate;
  }
  return null;
}

export function severityFromBsiScore(score: number): BsiV1Severity {
  if (score >= 80) {
    return "critical";
  }
  if (score >= 60) {
    return "high";
  }
  if (score >= 30) {
    return "medium";
  }
  return "low";
}

/** visits 기반 신뢰도 라벨 + 0~1 보조값 */
export function confidenceFromMinVisits(minVisits: number): { confidence: BsiV1Confidence; visitConfidence: number } {
  const visitConfidence = Math.min(1, minVisits / 400);
  if (minVisits >= 160) {
    return { confidence: "high", visitConfidence };
  }
  if (minVisits >= 40) {
    return { confidence: "medium", visitConfidence };
  }
  return { confidence: "low", visitConfidence };
}

function minVisitsForPair(
  best: TurnAnalysisMoveSummaryV1 | null | undefined,
  played: TurnAnalysisMoveSummaryV1 | null | undefined
): number {
  const b = best?.visits;
  const p = played?.visits;
  const bv = typeof b === "number" && b > 0 ? b : null;
  const pv = typeof p === "number" && p > 0 ? p : null;
  if (bv != null && pv != null) {
    return Math.min(bv, pv);
  }
  if (bv != null) {
    return bv;
  }
  if (pv != null) {
    return pv;
  }
  return 0;
}

function basePerspectives(): {
  scorePerspective: BsiV1Perspective;
  winratePerspective: BsiV1Perspective;
} {
  return {
    scorePerspective: "katago_output",
    winratePerspective: "katago_output",
  };
}

function partialComponents(
  t: TurnAnalysisEntrySuccessV1,
  opts: BsiV1ComputeOpts | undefined,
  extra: Partial<BsiV1SignalComponents> = {}
): BsiV1SignalComponents {
  return {
    moveInfosCount: t.katago.moveInfosCount,
    candidateReason: t.reason,
    priority: t.priority,
    scoreMetricUsed: "none",
    engineMaxVisits: opts?.engineMaxVisits ?? null,
    multiTurnMaxVisits: opts?.multiTurnMaxVisits ?? null,
    playedMoveRank: t.comparisonReady.playedMoveRank,
    ...extra,
  };
}

/**
 * Z = score + winrate + rank 블렌드 후
 * `bsiRaw = (0.4 + 0.6*visitC) * (1 - exp(-Z/7))` (0~1), `bsiScore = round(clamp(100*bsiRaw,0,100))`.
 */
function blendBsi(opts: {
  scoreBestMinusPlayed: number | undefined;
  winrateBestMinusPlayed: number | undefined;
  rank: number;
  visitC: number;
}): {
  zComposite: number;
  scoreBlend: number;
  winrateBlend: number;
  rankBlend: number;
  bsiRaw: number;
  bsiScore: number;
} {
  const sLoss = opts.scoreBestMinusPlayed ?? 0;
  const wLoss = opts.winrateBestMinusPlayed ?? 0;
  const rank = opts.rank;
  const scoreBlend = Math.min(Math.max(0, sLoss) * 1.2, 14);
  const winrateBlend =
    opts.winrateBestMinusPlayed != null ? Math.min(Math.max(0, wLoss) * 45, 14) : 0;
  const rankBlend = rank > 1 ? Math.min((rank - 1) * 1.1, 12) : 0;
  const zComposite = scoreBlend + winrateBlend + rankBlend;
  const confMix = VISIT_CONF_BASE + VISIT_CONF_VISIT_WEIGHT * Math.min(1, Math.max(0, opts.visitC));
  const inner = 1 - Math.exp(-zComposite / Z_EXP_SCALE);
  const bsiRaw = confMix * inner;
  const bsiScore = Math.round(Math.min(100, Math.max(0, 100 * bsiRaw)));
  return { zComposite, scoreBlend, winrateBlend, rankBlend, bsiRaw, bsiScore };
}

/**
 * `turnAnalyses` OK 항목만 사용. 추가 KataGo 호출 없음.
 * `moveSummary` 가 없으면(구 데이터) `insufficient_data`.
 */
export function computeBsiV1FromTurnAnalyses(
  turnAnalyses: readonly TurnAnalysisEntryV1[],
  opts?: BsiV1ComputeOpts
): BsiV1Result {
  const ok = turnAnalyses.filter((t): t is TurnAnalysisEntrySuccessV1 => t.status === "ok");
  const signals: BsiV1Signal[] = [];
  let scoredCount = 0;
  let insufficientCount = 0;

  for (const t of ok) {
    const bestMove = t.comparisonReady.bestMove;
    const playedMoveRank = t.comparisonReady.playedMoveRank;
    const pers = basePerspectives();

    if (!t.comparisonReady.playedMoveFoundInCandidates) {
      signals.push({
        turnIndex: t.turnIndex,
        player: t.player,
        playedMove: t.playedMove,
        bestMove,
        playedMoveRank,
        scoreMetricUsed: "none",
        scorePerspective: "unknown",
        winratePerspective: "unknown",
        interpretationStatus: "provisional",
        components: partialComponents(t, opts),
        status: "played_move_not_in_candidates",
      });
      insufficientCount += 1;
      continue;
    }

    const ms = t.moveSummary;
    if (!ms) {
      signals.push({
        turnIndex: t.turnIndex,
        player: t.player,
        playedMove: t.playedMove,
        bestMove,
        playedMoveRank,
        scoreMetricUsed: "none",
        scorePerspective: "unknown",
        winratePerspective: "unknown",
        interpretationStatus: "provisional",
        components: partialComponents(t, opts),
        status: "insufficient_data",
      });
      insufficientCount += 1;
      continue;
    }

    const bestD = pickScoreDetail(ms.best);
    const playedD = pickScoreDetail(ms.played);
    const verifiedLoss = resolvePerTurnMoveLossV1(t);
    const rawScore = resolveUniformScoreDelta(bestD, playedD);
    const sr = verifiedLoss.interpretationStatus === "verified"
      ? {
          unifiedMetric: verifiedLoss.scoreMetricUsed,
          scoreMetricMixed: verifiedLoss.scoreMetricMixed,
          scoreBestMinusPlayed: verifiedLoss.scoreBestMinusPlayed,
        }
      : rawScore;
    const scoreMetricUsed = sr.unifiedMetric;
    const scoreBestMinusPlayed = sr.scoreBestMinusPlayed;
    const bestWr = pickWinrate(ms.best);
    const playedWr = pickWinrate(ms.played);

    const scoreMetricMeta = {
      bestScoreMetric: bestD.metric,
      playedScoreMetric: playedD.metric,
      scoreMetricMixed: sr.scoreMetricMixed,
      bestScore: bestD.value,
      playedScore: playedD.value,
    };

    let winrateBestMinusPlayed: number | undefined;
    if (verifiedLoss.interpretationStatus === "verified") {
      winrateBestMinusPlayed = verifiedLoss.winrateBestMinusPlayed;
    } else if (bestWr != null && playedWr != null) {
      winrateBestMinusPlayed = Math.max(0, bestWr - playedWr);
    }

    if (scoreBestMinusPlayed == null && winrateBestMinusPlayed == null) {
      signals.push({
        turnIndex: t.turnIndex,
        player: t.player,
        playedMove: t.playedMove,
        bestMove,
        playedMoveRank,
        scoreMetricUsed: "none",
        scorePerspective: "unknown",
        winratePerspective: "unknown",
        interpretationStatus: "provisional",
        components: partialComponents(t, opts, {
          ...scoreMetricMeta,
          bestWinrate: bestWr,
          playedWinrate: playedWr,
          bestVisits: ms.best?.visits ?? null,
          playedVisits: ms.played?.visits ?? null,
          minVisits: minVisitsForPair(ms.best, ms.played),
        }),
        status: "insufficient_data",
      });
      insufficientCount += 1;
      continue;
    }

    const rank = playedMoveRank ?? 99;
    const minV = minVisitsForPair(ms.best, ms.played);
    const { confidence, visitConfidence } = confidenceFromMinVisits(minV);
    const blend = blendBsi({
      scoreBestMinusPlayed,
      winrateBestMinusPlayed,
      rank,
      visitC: visitConfidence,
    });
    const severity = severityFromBsiScore(blend.bsiScore);

    const components: BsiV1SignalComponents = {
      moveInfosCount: t.katago.moveInfosCount,
      candidateReason: t.reason,
      priority: t.priority,
      scoreMetricUsed,
      ...scoreMetricMeta,
      engineMaxVisits: opts?.engineMaxVisits ?? null,
      multiTurnMaxVisits: opts?.multiTurnMaxVisits ?? null,
      playedMoveRank,
      bestWinrate: bestWr,
      playedWinrate: playedWr,
      bestVisits: ms.best?.visits ?? null,
      playedVisits: ms.played?.visits ?? null,
      minVisits: minV,
      zComposite: blend.zComposite,
      scoreBlend: blend.scoreBlend,
      winrateBlend: blend.winrateBlend,
      rankBlend: blend.rankBlend,
      visitConfidenceNumeric: visitConfidence,
    };

    signals.push({
      turnIndex: t.turnIndex,
      player: t.player,
      playedMove: t.playedMove,
      bestMove,
      playedMoveRank,
      scoreMetricUsed,
      ...(verifiedLoss.interpretationStatus === "verified"
        ? {
            scorePerspective: "player_to_move_assumed" as const,
            winratePerspective: "player_to_move_assumed" as const,
          }
        : pers),
      interpretationStatus: verifiedLoss.interpretationStatus,
      ...(scoreBestMinusPlayed !== undefined ? { scoreBestMinusPlayed, scoreDelta: scoreBestMinusPlayed } : {}),
      ...(winrateBestMinusPlayed !== undefined
        ? { winrateBestMinusPlayed, winrateDelta: winrateBestMinusPlayed }
        : {}),
      visitConfidence,
      bsiRaw: blend.bsiRaw,
      bsiScore: blend.bsiScore,
      severity,
      bsiBand: severity,
      confidence,
      components,
      status: "scored",
    });
    scoredCount += 1;
  }

  return {
    version: BSI_V1_VERSION,
    computedFrom: BSI_V1_COMPUTED_FROM,
    candidateCount: ok.length,
    scoredCount,
    insufficientCount,
    signals,
  };
}
