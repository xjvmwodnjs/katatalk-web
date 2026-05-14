/**
 * multi-turn-katago-analysis-v1 — analysisPlan 후보별 “착수 직전 국면” raw 분석 요약.
 * BSI/ADI·LLM 없음. 근거: docs/algorithm/KataTalk_Algorithm_V2.5.md (전체 미구현).
 */

import type { AnalysisPlanCandidateReasonV1 } from "./analysisPlanV1";

export const MULTI_TURN_KATAGO_ANALYSIS_V1_VERSION = "multi-turn-katago-analysis-v1" as const;

export type TurnAnalysisQueryMetaV1 = {
  movesBeforeCount: number;
  boardSize: number;
  komi: number;
};

export type TurnAnalysisComparisonReadyV1 = {
  playedMoveFoundInCandidates: boolean;
  /** moveInfos 순서 기준 1-based; 없으면 null */
  playedMoveRank: number | null;
  bestMove: string | null;
};

export type TurnAnalysisKatagoSliceV1 = {
  rootInfo: Record<string, unknown>;
  topMove: unknown | null;
  moveInfosCount: number;
  hasWinrate: boolean;
  hasScoreLead: boolean;
  hasOwnership: boolean;
};

export type TurnAnalysisEntrySuccessV1 = {
  status: "ok";
  turnIndex: number;
  player: "B" | "W";
  playedMove: string;
  reason: AnalysisPlanCandidateReasonV1;
  priority: number;
  query: TurnAnalysisQueryMetaV1;
  katago: TurnAnalysisKatagoSliceV1;
  comparisonReady: TurnAnalysisComparisonReadyV1;
};

export type TurnAnalysisEntryFailedV1 = {
  status: "failed";
  turnIndex: number;
  player: "B" | "W";
  playedMove: string;
  reason: AnalysisPlanCandidateReasonV1;
  priority: number;
  query: TurnAnalysisQueryMetaV1;
  error: string;
};

export type TurnAnalysisEntryV1 = TurnAnalysisEntrySuccessV1 | TurnAnalysisEntryFailedV1;

export type MultiTurnKatagoAnalysisMetaV1 = {
  version: typeof MULTI_TURN_KATAGO_ANALYSIS_V1_VERSION;
  candidateCount: number;
  completedCount: number;
  failedCount: number;
  maxTurnsAnalyzed: number;
};
