/**
 * Winrate perspective normalizer v1 — KataGo raw output → UI-safe display metadata.
 * Does not assert black/white winrates until sample-verified in a later step.
 */

export type WinrateRawPerspectiveV1 = "katago_output";

export type WinratePerspectiveStatusV1 = "unverified" | "katago_output_only" | "verified";

export type WinrateDisplayLabelKeyV1 = "katagoOutputWinrate";

export type WinrateNormalizedV1 = {
  status: WinratePerspectiveStatusV1;
  /** 0~100; null until verified black/white conversion */
  blackWinrate: number | null;
  whiteWinrate: number | null;
  /** 0~100 chart value from katago_output when available */
  displayWinrate: number | null;
  displayLabelKey: WinrateDisplayLabelKeyV1;
};

export type WinratePerspectiveEvidenceV1 = {
  turnIndex: number | null;
  player: "B" | "W" | null;
  currentPlayer: "B" | "W" | null;
  playerToMove: "B" | "W" | null;
};

export type WinratePerspectivePointV1 = {
  rawWinrate: number | null;
  rawPerspective: WinrateRawPerspectiveV1;
  normalized: WinrateNormalizedV1;
  evidence: WinratePerspectiveEvidenceV1;
};

export type NormalizeWinratePerspectiveV1Input = {
  rawWinrate: unknown;
  turnIndex?: number | null;
  player?: "B" | "W" | null;
  currentPlayer?: "B" | "W" | null;
  playerToMove?: "B" | "W" | null;
};

/** Clamp KataGo raw winrate to 0~1; invalid → null */
export function clampRawWinrate01(raw: unknown): number | null {
  if (raw == null) {
    return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return null;
  }
  if (n < 0) {
    return 0;
  }
  if (n > 1) {
    return 1;
  }
  return n;
}

/** 0~100 display percent from 0~1 raw */
export function rawWinrate01ToDisplayPercent(raw01: number | null): number | null {
  if (raw01 == null) {
    return null;
  }
  const pct = raw01 * 100;
  if (!Number.isFinite(pct)) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round(pct * 100) / 100));
}

function parseBw(v: unknown): "B" | "W" | null {
  if (v === "B" || v === "W") {
    return v;
  }
  return null;
}

function parseTurnIndex(v: unknown): number | null {
  if (v == null) {
    return null;
  }
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return n;
}

/**
 * Build perspective metadata for one chart point.
 * v1: blackWinrate/whiteWinrate stay null; display follows katago_output only.
 */
export function normalizeWinratePerspectiveV1(input: NormalizeWinratePerspectiveV1Input): WinratePerspectivePointV1 {
  const raw01 = clampRawWinrate01(input.rawWinrate);
  const turnIndex = parseTurnIndex(input.turnIndex);
  const player = parseBw(input.player);
  const currentPlayer = parseBw(input.currentPlayer) ?? player;
  const playerToMove = parseBw(input.playerToMove) ?? player;

  const displayWinrate = rawWinrate01ToDisplayPercent(raw01);
  const hasRaw = raw01 != null;
  const status: WinratePerspectiveStatusV1 = hasRaw ? "katago_output_only" : "unverified";

  return {
    rawWinrate: raw01,
    rawPerspective: "katago_output",
    normalized: {
      status,
      blackWinrate: null,
      whiteWinrate: null,
      displayWinrate,
      displayLabelKey: "katagoOutputWinrate",
    },
    evidence: {
      turnIndex,
      player,
      currentPlayer,
      playerToMove,
    },
  };
}
