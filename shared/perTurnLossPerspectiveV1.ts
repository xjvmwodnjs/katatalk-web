import type {
  TurnAnalysisEntrySuccessV1,
  TurnAnalysisMoveSummaryV1,
} from "./multiTurnKatagoAnalysisV1";
import type { KatagoConfiguredWinratePerspectiveV1 } from "./winratePerspectiveV1";

/**
 * Provenance for a multi-turn `moveInfos` comparison. KataGo applies
 * `reportAnalysisWinratesAs` to the per-query result, so `playerToMove` must
 * be recorded with the configured axis before a best-vs-played loss can be
 * interpreted for the player who made the move.
 */
export const PER_TURN_LOSS_PERSPECTIVE_V1_VERSION =
  "per-turn-loss-perspective-v1" as const;

export type VerifiedPerTurnLossPerspectiveV1 = {
  version: typeof PER_TURN_LOSS_PERSPECTIVE_V1_VERSION;
  configuredPerspective: Exclude<
    KatagoConfiguredWinratePerspectiveV1,
    "unknown"
  >;
  playerToMove: "B" | "W";
  status: "verified";
};

export type PerTurnMoveLossV1 = {
  interpretationStatus: "provisional" | "verified";
  scoreMetricUsed: "scoreLead" | "scoreMean" | "none";
  scoreMetricMixed: boolean;
  scoreBestMinusPlayed?: number;
  winrateBestMinusPlayed?: number;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function playerDirection(
  perspective: VerifiedPerTurnLossPerspectiveV1,
  player: "B" | "W"
): number | null {
  if (perspective.playerToMove !== player) {
    return null;
  }
  if (perspective.configuredPerspective === "side_to_move") {
    return 1;
  }
  const axisPlayer = perspective.configuredPerspective === "black" ? "B" : "W";
  return axisPlayer === player ? 1 : -1;
}

/** Normalize one candidate winrate to the queried player's perspective. */
export function normalizePerTurnCandidateWinrateForPlayerV1(
  perspective: VerifiedPerTurnLossPerspectiveV1 | undefined,
  player: "B" | "W",
  rawWinrate: unknown
): number | null {
  const raw = finiteNumber(rawWinrate);
  if (
    raw == null ||
    raw < 0 ||
    raw > 1 ||
    perspective?.version !== PER_TURN_LOSS_PERSPECTIVE_V1_VERSION ||
    perspective.status !== "verified"
  ) {
    return null;
  }
  const direction = playerDirection(perspective, player);
  return direction == null ? null : direction === 1 ? raw : 1 - raw;
}

function scoreMetric(row: TurnAnalysisMoveSummaryV1 | null | undefined): {
  metric: "scoreLead" | "scoreMean" | "none";
  value: number | null;
} {
  const scoreLead = finiteNumber(row?.scoreLead);
  if (scoreLead != null) return { metric: "scoreLead", value: scoreLead };
  const scoreMean = finiteNumber(row?.scoreMean);
  if (scoreMean != null) return { metric: "scoreMean", value: scoreMean };
  return { metric: "none", value: null };
}

/**
 * Returns losses only when the Worker persisted the axis and side-to-move
 * evidence. Legacy artifacts deliberately remain provisional; callers must
 * not infer their loss direction from raw values.
 */
export function resolvePerTurnMoveLossV1(
  turn: TurnAnalysisEntrySuccessV1
): PerTurnMoveLossV1 {
  const perspective = turn.lossPerspective;
  if (
    perspective?.version !== PER_TURN_LOSS_PERSPECTIVE_V1_VERSION ||
    perspective.status !== "verified"
  ) {
    return {
      interpretationStatus: "provisional",
      scoreMetricUsed: "none",
      scoreMetricMixed: false,
    };
  }
  const direction = playerDirection(perspective, turn.player);
  if (direction == null) {
    return {
      interpretationStatus: "provisional",
      scoreMetricUsed: "none",
      scoreMetricMixed: false,
    };
  }

  const bestScore = scoreMetric(turn.moveSummary?.best);
  const playedScore = scoreMetric(turn.moveSummary?.played);
  const scoreMetricMixed =
    bestScore.metric !== "none" &&
    playedScore.metric !== "none" &&
    bestScore.metric !== playedScore.metric;
  const scoreMetricUsed = scoreMetricMixed
    ? "none"
    : bestScore.metric === playedScore.metric
      ? bestScore.metric
      : "none";
  const scoreBestMinusPlayed =
    scoreMetricUsed !== "none" &&
    bestScore.value != null &&
    playedScore.value != null
      ? Math.max(0, direction * (bestScore.value - playedScore.value))
      : undefined;

  const bestWinrate = finiteNumber(turn.moveSummary?.best?.winrate);
  const playedWinrate = finiteNumber(turn.moveSummary?.played?.winrate);
  const winrateBestMinusPlayed =
    bestWinrate != null && playedWinrate != null
      ? Math.max(0, Math.min(1, direction * (bestWinrate - playedWinrate)))
      : undefined;

  return {
    interpretationStatus: "verified",
    scoreMetricUsed,
    scoreMetricMixed,
    ...(scoreBestMinusPlayed !== undefined ? { scoreBestMinusPlayed } : {}),
    ...(winrateBestMinusPlayed !== undefined ? { winrateBestMinusPlayed } : {}),
  };
}

export function hasVerifiedPerTurnLossPerspectiveV1(
  turnAnalyses: readonly TurnAnalysisEntrySuccessV1[] | undefined
): boolean {
  const scored = (turnAnalyses ?? []).filter(
    turn => turn.comparisonReady?.playedMoveFoundInCandidates === true
  );
  return (
    scored.length > 0 &&
    scored.every(
      turn => resolvePerTurnMoveLossV1(turn).interpretationStatus === "verified"
    )
  );
}
