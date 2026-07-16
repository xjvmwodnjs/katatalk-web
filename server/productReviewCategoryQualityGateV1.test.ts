import { describe, expect, it } from "vitest";
import type { ProductReviewWorkbenchV1 } from "@shared/productReviewWorkbenchV1";
import { evaluateProductReviewCategoryQualityGateV1 } from "./productReviewCategoryQualityGateV1";

function workbench(overrides: Record<string, unknown> = {}): ProductReviewWorkbenchV1 {
  return {
    version: "product-review-workbench-v1",
    status: "ok",
    unsupportedReason: null,
    gameSummary: {
      boardSize: 19,
      totalMoves: 40,
      komi: 6.5,
      resultType: "points",
      winnerColor: "W",
      loserColor: "B",
      margin: 3.5,
    },
    sourceSummary: {
      source: "katago-worker-v1",
      metaMock: false,
      timelineEnabled: true,
      timelineCompleted: true,
      deepSearchEnabled: true,
      deepSearchCompleted: true,
    },
    learningEventsSummary: [],
    candidatePoolSummary: [],
    decisiveMoveTrace: {
      selected: null,
      selectedReason: null,
      v25EvidenceBreakdown: null,
      conceptTagsV1: [],
      forbiddenConceptClaims: [],
      candidateComparisonV1: null,
      loserColorRequired: true,
      positiveLossEvidenceRequired: true,
      rejectedCandidates: [],
    },
    reviewMovesTrace: {
      selected: [
        {
          turnIndex: 12,
          category: "score_shift_candidate",
          rankingScore: 80,
          scoreLoss: 4,
          winrateLoss: null,
          evidence: ["turnAnalyses", "bsiV1"],
          v25Taxonomy: "swing_candidate",
          v25EvidenceTypes: ["loss_evidence"],
          v25Ranking: null,
          conceptTagsV1: [],
          forbiddenConceptClaims: [],
          candidateComparisonV1: {
            version: "candidate-comparison-v1",
            turnIndex: 12,
            playedMove: "Q16",
            recommendedMove: "D16",
            comparisonType: "move_difference",
            deltas: [
              {
                type: "score_loss",
                severity: "medium",
                evidence: ["scoreLoss=4"],
                caveats: [],
              },
            ],
            forbiddenClaims: [],
          },
          decisiveDuplicateExcluded: false,
        },
      ],
      playerDiversityApplied: false,
      rejectedCandidates: [],
    },
    explanationPlanTrace: [],
    explanationPlanV2Trace: [],
    uiSummary: [],
    safety: {
      sgfContentRedacted: true,
      secretLikeValuesRedacted: true,
      forbiddenLabelsPresent: [],
    },
    ...overrides,
  } as ProductReviewWorkbenchV1;
}

describe("productReviewCategoryQualityGateV1", () => {
  it("accepts a category with matching taxonomy and loss evidence", () => {
    expect(evaluateProductReviewCategoryQualityGateV1(workbench())).toMatchObject({
      ok: true,
      failureCount: 0,
      selectedReviewCount: 1,
    });
  });

  it("rejects score categories without positive score loss", () => {
    const report = workbench();
    report.reviewMovesTrace.selected[0]!.scoreLoss = null;
    report.reviewMovesTrace.selected[0]!.candidateComparisonV1!.deltas = [];

    expect(evaluateProductReviewCategoryQualityGateV1(report).issues).toContainEqual(
      expect.objectContaining({ code: "SCORE_CATEGORY_WITHOUT_SCORE_LOSS" })
    );
  });

  it("rejects deep-search and volatility categories without their required evidence", () => {
    const report = workbench();
    const review = report.reviewMovesTrace.selected[0]!;
    review.category = "deep_search_candidate";
    review.scoreLoss = null;
    review.v25Taxonomy = "deep_search_candidate";
    review.evidence = ["adiV1"];
    review.candidateComparisonV1!.deltas = [];

    const deepReport = evaluateProductReviewCategoryQualityGateV1(report);
    expect(deepReport.issues).toContainEqual(
      expect.objectContaining({ code: "DEEP_SEARCH_CATEGORY_WITHOUT_DEEP_EVIDENCE" })
    );

    review.category = "volatility_candidate";
    review.v25Taxonomy = "volatility_candidate";
    review.scoreLoss = 1;
    const volatilityReport = evaluateProductReviewCategoryQualityGateV1(report);
    expect(volatilityReport.issues).toContainEqual(
      expect.objectContaining({ code: "VOLATILITY_CATEGORY_WITHOUT_TIMELINE_EVIDENCE" })
    );
    expect(volatilityReport.issues).toContainEqual(
      expect.objectContaining({ code: "VOLATILITY_CATEGORY_WITH_LOSS_EVIDENCE" })
    );
  });
});
