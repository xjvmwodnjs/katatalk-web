/**
 * Deep Search **실행** 결과 v1 — `deepSearchPlan` 후보별 높은 visits KataGo 재분석 요약만.
 * `top_mistakes`·자연어·LLM·Concept Tagger·Q&A 없음. raw stdout·stderr 전문 DB 저장 없음.
 */

export const DEEP_SEARCH_RESULTS_V1_VERSION = "deep-search-results-v1" as const;

export const DEEP_SEARCH_RESULTS_V1_COMPUTED_FROM = ["deep-search-plan-v1"] as const;

export type DeepSearchResultsPolicyModeV1 = "sequential";

export type DeepSearchResultsPolicyV1 = {
  mode: DeepSearchResultsPolicyModeV1;
  maxCandidates: number;
  visits: number;
  timeoutMs: number;
};

export type DeepSearchResultQueryV1 = {
  movesBeforeCount: number;
  boardSize: number;
  komi: number;
  maxVisits: number;
};

export type DeepSearchResultKatagoSliceV1 = {
  rootInfo: Record<string, unknown>;
  topMove: unknown;
  moveInfosCount: number;
  hasWinrate: boolean;
  hasScoreLead: boolean;
  hasOwnership: boolean;
};

export type DeepSearchResultComparisonV1 = {
  deepBestMove: string | null;
  plannedBestMove: string | null;
  plannedBestMoveStillTop: boolean;
  playedMoveRank: number | null;
};

export type DeepSearchSingleResultOkV1 = {
  turnIndex: number;
  player: "B" | "W";
  playedMove: string;
  plannedBestMove: string | null;
  status: "ok";
  query: DeepSearchResultQueryV1;
  katago: DeepSearchResultKatagoSliceV1;
  comparison: DeepSearchResultComparisonV1;
};

export type DeepSearchSingleResultFailedV1 = {
  turnIndex: number;
  player: "B" | "W";
  playedMove: string;
  plannedBestMove: string | null;
  status: "failed";
  query: DeepSearchResultQueryV1;
  error: { code: string; message: string };
};

export type DeepSearchSingleResultV1 = DeepSearchSingleResultOkV1 | DeepSearchSingleResultFailedV1;

export type DeepSearchResultsV1Result = {
  version: typeof DEEP_SEARCH_RESULTS_V1_VERSION;
  computedFrom: typeof DEEP_SEARCH_RESULTS_V1_COMPUTED_FROM;
  enabled: boolean;
  policy: DeepSearchResultsPolicyV1;
  /** `deepSearchPlan.candidates.length` (실행 상한 전) */
  candidateCount: number;
  attemptedCount: number;
  completedCount: number;
  failedCount: number;
  partialFailure: boolean;
  allFailed: boolean;
  results: DeepSearchSingleResultV1[];
};
