import type {
  BsiV1Confidence,
  BsiV1Result,
  BsiV1Severity,
  BsiV1Signal,
} from "@shared/bsiV1";
import { BSI_V1_COMPUTED_FROM, BSI_V1_VERSION } from "@shared/bsiV1";
import type {
  TurnAnalysisEntrySuccessV1,
  TurnAnalysisEntryV1,
  TurnAnalysisMoveSummaryV1,
} from "@shared/multiTurnKatagoAnalysisV1";

function pickScoreMetric(row: TurnAnalysisMoveSummaryV1 | null | undefined): number | null {
  if (!row) {
    return null;
  }
  if (typeof row.scoreLead === "number" && Number.isFinite(row.scoreLead)) {
    return row.scoreLead;
  }
  if (typeof row.scoreMean === "number" && Number.isFinite(row.scoreMean)) {
    return row.scoreMean;
  }
  return null;
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

/**
 * `turnAnalyses` OK 항목만 사용. 추가 KataGo 호출 없음.
 * `moveSummary` 가 없으면(구 데이터) `insufficient_data`.
 */
export function computeBsiV1FromTurnAnalyses(turnAnalyses: readonly TurnAnalysisEntryV1[]): BsiV1Result {
  const ok = turnAnalyses.filter((t): t is TurnAnalysisEntrySuccessV1 => t.status === "ok");
  const signals: BsiV1Signal[] = [];
  let scoredCount = 0;
  let insufficientCount = 0;

  for (const t of ok) {
    const bestMove = t.comparisonReady.bestMove;
    const playedMoveRank = t.comparisonReady.playedMoveRank;

    if (!t.comparisonReady.playedMoveFoundInCandidates) {
      signals.push({
        turnIndex: t.turnIndex,
        player: t.player,
        playedMove: t.playedMove,
        bestMove,
        playedMoveRank,
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
        status: "insufficient_data",
      });
      insufficientCount += 1;
      continue;
    }

    const bestScore = pickScoreMetric(ms.best);
    const playedScore = pickScoreMetric(ms.played);
    const bestWr = pickWinrate(ms.best);
    const playedWr = pickWinrate(ms.played);

    let scoreDelta: number | undefined;
    if (bestScore != null && playedScore != null) {
      scoreDelta = Math.max(0, bestScore - playedScore);
    }

    let winrateDelta: number | undefined;
    if (bestWr != null && playedWr != null) {
      winrateDelta = Math.max(0, bestWr - playedWr);
    }

    if (scoreDelta == null && winrateDelta == null) {
      signals.push({
        turnIndex: t.turnIndex,
        player: t.player,
        playedMove: t.playedMove,
        bestMove,
        playedMoveRank,
        status: "insufficient_data",
      });
      insufficientCount += 1;
      continue;
    }

    const rank = playedMoveRank ?? 99;
    const rankPart = rank > 1 ? Math.min(35, (rank - 1) * 10) : 0;
    const scorePart = scoreDelta != null ? Math.min(45, scoreDelta * 6) : 0;
    const wrPart = winrateDelta != null ? Math.min(40, winrateDelta * 90) : 0;
    const raw = rankPart * 0.45 + scorePart * 0.55 + wrPart * 0.5;
    const bsiScore = Math.round(Math.min(100, Math.max(0, raw)));

    const minV = minVisitsForPair(ms.best, ms.played);
    const { confidence, visitConfidence } = confidenceFromMinVisits(minV);
    const severity = severityFromBsiScore(bsiScore);

    signals.push({
      turnIndex: t.turnIndex,
      player: t.player,
      playedMove: t.playedMove,
      bestMove,
      playedMoveRank,
      ...(scoreDelta !== undefined ? { scoreDelta } : {}),
      ...(winrateDelta !== undefined ? { winrateDelta } : {}),
      visitConfidence,
      bsiScore,
      severity,
      confidence,
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
