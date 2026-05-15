/**
 * Synthetic KataGo-like slices for winrate **axis verification** docs/tests.
 * Does NOT assert black/white winrate axis — only stable shapes for checklist + normalizer guards.
 */

export type WinrateAxisSampleScenarioV1 =
  | "black_favored"
  | "white_favored"
  | "early_balanced"
  | "side_to_move_black"
  | "side_to_move_white";

export type WinrateAxisSyntheticSampleV1 = {
  id: string;
  scenario: WinrateAxisSampleScenarioV1;
  description: string;
  turnIndex: number;
  player: "B" | "W";
  playedMoveGtp: string;
  query: { movesBeforeCount: number; boardSize: number; komi: number };
  katago: {
    rootInfo: { winrate?: number; currentPlayer?: "B" | "W"; scoreLead?: number };
    moveInfos: Array<{ move: string; winrate?: number; visits?: number }>;
  };
  /** Value passed to chart today (`moveSummary.played.winrate`) */
  playedWinrate: number | null;
};

/** Checklist scenarios S1–S5 (synthetic numbers for tests/docs only). */
export const WINRATE_AXIS_SYNTHETIC_SAMPLES_V1: readonly WinrateAxisSyntheticSampleV1[] = [
  {
    id: "synthetic-s1-black-favored",
    scenario: "black_favored",
    description: "Black should be ahead if winrate is black-oriented",
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
    id: "synthetic-s2-white-favored",
    scenario: "white_favored",
    description: "White should be ahead if winrate is white-oriented (or black-oriented low)",
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
    id: "synthetic-s3-early-balanced",
    scenario: "early_balanced",
    description: "Early game near 50%",
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
    id: "synthetic-s4-stm-black",
    scenario: "side_to_move_black",
    description: "rootInfo.currentPlayer is Black before the move",
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
    id: "synthetic-s5-stm-white",
    scenario: "side_to_move_white",
    description: "rootInfo.currentPlayer is White before the move",
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
