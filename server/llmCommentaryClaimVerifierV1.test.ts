import { describe, expect, it } from "vitest";
import type { ExplanationPlanV1 } from "@shared/explanationPlannerV1";
import {
  isGtpMoveOnBoardV1,
  sanitizeReferenceLineForBoardSizeV1,
  verifyLlmCommentaryClaimsV1,
} from "@shared/llmCommentaryClaimVerifierV1";
import { LLM_COMMENTARY_GUARD_V1_VERSION } from "@shared/llmCommentaryGuardV1";

const basePlan: ExplanationPlanV1 = {
  version: "explanation-planner-v1",
  targetType: "review_move",
  turnIndex: 32,
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
  body: "D4 이후 Q16 참고 수순을 보며 3.5집, 12% 근거를 함께 확인합니다.",
  bullets: ["PV에는 Q16과 D16이 포함됩니다."],
  caveat: "후보 신뢰도는 확정 판정이 아닙니다.",
};

describe("llm commentary claim verifier v1", () => {
  it("rejects out-of-board coordinates on boardSize=9", () => {
    expect(isGtpMoveOnBoardV1("J10", 9)).toBe(false);
    const result = verifyLlmCommentaryClaimsV1({
      plan: { ...basePlan, referenceLine: { playedMove: "D4", recommendedMove: "J10", pv: [] } },
      boardSize: 9,
      output: { ...safeOutput, body: "J10을 참고합니다." },
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("unknown_coordinate_claim");
  });

  it("rejects out-of-board coordinates on boardSize=13", () => {
    expect(isGtpMoveOnBoardV1("T19", 13)).toBe(false);
    const result = verifyLlmCommentaryClaimsV1({
      plan: { ...basePlan, referenceLine: { playedMove: "D4", recommendedMove: "K10", pv: [] } },
      boardSize: 13,
      output: { ...safeOutput, body: "T19도 함께 볼 수 있습니다." },
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("unknown_coordinate_claim");
  });

  it("allows valid coordinates on boardSize=19", () => {
    expect(isGtpMoveOnBoardV1("Q16", 19)).toBe(true);
    const result = verifyLlmCommentaryClaimsV1({ plan: basePlan, boardSize: 19, output: safeOutput });
    expect(result.ok).toBe(true);
  });

  it("rejects I-column GTP coordinates", () => {
    expect(isGtpMoveOnBoardV1("I9", 19)).toBe(false);
    const result = verifyLlmCommentaryClaimsV1({
      plan: basePlan,
      boardSize: 19,
      output: { ...safeOutput, body: "I9도 비교합니다." },
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("unknown_coordinate_claim");
  });

  it("rejects coordinates not present in the plan", () => {
    const result = verifyLlmCommentaryClaimsV1({
      plan: basePlan,
      boardSize: 19,
      output: { ...safeOutput, body: "R17이 더 좋아 보입니다." },
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("unknown_coordinate_claim");
  });

  it("rejects score claims not present in evidence bullets", () => {
    const result = verifyLlmCommentaryClaimsV1({
      plan: basePlan,
      boardSize: 19,
      output: { ...safeOutput, body: "D4 이후 7집 차이를 언급합니다." },
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("unknown_score_claim");
  });

  it("rejects winrate claims not present in evidence bullets", () => {
    const result = verifyLlmCommentaryClaimsV1({
      plan: basePlan,
      boardSize: 19,
      output: { ...safeOutput, body: "D4 이후 30% 승률 변화를 언급합니다." },
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("unknown_winrate_claim");
  });

  it("rejects timeline_context described as winrate loss", () => {
    const timelinePlan: ExplanationPlanV1 = {
      ...basePlan,
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
    };
    const result = verifyLlmCommentaryClaimsV1({
      plan: timelinePlan,
      boardSize: 19,
      output: { ...safeOutput, body: "승률 변동 18%를 손실로 볼 수 있습니다." },
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("timeline_loss_claim");
  });

  it("rejects loss wording for ADI-only review plans", () => {
    const adiOnlyPlan: ExplanationPlanV1 = {
      ...basePlan,
      evidenceBullets: [
        {
          type: "adi",
          labelKey: "ep_evidence_adi",
          value: null,
          unit: "none",
          textKey: "ep_text_adi_review_context",
        },
      ],
    };
    const result = verifyLlmCommentaryClaimsV1({
      plan: adiOnlyPlan,
      boardSize: 19,
      output: { ...safeOutput, body: "ADI 근거로 손실이 있었다고 설명합니다." },
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("context_signal_loss_claim");
  });

  it("passes safe output", () => {
    const result = verifyLlmCommentaryClaimsV1({ plan: basePlan, boardSize: 19, output: safeOutput });
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it("rejects forbidden labels", () => {
    const result = verifyLlmCommentaryClaimsV1({
      plan: basePlan,
      boardSize: 19,
      output: { ...safeOutput, body: "이 장면은 패착 확정입니다." },
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("forbidden_label");
  });

  it("rejects raw SGF-like payload", () => {
    const result = verifyLlmCommentaryClaimsV1({
      plan: basePlan,
      boardSize: 19,
      output: { ...safeOutput, body: "(;GM[1]FF[4]SZ[19];B[dd];W[qq])" },
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("unsafe_payload");
  });

  it("sanitizes referenceLine by board size", () => {
    expect(
      sanitizeReferenceLineForBoardSizeV1(
        {
          playedMove: "d4",
          recommendedMove: "T19",
          pv: ["Q16", "J14", "pass", "I9"],
        },
        13
      )
    ).toEqual({
      playedMove: "D4",
      recommendedMove: null,
      pv: ["pass"],
    });
  });
});
