/**
 * analysis-plan-v1 — BSI/ADI 전 단계: KataGo 다중 실행 없이 “분석 후보 턴”만 정의.
 * 근거: `docs/algorithm/KataTalk_Algorithm_V2.5.md` (전체 알고리즘은 미구현).
 */

import type {
  SgfBoardSizeSourceV1,
  SgfKomiSourceV1,
} from "./sgfKatagoParseV1";

export const ANALYSIS_PLAN_V1_VERSION = "analysis-plan-v1" as const;

export type AnalysisPlanCandidateReasonV1 =
  | "interval_sample"
  | "final_position"
  | "opening_sample";

export type AnalysisPlanCandidateTurnV1 = {
  /** 1-based 수순 (첫 착점 = 1) */
  turnIndex: number;
  player: "B" | "W";
  /** GTP 좌표 또는 `pass` (표시용, `gtpMove` 와 동일) */
  move: string;
  gtpMove: string;
  reason: AnalysisPlanCandidateReasonV1;
  /** 높을수록 유지 우선(트림 시 낮은 것부터 제거) */
  priority: number;
};

export type AnalysisPlanStrategyV1 = {
  mode: "light";
  maxTurns: number;
  includeFinalPosition: boolean;
  intervalStep: number;
  openingTurnCutoff: number;
};

export type AnalysisPlanV1 = {
  version: typeof ANALYSIS_PLAN_V1_VERSION;
  totalMoves: number;
  boardSize: number;
  /** Optional only for backward compatibility with stored analysis-plan-v1 rows. */
  boardSizeSource?: SgfBoardSizeSourceV1;
  komi: number;
  /** Optional only for backward compatibility with stored analysis-plan-v1 rows. */
  komiSource?: SgfKomiSourceV1;
  candidateTurns: AnalysisPlanCandidateTurnV1[];
  strategy: AnalysisPlanStrategyV1;
};

/** `buildAnalysisPlanV1FromSgf` / `buildAnalysisPlanV1FromParsed` 옵션 */
export type BuildAnalysisPlanV1Options = {
  mode?: "light";
  maxTurns?: number;
  includeFinalPosition?: boolean;
  /** 간격 샘플링 주기 (기본 20수마다) */
  intervalStep?: number;
  /** 이 값 이하의 수순이 간격에 걸리면 `opening_sample` + 낮은 priority */
  openingTurnCutoff?: number;
};
