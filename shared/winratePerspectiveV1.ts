/**
 * Winrate perspective normalizer v1 — KataGo raw output → UI-safe display metadata.
 * Black/white conversion is enabled only when the Worker records the analysis
 * config's authoritative `reportAnalysisWinratesAs` value.
 *
 * ## Raw winrate input policy (v1 hardening)
 * - **Valid**: `typeof raw === "number"` and `Number.isFinite(raw)` → clamp to 0~1.
 * - **Invalid → unverified**: `null`, `undefined`, `string`, `boolean`, `NaN`, `±Infinity`, objects.
 * - **No coercion**: numeric strings (e.g. `"0.64"`) are rejected.
 * - **displayWinrate**: black winrate when the axis is verified; otherwise raw output.
 * - **status**: `verified` only for a recognized configured axis with enough evidence.
 */

export type KatagoConfiguredWinratePerspectiveV1 =
  | "black"
  | "white"
  | "side_to_move"
  | "unknown";

export type WinrateRawPerspectiveV1 =
  | "katago_output"
  | Exclude<KatagoConfiguredWinratePerspectiveV1, "unknown">;

export type WinratePerspectiveStatusV1 =
  | "unverified"
  | "katago_output_only"
  | "verified";

export type WinrateDisplayLabelKeyV1 =
  | "katagoOutputWinrate"
  | "blackWinrate"
  | "whiteWinrate";

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
  configuredPerspective?: KatagoConfiguredWinratePerspectiveV1 | null;
};

/**
 * Future `verified` promotion requirements — **not implemented** in v1.
 * Full checklist: `docs/winrate-axis-verification.md`
 */
export const WINRATE_VERIFIED_PROMOTION_REQUIREMENTS_V1 = [
  "KataGo analysis config contains exactly one recognized reportAnalysisWinratesAs value.",
  "Worker startup rejects an unreadable, missing, unsupported, or expected-value-mismatched config axis.",
  "KataGo's Analysis Engine contract states rootInfo and moveInfos values use reportAnalysisWinratesAs.",
  "side_to_move conversion requires rootInfo.currentPlayer or equivalent explicit side-to-move evidence.",
  "Black, white, side-to-move, missing-evidence, setup-stone, and pass paths are covered by regression tests.",
  "UI copy (ko/en/ja/zh) distinguishes verified black/white values from legacy raw KataGo output.",
  "Legacy results without recorded config metadata remain katago_output_only and never auto-promote.",
] as const;

/**
 * Conversion formulas implemented by `normalizeWinratePerspectiveV1` once the
 * configured axis satisfies `WINRATE_VERIFIED_PROMOTION_REQUIREMENTS_V1`.
 */
export const WINRATE_BLACK_WHITE_CONVERSION_CANDIDATES_V1 = [
  "F1: axis=black → blackWinrate=w, whiteWinrate=1-w",
  "F2: axis=white → whiteWinrate=w, blackWinrate=1-w",
  "F3: axis=sideToMove → assign w to playerToMove, 1-w to opponent",
  "Fallback: unknown axis → keep displayWinrate as raw output and do not expose B/W values",
] as const;

/**
 * Evidence field semantics (until axis verified):
 * - turnIndex: 1-based mainline move under review.
 * - player: color that played that move (from SGF).
 * - currentPlayer: KataGo rootInfo side-to-move when available; else pipeline fallback.
 * - playerToMove: intended side to move at query position; fallback evidence for side-to-move config.
 */

/** True only for finite JavaScript numbers (excludes NaN, ±Infinity). */
export function isValidRawWinrateNumber(raw: unknown): raw is number {
  return typeof raw === "number" && Number.isFinite(raw);
}

/** Clamp KataGo raw winrate to 0~1; invalid types → null */
export function clampRawWinrate01(raw: unknown): number | null {
  if (!isValidRawWinrateNumber(raw)) {
    return null;
  }
  if (raw < 0) {
    return 0;
  }
  if (raw > 1) {
    return 1;
  }
  return raw;
}

/** 0~100 display percent from 0~1 raw */
export function rawWinrate01ToDisplayPercent(
  raw01: number | null
): number | null {
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

export function normalizeKatagoConfiguredWinratePerspectiveV1(
  value: unknown
): KatagoConfiguredWinratePerspectiveV1 {
  return value === "black" || value === "white" || value === "side_to_move"
    ? value
    : "unknown";
}

function complementPercent(value: number): number {
  return Math.round((100 - value) * 100) / 100;
}

/**
 * Build perspective metadata for one chart point. Legacy callers that omit
 * `configuredPerspective` retain the conservative raw-output behavior.
 */
export function normalizeWinratePerspectiveV1(
  input: NormalizeWinratePerspectiveV1Input
): WinratePerspectivePointV1 {
  const raw01 = clampRawWinrate01(input.rawWinrate);
  const turnIndex = parseTurnIndex(input.turnIndex);
  const player = parseBw(input.player);
  const explicitCurrentPlayer = parseBw(input.currentPlayer);
  const explicitPlayerToMove = parseBw(input.playerToMove);
  const currentPlayer = explicitCurrentPlayer ?? player;
  const playerToMove = explicitPlayerToMove ?? player;
  const configuredPerspective = normalizeKatagoConfiguredWinratePerspectiveV1(
    input.configuredPerspective
  );

  const rawDisplayWinrate = rawWinrate01ToDisplayPercent(raw01);
  const hasRaw = raw01 != null;
  let blackWinrate: number | null = null;
  let whiteWinrate: number | null = null;

  if (rawDisplayWinrate != null && configuredPerspective === "black") {
    blackWinrate = rawDisplayWinrate;
    whiteWinrate = complementPercent(rawDisplayWinrate);
  } else if (rawDisplayWinrate != null && configuredPerspective === "white") {
    whiteWinrate = rawDisplayWinrate;
    blackWinrate = complementPercent(rawDisplayWinrate);
  } else if (
    rawDisplayWinrate != null &&
    configuredPerspective === "side_to_move"
  ) {
    const sideToMove = explicitCurrentPlayer ?? explicitPlayerToMove;
    if (sideToMove === "B") {
      blackWinrate = rawDisplayWinrate;
      whiteWinrate = complementPercent(rawDisplayWinrate);
    } else if (sideToMove === "W") {
      whiteWinrate = rawDisplayWinrate;
      blackWinrate = complementPercent(rawDisplayWinrate);
    }
  }

  const status: WinratePerspectiveStatusV1 = !hasRaw
    ? "unverified"
    : blackWinrate != null && whiteWinrate != null
      ? "verified"
      : "katago_output_only";
  const displayWinrate = blackWinrate ?? rawDisplayWinrate;

  return {
    rawWinrate: raw01,
    rawPerspective:
      configuredPerspective === "unknown"
        ? "katago_output"
        : configuredPerspective,
    normalized: {
      status,
      blackWinrate,
      whiteWinrate,
      displayWinrate,
      displayLabelKey:
        blackWinrate != null ? "blackWinrate" : "katagoOutputWinrate",
    },
    evidence: {
      turnIndex,
      player,
      currentPlayer,
      playerToMove,
    },
  };
}
