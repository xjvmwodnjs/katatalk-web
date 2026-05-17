import { describe, expect, it } from "vitest";
import {
  buildExplanationPlanV2ForDecisiveMove,
  buildExplanationPlanV2ForReviewMove,
  isExplanationPlanBulletV2,
  isExplanationPlanV2,
} from "@shared/explanationPlannerV2";
import type { ProductDecisiveMoveV1, ProductReviewMoveV1 } from "@shared/analysisProductEventsV1";

const decisiveBase: ProductDecisiveMoveV1 = {
  turnIndex: 42,
  player: "W",
  playedMove: "D4",
  recommendedMove: "Q16",
  scoreLoss: 4.5,
  winrateLoss: 0.12,
  confidence: "medium",
  sourceEventId: "decisive-42",
  evidence: {
    source: ["turnAnalyses", "deepSearchResultsV1"],
    pv: ["Q16", "D16"],
    v25: {
      taxonomy: "decisive_candidate",
      evidenceTypes: ["loss_evidence", "deep_search_context"],
      rankingScore: 50,
      ranking: { scoreLoss: 20, winrateLoss: 10, playedMoveRank: 4, bsi: 0, adi: 0, deepSearch: 8, volatility: 0, explainability: 3, openingPenalty: 0, duplicatePenalty: 0 },
    },
  },
  conceptTagsV1: [{ tag: "connection", confidence: "medium", evidence: ["ownAdjacentGroups=2"], caveats: ["adjacency_heuristic_only"] }],
  forbiddenConceptClaims: [{ concept: "invasion", reason: "ownership_evidence_unavailable" }],
  candidateComparisonV1: {
    turnIndex: 42,
    playedMove: "D4",
    recommendedMove: "Q16",
    comparisonType: "move_difference",
    deltas: [{ type: "score_loss", severity: "medium", evidence: ["scoreLoss=4.5"], caveats: ["comparison_material_only"] }],
    forbiddenClaims: ["ladder_risk:ladder_reading_unavailable"],
  },
};

const reviewBase: ProductReviewMoveV1 = {
  turnIndex: 24,
  player: "B",
  category: "learning_candidate",
  playedMove: "C3",
  recommendedMove: "D4",
  scoreLoss: null,
  winrateLoss: null,
  confidence: "low",
  sourceEventId: null,
  evidence: { source: ["adiV1"], pv: [] },
};

