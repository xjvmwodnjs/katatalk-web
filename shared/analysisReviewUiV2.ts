import type { AnalysisResultVariationPreviewV1 } from "./analysisResultViewModel";

export type AnalysisReviewModeV2 = "mainline" | "variation";
export type CompactGameInfoV2 = {
  blackPlayer: string | null;
  whitePlayer: string | null;
  resultText: string | null;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function readString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function readCompactGameInfoV2(data: unknown, lang = "ko"): CompactGameInfoV2 {
  if (!isPlainObject(data) || !isPlainObject(data.game_info)) {
    return { blackPlayer: null, whitePlayer: null, resultText: null };
  }
  const gi = data.game_info;
  const result = gi.result;
  const resultText =
    readString(result) ??
    (isPlainObject(result)
      ? readString(result[lang]) ?? readString(result.ko) ?? readString(result.en)
      : null);
  return {
    blackPlayer: readString(gi.black_player) ?? readString(gi.blackPlayer),
    whitePlayer: readString(gi.white_player) ?? readString(gi.whitePlayer),
    resultText,
  };
}

export function variationIdV2(row: Pick<AnalysisResultVariationPreviewV1, "turnIndex" | "source">): string {
  return `${row.turnIndex}:${row.source}`;
}

export function hasDisplayableVariationPvV2(row: Pick<AnalysisResultVariationPreviewV1, "pv">): boolean {
  return row.pv.some((m) => {
    if (typeof m !== "string") {
      return false;
    }
    const trimmed = m.trim();
    return trimmed.length > 0 && trimmed.toLowerCase() !== "pass" && /^[A-Za-z][1-9][0-9]*$/.test(trimmed);
  });
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

export function nextWinrateCollapsedV2(current: boolean): boolean {
  return !current;
}

export function nextTryPlayColorV3(startColor: "B" | "W", placedCount: number): "B" | "W" {
  return placedCount % 2 === 0 ? startColor : startColor === "B" ? "W" : "B";
}

export function canPlaceTryPlayStoneV3(occupiedKeys: Iterable<string>, x: number, y: number): boolean {
  return !new Set(occupiedKeys).has(`${x},${y}`);
}
