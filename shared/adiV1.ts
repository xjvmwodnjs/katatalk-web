/**
 * ADI v1 — Adaptive Deepening Index (0~1 내부 signal).
 * Deep Search 실행·`top_mistakes`·자연어·LLM·Concept Tagger·Q&A 없음.
 * 근거: `docs/algorithm/KataTalk_Algorithm_V2.5.md`, Value & Search Analyzer 단계.
 */

export const ADI_V1_VERSION = "adi-v1" as const;

export const ADI_V1_COMPUTED_FROM = [
  "multi-turn-katago-analysis-v1",
  "bsi-v1",
] as const;

export type AdiV1SignalStatus = "scored" | "partial" | "insufficient_data";

/** Deep Search 필요도 band (패착 심각도 라벨 아님) */
export type AdiV1Band = "low" | "medium" | "high" | "very_high";

export type AdiV1InterpretationStatus = "provisional" | "verified";

export type AdiV1SignalComponents = {
  visitEntropy: number | null;
  rankInstability: number | null;
  tacticalPvRisk: number | null;
  /** multi-turn moveInfos 요약만으로는 소유 변동 v1 미계산 → 항상 null */
  ownershipVolatility: number | null;
  bsiNorm: number | null;
  rareUserMoveRisk: number | null;
  /** ownership 제외 후 실제 가중 합(재정규화 분모) */
  availableWeightSum: number;
};

export type AdiV1Signal = {
  turnIndex: number;
  player: "B" | "W";
  playedMove: string;
  bestMove: string | null;
  status: AdiV1SignalStatus;
  /** `insufficient_data` 일 때 생략 */
  adiScore?: number;
  adiBand?: AdiV1Band;
  /** 내부 signal — 실제 Deep Search 트리거 없음 */
  deepSearchCandidate: boolean;
  components: AdiV1SignalComponents;
  interpretationStatus: AdiV1InterpretationStatus;
};

export type AdiV1Result = {
  version: typeof ADI_V1_VERSION;
  computedFrom: typeof ADI_V1_COMPUTED_FROM;
  /** `turnAnalyses` 중 `ok` 개수( BSI `candidateCount` 와 동일 ) */
  candidateCount: number;
  scoredCount: number;
  partialCount: number;
  insufficientCount: number;
  signals: AdiV1Signal[];
};
