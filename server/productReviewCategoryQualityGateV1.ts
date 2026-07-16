import type { ProductReviewWorkbenchV1 } from "@shared/productReviewWorkbenchV1";

export const PRODUCT_REVIEW_CATEGORY_QUALITY_GATE_V1_VERSION =
  "product-review-category-quality-gate-v1" as const;

export type ProductReviewCategoryQualityIssueCodeV1 =
  | "WORKBENCH_UNSUPPORTED"
  | "FORBIDDEN_LABEL_PRESENT"
  | "DECISIVE_LOSER_MISMATCH"
  | "DECISIVE_LOSS_EVIDENCE_MISSING"
  | "DUPLICATE_REVIEW_TURN"
  | "SCORE_CATEGORY_WITHOUT_SCORE_LOSS"
  | "WINRATE_CATEGORY_WITHOUT_WINRATE_LOSS"
  | "DEEP_SEARCH_CATEGORY_WITHOUT_DEEP_EVIDENCE"
  | "VOLATILITY_CATEGORY_WITHOUT_TIMELINE_EVIDENCE"
  | "VOLATILITY_CATEGORY_WITH_LOSS_EVIDENCE"
  | "CATEGORY_TAXONOMY_MISMATCH"
  | "LOSS_DELTA_WITHOUT_POSITIVE_LOSS";

export type ProductReviewCategoryQualityIssueV1 = {
  code: ProductReviewCategoryQualityIssueCodeV1;
  turnIndex: number | null;
  message: string;
};

export type ProductReviewCategoryQualityReportV1 = {
  version: typeof PRODUCT_REVIEW_CATEGORY_QUALITY_GATE_V1_VERSION;
  ok: boolean;
  failureCount: number;
  selectedReviewCount: number;
  issues: ProductReviewCategoryQualityIssueV1[];
};

function hasPositive(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function pushIssue(
  issues: ProductReviewCategoryQualityIssueV1[],
  code: ProductReviewCategoryQualityIssueCodeV1,
  turnIndex: number | null,
  message: string
): void {
  issues.push({ code, turnIndex, message });
}

function expectedTaxonomy(category: string, hasLoss: boolean): string | null {
  switch (category) {
    case "score_shift_candidate":
    case "winrate_shift_candidate":
    case "flow_shift_candidate":
    case "response_candidate":
      return hasLoss ? "swing_candidate" : "learning_candidate";
    case "shape_review_candidate":
      return "shape_review_candidate";
    case "direction_candidate":
      return "direction_candidate";
    case "deep_search_candidate":
      return "deep_search_candidate";
    case "volatility_candidate":
      return "volatility_candidate";
    case "learning_candidate":
      return "learning_candidate";
    default:
      return null;
  }
}

export function evaluateProductReviewCategoryQualityGateV1(
  workbench: ProductReviewWorkbenchV1
): ProductReviewCategoryQualityReportV1 {
  const issues: ProductReviewCategoryQualityIssueV1[] = [];
  if (workbench.status !== "ok") {
    pushIssue(
      issues,
      "WORKBENCH_UNSUPPORTED",
      null,
      `Product Review workbench is unsupported: ${workbench.unsupportedReason ?? "unknown"}`
    );
  }
  if (workbench.safety.forbiddenLabelsPresent.length > 0) {
    pushIssue(
      issues,
      "FORBIDDEN_LABEL_PRESENT",
      null,
      "Product Review workbench contains forbidden labels."
    );
  }

  const decisive = workbench.decisiveMoveTrace.selected;
  if (decisive != null) {
    if (
      workbench.decisiveMoveTrace.loserColorRequired &&
      workbench.gameSummary.loserColor != null &&
      decisive.player !== workbench.gameSummary.loserColor
    ) {
      pushIssue(
        issues,
        "DECISIVE_LOSER_MISMATCH",
        decisive.turnIndex,
        "Decisive move must belong to the losing player."
      );
    }
    if (
      workbench.decisiveMoveTrace.positiveLossEvidenceRequired &&
      !hasPositive(decisive.scoreLoss) &&
      !hasPositive(decisive.winrateLoss)
    ) {
      pushIssue(
        issues,
        "DECISIVE_LOSS_EVIDENCE_MISSING",
        decisive.turnIndex,
        "Decisive move requires positive score or winrate loss evidence."
      );
    }
  }

  const seenTurns = new Set<number>();
  for (const review of workbench.reviewMovesTrace.selected) {
    if (seenTurns.has(review.turnIndex)) {
      pushIssue(
        issues,
        "DUPLICATE_REVIEW_TURN",
        review.turnIndex,
        "A review turn was selected more than once."
      );
    }
    seenTurns.add(review.turnIndex);

    const hasScoreLoss = hasPositive(review.scoreLoss);
    const hasWinrateLoss = hasPositive(review.winrateLoss);
    const hasLoss = hasScoreLoss || hasWinrateLoss;
    const hasDeepEvidence = review.evidence.includes("deepSearchResultsV1");
    const hasTimelineEvidence = review.evidence.includes("winrateTimelineV1");
    const comparisonDeltas = review.candidateComparisonV1?.deltas ?? [];

    if (review.category === "score_shift_candidate" && !hasScoreLoss) {
      pushIssue(issues, "SCORE_CATEGORY_WITHOUT_SCORE_LOSS", review.turnIndex, "Score-shift category requires positive score loss.");
    }
    if (review.category === "winrate_shift_candidate" && !hasWinrateLoss) {
      pushIssue(issues, "WINRATE_CATEGORY_WITHOUT_WINRATE_LOSS", review.turnIndex, "Winrate-shift category requires positive winrate loss.");
    }
    if (review.category === "deep_search_candidate" && !hasDeepEvidence) {
      pushIssue(issues, "DEEP_SEARCH_CATEGORY_WITHOUT_DEEP_EVIDENCE", review.turnIndex, "Deep-search category requires Deep Search evidence.");
    }
    if (review.category === "volatility_candidate") {
      if (!hasTimelineEvidence) {
        pushIssue(issues, "VOLATILITY_CATEGORY_WITHOUT_TIMELINE_EVIDENCE", review.turnIndex, "Volatility category requires timeline evidence.");
      }
      if (hasLoss) {
        pushIssue(issues, "VOLATILITY_CATEGORY_WITH_LOSS_EVIDENCE", review.turnIndex, "Volatility-only category must not carry score or winrate loss claims.");
      }
    }

    const taxonomy = expectedTaxonomy(review.category, hasLoss);
    if (taxonomy == null || review.v25Taxonomy !== taxonomy) {
      pushIssue(issues, "CATEGORY_TAXONOMY_MISMATCH", review.turnIndex, "Review category and v2.5 taxonomy do not agree.");
    }
    if (
      comparisonDeltas.some(delta => delta.type === "score_loss") &&
      !hasScoreLoss
    ) {
      pushIssue(issues, "LOSS_DELTA_WITHOUT_POSITIVE_LOSS", review.turnIndex, "Score-loss comparison delta requires positive score loss.");
    }
    if (
      comparisonDeltas.some(delta => delta.type === "winrate_loss") &&
      !hasWinrateLoss
    ) {
      pushIssue(issues, "LOSS_DELTA_WITHOUT_POSITIVE_LOSS", review.turnIndex, "Winrate-loss comparison delta requires positive winrate loss.");
    }
  }

  return {
    version: PRODUCT_REVIEW_CATEGORY_QUALITY_GATE_V1_VERSION,
    ok: issues.length === 0,
    failureCount: issues.length,
    selectedReviewCount: workbench.reviewMovesTrace.selected.length,
    issues,
  };
}
