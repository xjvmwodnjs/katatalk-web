import { describe, expect, it } from "vitest";
import {
  displayableVariationTurnIndexesV2,
  hasDisplayableVariationPvV2,
  reviewModeForSelectedVariationV2,
  selectedVariationByIdV2,
  variationIdV2,
} from "@shared/analysisReviewUiV2";
import type { AnalysisResultVariationPreviewV1 } from "@shared/analysisResultViewModel";

describe("analysisReviewUiV2 helpers", () => {
  const rows: AnalysisResultVariationPreviewV1[] = [
    { turnIndex: 12, playedMove: "Q16", bestMove: "D4", pv: ["D4"], source: "multi-turn" },
    { turnIndex: 20, playedMove: "C3", bestMove: "Q4", pv: ["Q4", "D16"], source: "deep-search" },
  ];

  it("enters variation mode when a selected variation id exists", () => {
    const id = variationIdV2(rows[1]!);
    expect(selectedVariationByIdV2(rows, id)).toEqual(rows[1]);
    expect(reviewModeForSelectedVariationV2(id)).toBe("variation");
  });

  it("returns to mainline mode when selected variation is cleared", () => {
    expect(selectedVariationByIdV2(rows, null)).toBeNull();
    expect(reviewModeForSelectedVariationV2(null)).toBe("mainline");
  });

  it("treats empty PV variations as not displayable", () => {
    const empty = { turnIndex: 30, playedMove: "D4", bestMove: "Q16", pv: [], source: "multi-turn" as const };
    const withEmpty = [...rows, empty];
    expect(hasDisplayableVariationPvV2(empty)).toBe(false);
    expect(selectedVariationByIdV2(withEmpty, variationIdV2(empty))).toBeNull();
    expect(displayableVariationTurnIndexesV2(withEmpty)).toEqual(new Set([12, 20]));
  });
});
