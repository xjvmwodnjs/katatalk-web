/**
 * multi-turn-katago-analysis-v1 — analysisPlan 후보별 “착수 직전 국면” raw 분석 요약.
 * ADI v1·BSI v1 은 `candidateMoves`·`moveSummary`·`turnAnalyses` 후처리(`shared/adiV1.ts`, `server/adiV1.ts`, `shared/bsiV1.ts`, `server/bsiV1.ts`). LLM 없음. 근거: docs/algorithm/KataTalk_Algorithm_V2.5.md.
 */

import type { AnalysisPlanCandidateReasonV1 } from "./analysisPlanV1";

export const MULTI_TURN_KATAGO_ANALYSIS_V1_VERSION = "multi-turn-katago-analysis-v1" as const;

/** KataGo `moveInfos` 한 행 요약(BSI 등 후처리용, 전체 후보 배열 미저장) */
export type TurnAnalysisMoveSummaryV1 = {
  move: string;
  winrate?: number;
  scoreLead?: number;
  scoreMean?: number;
  visits?: number;
};

export type TurnAnalysisMovePairSummaryV1 = {
  best: TurnAnalysisMoveSummaryV1 | null;
  played: TurnAnalysisMoveSummaryV1 | null;
};

/** ADI v1 용 top-N 후보 요약(raw stdout·전체 moveInfos 배열 미저장) */
export type TurnAnalysisCandidateMoveSummaryV1 = {
  move: string;
  /** `moveInfos` 배열 순서 기준 1-based */
  order: number;
  visits?: number;
  prior?: number;
  winrate?: number;
  scoreLead?: number;
  scoreMean?: number;
  pvLength: number;
};

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
  /** `moveInfos` 에서 best·played 행만 요약(추가 KataGo 호출 없음) */
  moveSummary?: TurnAnalysisMovePairSummaryV1;
  /** `moveInfos` 상위 N개만 요약(ADI v1 등; stdout 원문 저장 아님) */
  candidateMoves?: TurnAnalysisCandidateMoveSummaryV1[];
  /** 순차 모드에서 `id` 없이 `pickPrimaryAnalysisObject` 폴백을 썼을 때만 true */
  fallbackUsed?: boolean;
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
  /** `KATAGO_MULTI_TURN_MAX` 등으로 정한 상한(실제 성공 개수 아님) */
  maxTurnsRequested: number;
  /** @deprecated `maxTurnsRequested` 와 동일 의미 — 하위 호환용 */
  maxTurnsAnalyzed: number;
  candidateCount: number;
  /** 실제 multi-turn 시도 수(선택된 후보 수) */
  attemptedCount: number;
  completedCount: number;
  failedCount: number;
  /** `completedCount === 0` 이고 `failedCount > 0` 이고 시도가 있었을 때 */
  allFailed: boolean;
  /** 일부만 실패 */
  partialFailure: boolean;
  /** batch stdout 에 기대 id 집합 밖의 `id` 응답 줄 수(요약용) */
  unknownResponseIdCount?: number;
};
