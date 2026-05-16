import { describe, expect, it } from "vitest";
import {
  backToMainlineStateV3,
  canEnterTryPlayModeV3,
  displayableVariationTurnIndexesV2,
  canPlaceTryPlayStoneV3,
  candidateSelectedStateV3,
  getRenderableVariationMovesV2,
  hasDisplayableVariationPvV2,
  hasRenderableVariationOverlayV2,
  nextTryPlayColorV3,
  nextWinrateCollapsedV2,
  readCompactGameInfoV2,
  renderableVariationTurnIndexesV2,
  reviewModeForSelectedVariationV2,
  selectedVariationByIdV2,
  variationReviewStateV3,
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
    const nonRenderable = { turnIndex: 31, playedMove: "D5", bestMove: "Q17", pv: ["pass", "??"], source: "multi-turn" as const };
    const withEmpty = [...rows, empty];
    expect(hasDisplayableVariationPvV2(empty)).toBe(false);
    expect(hasDisplayableVariationPvV2(nonRenderable)).toBe(false);
    expect(selectedVariationByIdV2(withEmpty, variationIdV2(empty))).toBeNull();
    expect(displayableVariationTurnIndexesV2(withEmpty)).toEqual(new Set([12, 20]));
  });

  it("reads compact game info from result payload", () => {
    expect(
      readCompactGameInfoV2({
        game_info: {
          black_player: "Black A",
          white_player: "White B",
          result: { ko: "흑 불계승", en: "B+R" },
        },
      }, "ko")
    ).toEqual({ blackPlayer: "Black A", whitePlayer: "White B", resultText: "흑 불계승" });
  });

  it("toggles winrate collapsed state", () => {
    expect(nextWinrateCollapsedV2(false)).toBe(true);
    expect(nextWinrateCollapsedV2(true)).toBe(false);
  });

  it("supports local try-play color alternation and occupied guard", () => {
    expect(nextTryPlayColorV3("B", 0)).toBe("B");
    expect(nextTryPlayColorV3("B", 1)).toBe("W");
    expect(nextTryPlayColorV3("W", 2)).toBe("W");
    expect(canPlaceTryPlayStoneV3(["1,1"], 2, 2)).toBe(true);
    expect(canPlaceTryPlayStoneV3(["1,1"], 1, 1)).toBe(false);
  });

  it("resets candidate and try-play state when returning to mainline", () => {
    expect(
      backToMainlineStateV3({
        selectedVariationId: "12:multi-turn",
        selectedCandidateTurnIndex: 12,
        reviewMode: "variation-review",
        tryPlayStoneCount: 2,
      })
    ).toEqual({
      selectedVariationId: null,
      selectedCandidateTurnIndex: null,
      reviewMode: "mainline",
      tryPlayStoneCount: 0,
    });
  });

  it("keeps candidate click separate from variation review mode", () => {
    const selected = candidateSelectedStateV3(
      { selectedVariationId: "12:multi-turn", selectedCandidateTurnIndex: null, reviewMode: "mainline", tryPlayStoneCount: 1 },
      20
    );
    expect(selected.reviewMode).toBe("candidate-selected");
    expect(selected.selectedCandidateTurnIndex).toBe(20);
    expect(selected.selectedVariationId).toBeNull();

    const blocked = variationReviewStateV3(selected, "20:deep-search", false);
    expect(blocked.reviewMode).toBe("candidate-selected");

    const entered = variationReviewStateV3(selected, "20:deep-search", true);
    expect(entered.reviewMode).toBe("variation-review");
    expect(entered.selectedVariationId).toBe("20:deep-search");
  });

  it("detects renderable variation overlay coordinates only", () => {
    expect(hasRenderableVariationOverlayV2({ pv: ["pass"] }, 19, [])).toBe(false);
    expect(hasRenderableVariationOverlayV2({ pv: ["??"] }, 19, [])).toBe(false);
    expect(hasRenderableVariationOverlayV2({ pv: ["U19"] }, 19, [])).toBe(false);
    expect(hasRenderableVariationOverlayV2({ pv: ["D4"] }, 19, ["3,15"])).toBe(false);
    expect(hasRenderableVariationOverlayV2({ pv: ["pass", "D4"] }, 19, [])).toBe(true);
    expect(getRenderableVariationMovesV2({ pv: ["pass", "D4", "D4", "Q16"] }, 19, [])).toEqual([
      { gtp: "D4", x: 3, y: 15, order: 2 },
      { gtp: "Q16", x: 15, y: 3, order: 4 },
    ]);

    const candidates = [
      { turnIndex: 1, playedMove: "A1", bestMove: "B1", pv: ["pass"], source: "multi-turn" as const },
      { turnIndex: 2, playedMove: "A2", bestMove: "B2", pv: ["D4"], source: "deep-search" as const },
    ];
    expect(renderableVariationTurnIndexesV2(candidates, 19, ["3,15"])).toEqual(new Set());
    expect(renderableVariationTurnIndexesV2(candidates, 19, [])).toEqual(new Set([2]));
  });

  it("blocks try-play entry for placeholder board states", () => {
    expect(canEnterTryPlayModeV3(false)).toBe(true);
    expect(canEnterTryPlayModeV3(true)).toBe(false);
  });
});