describe("explanation planner v2", () => {
  it("builds beginner plan around simple concept hints", () => {
    const plan = buildExplanationPlanV2ForDecisiveMove(decisiveBase, "beginner");

    expect(plan.audience).toBe("beginner");
    expect(plan.bullets[0]?.type).toBe("concept_hint");
    expect(plan.bullets.some((bullet) => bullet.type === "pv_reference")).toBe(false);
    expect(isExplanationPlanV2(plan)).toBe(true);
  });

  it("builds dan plan with score, winrate, comparison, and PV", () => {
    const plan = buildExplanationPlanV2ForDecisiveMove(decisiveBase, "dan");
    const types = plan.bullets.map((bullet) => bullet.type);

    expect(types).toEqual(expect.arrayContaining(["score_loss", "winrate_loss", "candidate_comparison", "pv_reference"]));
  });

  it("builds high_dan plan with additional evidence context", () => {
    const dan = buildExplanationPlanV2ForDecisiveMove(decisiveBase, "dan");
    const highDan = buildExplanationPlanV2ForDecisiveMove(decisiveBase, "high_dan");

    expect(highDan.bullets.length).toBeGreaterThan(dan.bullets.length);
    expect(highDan.bullets.some((bullet) => bullet.type === "deep_search_context")).toBe(true);
    expect(highDan.bullets.some((bullet) => bullet.type === "caveat")).toBe(true);
  });

  it("does not create loss bullets for ADI-only review input", () => {
    const plan = buildExplanationPlanV2ForReviewMove(reviewBase, "dan");

    expect(plan.bullets.some((bullet) => bullet.type === "score_loss" || bullet.type === "winrate_loss")).toBe(false);
  });

  it("does not create winrate loss bullet for timeline-only context", () => {
    const plan = buildExplanationPlanV2ForReviewMove({
      ...reviewBase,
      category: "volatility_candidate",
      evidence: { source: ["winrateTimelineV1"], v25: { taxonomy: "volatility_candidate", evidenceTypes: ["volatility_context"], rankingScore: 8, ranking: { scoreLoss: 0, winrateLoss: 0, playedMoveRank: 0, bsi: 0, adi: 0, deepSearch: 0, volatility: 8, explainability: 0, openingPenalty: 0, duplicatePenalty: 0 } } },
    }, "dan");

    expect(plan.bullets.some((bullet) => bullet.type === "winrate_loss")).toBe(false);
    expect(plan.bullets.some((bullet) => bullet.type === "volatility_context")).toBe(true);
  });

  it("omits concept and comparison bullets when inputs are absent", () => {
    const plan = buildExplanationPlanV2ForReviewMove(reviewBase, "dan");

    expect(plan.bullets.some((bullet) => bullet.type === "concept_hint")).toBe(false);
    expect(plan.bullets.some((bullet) => bullet.type === "candidate_comparison")).toBe(false);
  });

  it("carries concept and comparison forbidden claims", () => {
    const plan = buildExplanationPlanV2ForDecisiveMove(decisiveBase, "dan");

    expect(plan.forbiddenClaims).toContain("invasion:ownership_evidence_unavailable");
    expect(plan.forbiddenClaims).toContain("ladder_risk:ladder_reading_unavailable");
  });

  it("rejects unsafe or malformed explanation plans", () => {
    const plan = buildExplanationPlanV2ForDecisiveMove(decisiveBase, "dan");
    const fakeSecret = ["sk", "test", "abcdefghijklmnopqrstuvwxyz123456"].join("_");
    const envLike = ["SECRET", "TOKEN"].join("_") + "=value";
    const pathLike = ["C:", "Temp", "plan.txt"].join("\\");

    expect(isExplanationPlanV2({ ...plan, audience: "pro" })).toBe(false);
    expect(isExplanationPlanV2({ ...plan, bullets: [{ ...plan.bullets[0], type: "verdict" }] })).toBe(false);
    expect(isExplanationPlanV2({ ...plan, bullets: [{ ...plan.bullets[0], evidence: ["B[pd]"] }] })).toBe(false);
    expect(isExplanationPlanV2({ ...plan, forbiddenClaims: [fakeSecret] })).toBe(false);
    expect(isExplanationPlanV2({ ...plan, caveats: [envLike] })).toBe(false);
    expect(isExplanationPlanV2({ ...plan, summaryKey: pathLike })).toBe(false);
  });

  it("enforces bullet type value and unit invariants", () => {
    const validScoreLoss = { type: "score_loss", textKey: "ep2_text_score_loss", value: 3.5, unit: "points", evidence: ["scoreLoss=3.5"] };
    const validWinrateLoss = { type: "winrate_loss", textKey: "ep2_text_winrate_loss", value: 0.12, unit: "ratio", evidence: ["winrateLoss=0.12"] };
    const validContext = { type: "volatility_context", textKey: "ep2_text_volatility_context", unit: "none", evidence: ["volatility_context_available"] };
    const validPvReference = { type: "pv_reference", textKey: "ep2_text_pv_reference", value: 2, unit: "none", evidence: ["pvLength=2"] };

    expect(isExplanationPlanBulletV2({ ...validScoreLoss, value: -5 })).toBe(false);
    expect(isExplanationPlanBulletV2({ ...validScoreLoss, unit: "none" })).toBe(false);
    expect(isExplanationPlanBulletV2({ ...validWinrateLoss, value: 2 })).toBe(false);
    expect(isExplanationPlanBulletV2({ ...validWinrateLoss, unit: "points" })).toBe(false);
    expect(isExplanationPlanBulletV2({ ...validContext, value: 0.2 })).toBe(false);
    expect(isExplanationPlanBulletV2({ ...validContext, unit: "ratio" })).toBe(false);
    expect(isExplanationPlanBulletV2({ type: "concept_hint", textKey: "ep2_text_concept_hint", value: 1, unit: "none", evidence: ["concept=connection:medium"] })).toBe(false);
    expect(isExplanationPlanBulletV2({ type: "candidate_comparison", textKey: "ep2_text_candidate_comparison", unit: "points", evidence: ["comparisonType=move_difference"] })).toBe(false);
    expect(isExplanationPlanBulletV2(validScoreLoss)).toBe(true);
    expect(isExplanationPlanBulletV2(validWinrateLoss)).toBe(true);
    expect(isExplanationPlanBulletV2(validContext)).toBe(true);
    expect(isExplanationPlanBulletV2(validPvReference)).toBe(true);
  });

  it("keeps builder output valid under strict bullet invariants", () => {
    const plans = [
      buildExplanationPlanV2ForDecisiveMove(decisiveBase, "beginner"),
      buildExplanationPlanV2ForDecisiveMove(decisiveBase, "intermediate"),
      buildExplanationPlanV2ForDecisiveMove(decisiveBase, "dan"),
      buildExplanationPlanV2ForDecisiveMove(decisiveBase, "high_dan"),
      buildExplanationPlanV2ForReviewMove(reviewBase, "dan"),
    ];

    expect(plans.every(isExplanationPlanV2)).toBe(true);
    expect(plans.flatMap((plan) => plan.bullets).every(isExplanationPlanBulletV2)).toBe(true);
  });

  it("keeps planner v2 output free from assertive forbidden terms", () => {
    const forbidden = new RegExp([["패착", " ", "확정"].join(""), ["완착", " ", "확정"].join(""), ["악", "수"].join(""), ["정", "답"].join(""), ["best", " ", "move"].join(""), ["blun", "der"].join("")].join("|"), "i");
    expect(JSON.stringify(buildExplanationPlanV2ForDecisiveMove(decisiveBase, "high_dan"))).not.toMatch(forbidden);
  });
});
