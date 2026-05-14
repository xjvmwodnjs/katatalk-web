/**
 * Deep Search Candidate Selector v1 — ADI/BSI/analysisPlan 기반 **후보 수순만** 선정.
 * 실제 Deep Search(KataGo 추가 실행) 없음. `top_mistakes`·LLM·자연어·Concept Tagger·Q&A 없음.
 * 근거: `docs/algorithm/KataTalk_Algorithm_V2.5.md`(일부).
 */

import type { AnalysisPlanCandidateReasonV1 } from "./analysisPlanV1";

export const DEEP_SEARCH_PLAN_V1_VERSION = "deep-search-plan-v1" as const;

export const DEEP_SEARCH_PLAN_V1_COMPUTED_FROM = [
  "analysis-plan-v1",
  "multi-turn-katago-analysis-v1",
  "bsi-v1",
  "adi-v1",
] as const;

export type DeepSearchPlanPolicyModeV1 = "standard";

export type DeepSearchPlanPolicyV1 = {
  mode: DeepSearchPlanPolicyModeV1;
  maxCandidates: number;
  minAdiScore: number;
  minBsiScore: number;
};

export type DeepSearchPlanSelectionBandV1 = "low" | "medium" | "high" | "very_high";

export type DeepSearchPlanCandidateStatusV1 = "selected";

export type DeepSearchPlanCandidateV1 = {
  turnIndex: number;
  player: "B" | "W";
  playedMove: string;
  bestMove: string | null;
  selectionScore: number;
  selectionBand: DeepSearchPlanSelectionBandV1;
  reasons: string[];
  adiScore: number;
  bsiScore?: number;
  /** `analysisPlan.candidateTurns` 의 priority (0~1 정규화는 selectionScore 계산에만 사용) */
  priority: number;
  candidateReason: AnalysisPlanCandidateReasonV1;
  status: DeepSearchPlanCandidateStatusV1;
};

export type DeepSearchPlanNotSelectedV1 = {
  turnIndex: number;
  reason: string;
};

export type DeepSearchPlanV1Result = {
  version: typeof DEEP_SEARCH_PLAN_V1_VERSION;
  computedFrom: typeof DEEP_SEARCH_PLAN_V1_COMPUTED_FROM;
  policy: DeepSearchPlanPolicyV1;
  /** `candidates.length` */
  candidateCount: number;
  candidates: DeepSearchPlanCandidateV1[];
  notSelected: DeepSearchPlanNotSelectedV1[];
};
