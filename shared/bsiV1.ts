/**
 * BSI v1 — `turnAnalyses`(multi-turn KataGo raw)에서만 파생되는 수치 신호.
 * 패착/악수 단정·자연어 해설·top_mistakes 선정 없음. 근거: docs/algorithm/KataTalk_Algorithm_V2.5.md (부분 구현).
 */

export const BSI_V1_VERSION = "bsi-v1" as const;

export const BSI_V1_COMPUTED_FROM = "multi-turn-katago-analysis-v1" as const;

export type BsiV1SignalStatus = "scored" | "played_move_not_in_candidates" | "insufficient_data";

export type BsiV1Severity = "low" | "medium" | "high" | "critical";

export type BsiV1Confidence = "low" | "medium" | "high";

/** 단일 턴에 대한 value/search 신호(패착 라벨 없음) */
export type BsiV1Signal = {
  turnIndex: number;
  player: "B" | "W";
  playedMove: string;
  bestMove: string | null;
  playedMoveRank: number | null;
  /** KataGo 후보 행 간 scoreLead(우선)·scoreMean 차이의 절댓값(흑/백 집 차이 단정 없음) */
  scoreDelta?: number;
  /** 후보 행 간 winrate 차이의 절댓값(흑/백 승률 고정 해석 없음) */
  winrateDelta?: number;
  /** 0~1, 후보 visits 기반 신뢰도 보조 지표 */
  visitConfidence?: number;
  /** 0~100, v1 경량 블렌드 점수 */
  bsiScore?: number;
  severity?: BsiV1Severity;
  confidence?: BsiV1Confidence;
  status: BsiV1SignalStatus;
};

export type BsiV1Result = {
  version: typeof BSI_V1_VERSION;
  computedFrom: typeof BSI_V1_COMPUTED_FROM;
  /** `turnAnalyses` 중 `ok` 항목 수 */
  candidateCount: number;
  scoredCount: number;
  insufficientCount: number;
  signals: BsiV1Signal[];
};
