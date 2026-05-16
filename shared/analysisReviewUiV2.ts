import type { AnalysisResultVariationPreviewV1 } from "./analysisResultViewModel";

export type AnalysisReviewModeV2 = "mainline" | "variation";

export function variationIdV2(row: Pick<AnalysisResultVariationPreviewV1, "turnIndex" | "source">): string {
  return `${row.turnIndex}:${row.source}`;
}

export function hasDisplayableVariationPvV2(row: Pick<AnalysisResultVariationPreviewV1, "pv">): boolean {
  return row.pv.some((m) => typeof m === "string" && m.trim().length > 0);
}

export function selectedVariationByIdV2(
  previews: AnalysisResultVariationPreviewV1[],
  selectedVariationId: string | null
): AnalysisResultVariationPreviewV1 | null {
  if (!selectedVariationId) {
    return null;
  }
  const row = previews.find((p) => variationIdV2(p) === selectedVariationId) ?? null;
  return row && hasDisplayableVariationPvV2(row) ? row : null;
}

export function reviewModeForSelectedVariationV2(selectedVariationId: string | null): AnalysisReviewModeV2 {
  return selectedVariationId ? "variation" : "mainline";
}

export function displayableVariationTurnIndexesV2(previews: AnalysisResultVariationPreviewV1[]): Set<number> {
  return new Set(previews.filter(hasDisplayableVariationPvV2).map((p) => p.turnIndex));
}
