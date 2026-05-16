import { describe, expect, it } from "vitest";
import {
  buildExplanationPlanForDecisiveMoveV1,
  buildExplanationPlanForReviewMoveV1,
  isExplanationPlanV1,
} from "@shared/explanationPlannerV1";
import type { ProductDecisiveMoveV1, ProductReviewMoveV1 } from "@shared/analysisProductEventsV1";

const decisiveBase: ProductDecisiveMoveV1 = {
  turnIndex: 42,
  player: "W",
  playedMove: "D4",
  recommendedMove: "Q16",
  scoreLoss: null,
  winrateLoss: null,
  confidence: "medium",
  sourceEventId: "decisive-42",
  evidence: { source: ["turnAnalyses"], pv: ["Q16", "D16"] },
};

const reviewBase: ProductReviewMoveV1 = {
  turnIndex: 24,
  player: "B",
  category: "learning_candidate",
  playedMove: "C3",
  recommendedMove: null,
  scoreLoss: null,
  winrateLoss: null,
  confidence: "low",
  sourceEventId: null,
  evidence: { source: ["adiV1"], pv: [] },
};

describe("explanation planner v1", () => {
  it("creates score_loss bullet for decisiveMove positive scoreLoss", () => {
    const plan = buildExplanationPlanForDecisiveMoveV1({ ...decisiveBase, scoreLoss: 4.5 });
    expect(plan.targetType).toBe("decisive_move");
    expect(plan.titleKey).toBe("ep_title_decisive_move_candidate");
    expect(plan.evidenceBullets).toContainEqual({
      type: "score_loss",
      labelKey: "ep_evidence_score_loss",
      value: 4.5,
      unit: "points",
      textKey: "ep_text_score_loss_candidate",
    });
  });

  it("creates winrate_loss bullet for decisiveMove positive winrateLoss", () => {
    const plan = buildExplanationPlanForDecisiveMoveV1({ ...decisiveBase, winrateLoss: 0.12 });
    expect(plan.evidenceBullets).toContainEqual({
      type: "winrate_loss",
      labelKey: "ep_evidence_winrate_loss",
      value: 0.12,
      unit: "ratio",
      textKey: "ep_text_winrate_loss_candidate",
    });
  });

  it("keeps ADI and Deep Search as supporting bullets for decisiveMove", () => {
    const plan = buildExplanationPlanForDecisiveMoveV1({
      ...decisiveBase,
      scoreLoss: 3,
      evidence: { source: ["turnAnalyses", "adiV1", "deepSearchResultsV1"] },
    });
    expect(plan.evidenceBullets.map((b) => b.type)).toEqual(expect.arrayContaining(["score_loss", "adi", "deep_search"]));
  });

  it("creates review context without loss bullet for ADI-only reviewMove", () => {
    const plan = buildExplanationPlanForReviewMoveV1(reviewBase);
    expect(plan.targetType).toBe("review_move");
    expect(plan.summaryKey).toBe("ep_summary_review_learning_candidate");
    expect(plan.evidenceBullets.map((b) => b.type)).toEqual(["adi"]);
  });

  it("creates timeline_context bullet for timeline-only reviewMove without winrate loss", () => {
    const plan = buildExplanationPlanForReviewMoveV1({
      ...reviewBase,
      category: "volatility_candidate",
      evidence: { source: ["winrateTimelineV1"], notes: ["raw timeline delta is context"] },
    });
    expect(plan.summaryKey).toBe("ep_summary_review_timeline_context_candidate");
    expect(plan.evidenceBullets).toContainEqual({
      type: "timeline_context",
      labelKey: "ep_evidence_timeline_context",
      value: null,
      unit: "none",
      textKey: "ep_text_timeline_context_not_loss",
    });
    expect(plan.evidenceBullets.some((b) => b.type === "winrate_loss")).toBe(false);
    expect(plan.caveats).toContain("ep_caveat_timeline_is_context_not_loss");
  });

  it("includes PV in referenceLine when present", () => {
    const plan = buildExplanationPlanForDecisiveMoveV1(decisiveBase);
    expect(plan.referenceLine).toEqual({
      playedMove: "D4",
      recommendedMove: "Q16",
      pv: ["Q16", "D16"],
    });
    expect(plan.evidenceBullets.some((b) => b.type === "pv")).toBe(true);
  });

  it("is null-safe when recommendedMove is missing", () => {
    const plan = buildExplanationPlanForReviewMoveV1({ ...reviewBase, recommendedMove: null });
    expect(plan.referenceLine.recommendedMove).toBeNull();
    expect(isExplanationPlanV1(plan)).toBe(true);
  });

  it("does not convert confidence into assertive wording", () => {
    const plan = buildExplanationPlanForDecisiveMoveV1({ ...decisiveBase, confidence: "high", scoreLoss: 8 });
    expect(plan.confidence).toBe("high");
    expect(plan.caveats).toContain("ep_caveat_candidate_not_final_judgement");
  });

  it("keeps output free from forbidden assertive terms", () => {
    const plans = [
      buildExplanationPlanForDecisiveMoveV1({ ...decisiveBase, scoreLoss: 8, evidence: { source: ["turnAnalyses", "deepSearchResultsV1"] } }),
      buildExplanationPlanForReviewMoveV1({ ...reviewBase, evidence: { source: ["winrateTimelineV1"] }, category: "volatility_candidate" }),
    ];
    expect(JSON.stringify(plans)).not.toMatch(/패착 확정|악수|정답|best move|blunder/i);
  });

  it("passes ExplanationPlanV1 schema guard", () => {
    const plan = buildExplanationPlanForDecisiveMoveV1({
      ...decisiveBase,
      scoreLoss: 6,
      winrateLoss: 0.1,
      evidence: { source: ["turnAnalyses", "bsiV1", "adiV1", "deepSearchResultsV1"], pv: ["Q16"] },
    });
    expect(isExplanationPlanV1(plan)).toBe(true);
  });
});
