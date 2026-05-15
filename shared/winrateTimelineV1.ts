/**
 * Full-game winrate timeline v1 — KataGo `analyzeTurns` batch results (stored on job result JSON).
 */

import {
  clampRawWinrate01,
  normalizeWinratePerspectiveV1,
  rawWinrate01ToDisplayPercent,
  type WinratePerspectiveStatusV1,
} from "./winratePerspectiveV1";

export const WINRATE_TIMELINE_V1_VERSION = "winrate-timeline-v1" as const;

export type WinrateTimelinePointStatusV1 = "ok" | "failed";

export type WinrateTimelinePointV1 = {
  turnIndex: number;
  turnNumber: number;
  movesBeforeCount: number;
  player: "B" | "W" | null;
  playedMove: string | null;
  status: WinrateTimelinePointStatusV1;
  rawWinrate: number | null;
  displayWinrate: number | null;
  scoreLead: number | null;
  visits: number | null;
  currentPlayer: "B" | "W" | null;
  perspectiveStatus: WinratePerspectiveStatusV1;
  errorCode?: string;
  errorMessage?: string;
};

export type WinrateTimelinePolicyV1 = {
  mode: "full-mainline-after-each-move";
  visits: number;
  maxTurns: number;
  analyzeTurnsCount: number;
  timeoutMs: number;
  analysisPVLen: number;
  includeFinal: boolean;
};

export type WinrateTimelineV1 = {
  version: typeof WINRATE_TIMELINE_V1_VERSION;
  enabled: boolean;
  source: "katago-analyzeTurns";
  policy: WinrateTimelinePolicyV1;
  totalMoves: number;
  attemptedCount: number;
  completedCount: number;
  failedCount: number;
  partialFailure: boolean;
  allFailed: boolean;
  warningCodes?: string[];
  errorCode?: string;
  errorMessage?: string;
  points: WinrateTimelinePointV1[];
};

export type WinrateTimelineMoveV1 = { color: "B" | "W"; sgfPoint: string };

function parseBw(v: unknown): "B" | "W" | null {
  return v === "B" || v === "W" ? v : null;
}

function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function isWinrateTimelineV1(v: unknown): v is WinrateTimelineV1 {
  return (
    v != null &&
    typeof v === "object" &&
    (v as WinrateTimelineV1).version === WINRATE_TIMELINE_V1_VERSION &&
    Array.isArray((v as WinrateTimelineV1).points)
  );
}

/** turnNumber N → timeline point metadata (movesBeforeCount = N at evaluation). */
export function timelineMetaForTurnNumber(
  turnNumber: number,
  moves: readonly WinrateTimelineMoveV1[],
  playedMoveGtp: (sgfPoint: string) => string
): Pick<WinrateTimelinePointV1, "turnIndex" | "turnNumber" | "movesBeforeCount" | "player" | "playedMove"> {
  const tn = Math.trunc(turnNumber);
  if (tn <= 0) {
    return {
      turnIndex: 0,
      turnNumber: 0,
      movesBeforeCount: 0,
      player: null,
      playedMove: null,
    };
  }
  const mv = moves[tn - 1];
  if (!mv) {
    return {
      turnIndex: tn,
      turnNumber: tn,
      movesBeforeCount: tn,
      player: null,
      playedMove: null,
    };
  }
  let gtp: string | null = null;
  try {
    gtp = playedMoveGtp(mv.sgfPoint);
  } catch {
    gtp = null;
  }
  return {
    turnIndex: tn,
    turnNumber: tn,
    movesBeforeCount: tn,
    player: mv.color,
    playedMove: gtp,
  };
}

export function buildOkTimelinePointFromRootInfo(
  meta: Pick<WinrateTimelinePointV1, "turnIndex" | "turnNumber" | "movesBeforeCount" | "player" | "playedMove">,
  rootInfo: Record<string, unknown>
): WinrateTimelinePointV1 {
  const raw01 = clampRawWinrate01(rootInfo.winrate);
  const displayWinrate = rawWinrate01ToDisplayPercent(raw01);
  const currentPlayer = parseBw(rootInfo.currentPlayer);
  const perspectiveStatus: WinratePerspectiveStatusV1 =
    raw01 != null ? "katago_output_only" : "unverified";
  return {
    ...meta,
    status: "ok",
    rawWinrate: raw01,
    displayWinrate,
    scoreLead: finiteNumber(rootInfo.scoreLead) ?? finiteNumber(rootInfo.scoreMean),
    visits: finiteNumber(rootInfo.visits),
    currentPlayer,
    perspectiveStatus,
  };
}

export function buildFailedTimelinePoint(
  meta: Pick<WinrateTimelinePointV1, "turnIndex" | "turnNumber" | "movesBeforeCount" | "player" | "playedMove">,
  errorCode: string,
  errorMessage: string
): WinrateTimelinePointV1 {
  return {
    ...meta,
    status: "failed",
    rawWinrate: null,
    displayWinrate: null,
    scoreLead: null,
    visits: null,
    currentPlayer: null,
    perspectiveStatus: "unverified",
    errorCode,
    errorMessage: errorMessage.slice(0, 200),
  };
}

export function summarizeWinrateTimelineV1(points: WinrateTimelinePointV1[]): {
  completedCount: number;
  failedCount: number;
  partialFailure: boolean;
  allFailed: boolean;
} {
  const completedCount = points.filter((p) => p.status === "ok").length;
  const failedCount = points.filter((p) => p.status === "failed").length;
  const attemptedCount = points.length;
  const allFailed = attemptedCount > 0 && completedCount === 0;
  const partialFailure = failedCount > 0 && completedCount > 0;
  return { completedCount, failedCount, partialFailure, allFailed };
}
