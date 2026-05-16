import { describe, expect, it } from "vitest";
import type { ExplanationPlanV1 } from "@shared/explanationPlannerV1";
import {
  LLM_COMMENTARY_GUARD_V1_VERSION,
  sanitizeReferenceLineV1,
  validateAndNormalizeExplanationPlanForLlmV1,
  validateLlmCommentaryOutputV1,
} from "@shared/llmCommentaryGuardV1";

const validPlan: ExplanationPlanV1 = {
  version: "explanation-planner-v1",
  targetType: "review_move",
  turnIndex: 12,
  player: "B",
  titleKey: "ep_title_review_move_candidate",
  summaryKey: "ep_summary_review_learning_candidate",
  severity: "medium",
  confidence: "medium",
  evidenceBullets: [
    {
      type: "score_loss",
      labelKey: "ep_evidence_score_loss",
      value: 3.5,
      unit: "points",
      textKey: "ep_text_score_loss_candidate",
    },
    {
      type: "winrate_loss",
      labelKey: "ep_evidence_winrate_loss",
      value: 0.12,
      unit: "ratio",
      textKey: "ep_text_winrate_loss_candidate",
    },
    {
      type: "adi",
      labelKey: "ep_evidence_adi",
      value: null,
      unit: "none",
      textKey: "ep_text_adi_review_context",
    },
  ],
  referenceLine: {
    playedMove: "D4",
    recommendedMove: "Q16",
    pv: ["Q16", "D16", "pass"],
  },
  caveats: ["ep_caveat_candidate_not_final_judgement"],
  forbiddenLabelSafe: true,
};

const safeOutput = {
  version: LLM_COMMENTARY_GUARD_V1_VERSION,
  title: "검토 후보 장면",
  body: "근거가 있는 후보 장면을 간단히 정리합니다.",
  bullets: ["집 차이 근거와 참고 수순을 함께 확인합니다."],
  caveat: "후보 신뢰도는 확정 판정이 아닙니다.",
};

describe("llm commentary guard v1", () => {
  it("accepts valid ExplanationPlanV1 input", () => {
    const result = validateAndNormalizeExplanationPlanForLlmV1(validPlan);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.referenceLine.pv).toEqual(["Q16", "D16", "pass"]);
    }
  });

  it("rejects score_loss with unit none", () => {
    const result = validateAndNormalizeExplanationPlanForLlmV1({
      ...validPlan,
      evidenceBullets: [{ ...validPlan.evidenceBullets[0], unit: "none" }],
    });
    expect(result).toEqual({ ok: false, plan: null, issues: ["invalid_evidence_invariant"] });
  });

  it("rejects score_loss value <= 0", () => {
    const result = validateAndNormalizeExplanationPlanForLlmV1({
      ...validPlan,
      evidenceBullets: [{ ...validPlan.evidenceBullets[0], value: 0 }],
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("invalid_evidence_invariant");
  });

  it("rejects out-of-range winrate_loss values", () => {
    const result = validateAndNormalizeExplanationPlanForLlmV1({
      ...validPlan,
      evidenceBullets: [{ ...validPlan.evidenceBullets[1], value: 1.2 }],
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("invalid_evidence_invariant");
  });

  it("keeps timeline_context as context instead of loss", () => {
    const result = validateAndNormalizeExplanationPlanForLlmV1({
      ...validPlan,
      evidenceBullets: [
        {
          type: "timeline_context",
          labelKey: "ep_evidence_timeline_context",
          value: 18,
          unit: "percent",
          textKey: "ep_text_timeline_context_not_loss",
        },
      ],
      caveats: ["ep_caveat_timeline_is_context_not_loss"],
    });
    expect(result.ok).toBe(true);
  });

  it("sanitizes invalid recommendedMove to null", () => {
    const result = validateAndNormalizeExplanationPlanForLlmV1({
      ...validPlan,
      referenceLine: { ...validPlan.referenceLine, recommendedMove: "not-a-move" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.referenceLine.recommendedMove).toBeNull();
    }
  });

  it("removes invalid strings from pv", () => {
    const sanitized = sanitizeReferenceLineV1({
      playedMove: "d4",
      recommendedMove: "pass",
      pv: ["Q16", "bad", "(;GM[1];B[dd])", "t19"],
    });
    expect(sanitized).toEqual({
      playedMove: "D4",
      recommendedMove: "pass",
      pv: ["Q16", "T19"],
    });
  });

  it("rejects output with forbidden label", () => {
    const result = validateLlmCommentaryOutputV1({
      ...safeOutput,
      body: "이 수는 패착 확정입니다.",
    });
    expect(result).toEqual({ ok: false, output: null, issues: ["forbidden_label"] });
  });

  it("accepts safe structured output", () => {
    const result = validateLlmCommentaryOutputV1(safeOutput);
    expect(result.ok).toBe(true);
  });

  it("rejects raw SGF-like long payload in input or output", () => {
    const inputResult = validateAndNormalizeExplanationPlanForLlmV1({
      ...validPlan,
      caveats: ["(;GM[1]FF[4]SZ[19];B[dd];W[qq];B[pd];W[dp])"],
    });
    const outputResult = validateLlmCommentaryOutputV1({
      ...safeOutput,
      body: "(;GM[1]FF[4]SZ[19];B[dd];W[qq];B[pd];W[dp])",
    });
    expect(inputResult.ok).toBe(false);
    expect(inputResult.issues).toContain("unsafe_string_payload");
    expect(outputResult.ok).toBe(false);
    expect(outputResult.issues).toContain("unsafe_string_payload");
  });
});
