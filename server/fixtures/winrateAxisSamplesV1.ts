/**
 * Shape-only synthetic KataGo-like slices for docs/tests.
 *
 * **Not KataGo semantic truth:** `winrate`, `player`, and `rootInfo.currentPlayer` are
 * placeholder values to exercise JSON shape and the normalizer (null B/W, no `verified`).
 * Only structural invariant enforced in tests: `query.movesBeforeCount === turnIndex - 1`.
 *
 * Real axis verification uses exports described in `docs/winrate-axis-verification.md` (S1–S5).
 */

export type WinrateAxisChecklistSlotV1 = "S1" | "S2" | "S3" | "S4" | "S5";

export type WinrateAxisSampleScenarioV1 =
  | "black_favored"
  | "white_favored"
  | "early_balanced"
  | "side_to_move_black"
  | "side_to_move_white";

export type WinrateAxisSyntheticSampleV1 = {
  id: string;
  /** Always true for entries in this file — excludes sample from verified promotion. */
  shapeOnly: true;
  /** Maps to checklist slot in docs; labels are mnemonic, not proven axis. */
  checklistSlot: WinrateAxisChecklistSlotV1;
  scenario: WinrateAxisSampleScenarioV1;
  description: string;
  turnIndex: number;
  /** SGF move color placeholder — not validated against board in shape-only mode. */
  player: "B" | "W";
  playedMoveGtp: string;
  query: { movesBeforeCount: number; boardSize: number; komi: number };
  katago: {
    rootInfo: { winrate?: number; currentPlayer?: "B" | "W"; scoreLead?: number };
    moveInfos: Array<{ move: string; winrate?: number; visits?: number }>;
  };
  /** Chart path input (`moveSummary.played.winrate`) — numeric placeholder only. */
  playedWinrate: number | null;
};

/** Shape-only S1–S5 (do not use for axis conclusions). */
export const WINRATE_AXIS_SYNTHETIC_SAMPLES_V1: readonly WinrateAxisSyntheticSampleV1[] = [
  {
    id: "shape-only-s1-black-favored",
    shapeOnly: true,
    checklistSlot: "S1",
    scenario: "black_favored",
    description: "Shape-only slot S1: high winrate fields for parser/normalizer smoke (axis unproven)",
    turnIndex: 120,
    player: "B",
    playedMoveGtp: "Q16",
    query: { movesBeforeCount: 119, boardSize: 19, komi: 6.5 },
    katago: {
      rootInfo: { winrate: 0.72, currentPlayer: "W", scoreLead: 4.2 },
      moveInfos: [
        { move: "Q16", winrate: 0.71, visits: 400 },
        { move: "D4", winrate: 0.69, visits: 380 },
      ],
    },
    playedWinrate: 0.71,
  },
  {
    id: "shape-only-s2-white-favored",
    shapeOnly: true,
    checklistSlot: "S2",
    scenario: "white_favored",
    description: "Shape-only slot S2: low winrate fields for parser/normalizer smoke (axis unproven)",
    turnIndex: 80,
    player: "W",
    playedMoveGtp: "D4",
    query: { movesBeforeCount: 79, boardSize: 19, komi: 6.5 },
    katago: {
      rootInfo: { winrate: 0.28, currentPlayer: "B", scoreLead: -3.1 },
      moveInfos: [
        { move: "D4", winrate: 0.29, visits: 350 },
        { move: "Q16", winrate: 0.27, visits: 340 },
      ],
    },
    playedWinrate: 0.29,
  },
  {
    id: "shape-only-s3-early-balanced",
    shapeOnly: true,
    checklistSlot: "S3",
    scenario: "early_balanced",
    description: "Shape-only slot S3: ~50% winrate placeholders (axis unproven)",
    turnIndex: 12,
    player: "B",
    playedMoveGtp: "Q4",
    query: { movesBeforeCount: 11, boardSize: 19, komi: 6.5 },
    katago: {
      rootInfo: { winrate: 0.51, currentPlayer: "W" },
      moveInfos: [{ move: "Q4", winrate: 0.5, visits: 200 }],
    },
    playedWinrate: 0.5,
  },
  {
    id: "shape-only-s4-stm-black",
    shapeOnly: true,
    checklistSlot: "S4",
    scenario: "side_to_move_black",
    description:
      "Shape-only slot S4: includes rootInfo.currentPlayer=B (not a verified side-to-move proof)",
    turnIndex: 40,
    player: "W",
    playedMoveGtp: "C16",
    query: { movesBeforeCount: 39, boardSize: 19, komi: 6.5 },
    katago: {
      rootInfo: { winrate: 0.55, currentPlayer: "B" },
      moveInfos: [{ move: "C16", winrate: 0.54, visits: 300 }],
    },
    playedWinrate: 0.54,
  },
  {
    id: "shape-only-s5-stm-white",
    shapeOnly: true,
    checklistSlot: "S5",
    scenario: "side_to_move_white",
    description:
      "Shape-only slot S5: includes rootInfo.currentPlayer=W (not a verified side-to-move proof)",
    turnIndex: 41,
    player: "B",
    playedMoveGtp: "D3",
    query: { movesBeforeCount: 40, boardSize: 19, komi: 6.5 },
    katago: {
      rootInfo: { winrate: 0.48, currentPlayer: "W" },
      moveInfos: [{ move: "D3", winrate: 0.47, visits: 280 }],
    },
    playedWinrate: 0.47,
  },
] as const;
