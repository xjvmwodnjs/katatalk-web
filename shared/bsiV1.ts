/**
 * BSI v1 — `turnAnalyses`(multi-turn KataGo raw)에서만 파생되는 **내부 수치 신호**.
 * UI 패착 판정·`top_mistakes`·자연어 해설·ADI 없음. KataGo `scoreLead`/`winrate` 관점은 별도 샘플 검증 후 확정.
 * 근거: `docs/algorithm/KataTalk_Algorithm_V2.5.md`(부분 구현).
 */

import type { AnalysisPlanCandidateReasonV1 } from "./analysisPlanV1";

export const BSI_V1_VERSION = "bsi-v1" as const;

export const BSI_V1_COMPUTED_FROM = "multi-turn-katago-analysis-v1" as const;

export type BsiV1SignalStatus = "scored" | "played_move_not_in_candidates" | "insufficient_data";

/**
 * 내부 numerical band 이름일 뿐, 사용자에게 패착·악수로 표시할 라벨이 아님.
 * `bsiBand` 와 동일 값(별칭).
 */
export type BsiV1Severity = "low" | "medium" | "high" | "critical";

export type BsiV1Confidence = "low" | "medium" | "high";

export type BsiV1ScoreMetricUsed = "scoreLead" | "scoreMean" | "none";

/** KataGo JSON 수치의 해석 축 — 흑/백 손해로 단정하지 않음 */
export type BsiV1Perspective = "katago_output" | "player_to_move_assumed" | "unknown";

export type BsiV1InterpretationStatus = "provisional" | "verified";

/** ADI·LES 전 단계로 원시·블렌드 입력 보존(raw stdout 전체 아님) */
export type BsiV1SignalComponents = {
  bestScore?: number | null;
  playedScore?: number | null;
  bestWinrate?: number | null;
  playedWinrate?: number | null;
  bestVisits?: number | null;
  playedVisits?: number | null;
  minVisits?: number | null;
  moveInfosCount: number;
  engineMaxVisits?: number | null;
  multiTurnMaxVisits?: number | null;
  playedMoveRank?: number | null;
  candidateReason?: AnalysisPlanCandidateReasonV1;
  priority?: number;
  scoreMetricUsed?: BsiV1ScoreMetricUsed;
  /** 블렌드 전 Z(손실 강도 합성, 차원 혼합) */
  zComposite?: number;
  scoreBlend?: number;
  winrateBlend?: number;
  rankBlend?: number;
  visitConfidenceNumeric?: number;
};

/** 단일 턴에 대한 value/search 신호(LLM·UI 직접 해석 금지) */
export type BsiV1Signal = {
  turnIndex: number;
  player: "B" | "W";
  playedMove: string;
  bestMove: string | null;
  playedMoveRank: number | null;
  scoreMetricUsed: BsiV1ScoreMetricUsed;
  /** KataGo `moveInfos` 행 값 기준; 흑/백 고정 해석 없음 */
  scorePerspective: BsiV1Perspective;
  winratePerspective: BsiV1Perspective;
  interpretationStatus: BsiV1InterpretationStatus;
  /**
   * best 후보 행 값 − played 후보 행 값을 0 이상으로 clamp 한 후보 간 차이.
   * 흑 집·백 집 손해로 단정하지 않음.
   */
  scoreBestMinusPlayed?: number;
  winrateBestMinusPlayed?: number;
  /** @deprecated 하위 호환 — `scoreBestMinusPlayed` 와 동일 */
  scoreDelta?: number;
  /** @deprecated 하위 호환 — `winrateBestMinusPlayed` 와 동일 */
  winrateDelta?: number;
  /** 0~1, visits 기반 가중 */
  visitConfidence?: number;
  /** 블렌드 직전 합성 지표(포화 전) */
  bsiRaw?: number;
  /** 0~100, 내부 정규화 점수 */
  bsiScore?: number;
  severity?: BsiV1Severity;
  /** `severity` 와 동일(내부 band 별칭) */
  bsiBand?: BsiV1Severity;
  confidence?: BsiV1Confidence;
  status: BsiV1SignalStatus;
  components: BsiV1SignalComponents;
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
