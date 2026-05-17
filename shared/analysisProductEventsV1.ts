export const ANALYSIS_PRODUCT_EVENTS_V1_VERSION = "analysis-product-events-v1" as const;

export type ProductColorV1 = "B" | "W";

export type ProductGameResultTypeV1 =
  | "points"
  | "resign"
  | "time"
  | "forfeit"
  | "draw"
  | "unknown";

export type ProductGameResultV1 = {
  winnerColor: ProductColorV1 | null;
  loserColor: ProductColorV1 | null;
  resultType: ProductGameResultTypeV1;
  margin: number | null;
  rawResult: string | null;
};

export type ProductEventConfidenceV1 = "low" | "medium" | "high";

export type ProductEventEvidenceSourceV1 =
  | "learningEventsV1"
  | "analysisPlan"
  | "turnAnalyses"
  | "bsiV1"
  | "adiV1"
  | "deepSearchResultsV1"
  | "winrateTimelineV1"
  | "manual";

export type ProductKeyMoveTaxonomyV25 =
  | "decisive_candidate"
  | "swing_candidate"
  | "learning_candidate"
  | "shape_review_candidate"
  | "direction_candidate"
  | "deep_search_candidate"
  | "volatility_candidate";

export type ProductEvidenceTypeV25 =
  | "loss_evidence"
  | "search_evidence"
  | "volatility_context"
  | "learning_context"
  | "deep_search_context";

export type ProductEvidenceBreakdownV25 = {
  taxonomy: ProductKeyMoveTaxonomyV25;
  evidenceTypes: ProductEvidenceTypeV25[];
  rankingScore: number;
  ranking: {
    scoreLoss: number;
    winrateLoss: number;
    playedMoveRank: number;
    bsi: number;
    adi: number;
    deepSearch: number;
    volatility: number;
    explainability: number;
    openingPenalty: number;
    duplicatePenalty: number;
  };
};

export type ProductEventEvidenceV1 = {
  source: ProductEventEvidenceSourceV1[];
  notes?: string[];
  pv?: string[];
  v25?: ProductEvidenceBreakdownV25;
};

export type ProductDecisiveMoveV1 = {
  turnIndex: number;
  player: ProductColorV1;
  playedMove: string | null;
  recommendedMove: string | null;
  /** 집 차이 단위. null 또는 0 이상 finite number. */
  scoreLoss: number | null;
  /** 0..1 비율 단위. null 또는 0 이상 1 이하 finite number. */
  winrateLoss: number | null;
  confidence: ProductEventConfidenceV1;
  sourceEventId: string | null;
  evidence: ProductEventEvidenceV1;
};

export type ProductReviewMoveCategoryV1 =
  | "learning_candidate"
  | "flow_shift_candidate"
  | "response_candidate"
  | "direction_candidate"
  | "shape_review_candidate"
  | "deep_search_candidate"
  | "volatility_candidate"
  | "score_shift_candidate"
  | "winrate_shift_candidate";

export type ProductReviewMoveV1 = {
  turnIndex: number;
  player: ProductColorV1;
  category: ProductReviewMoveCategoryV1;
  playedMove: string | null;
  recommendedMove: string | null;
  /** 집 차이 단위. null 또는 0 이상 finite number. */
  scoreLoss: number | null;
  /** 0..1 비율 단위. null 또는 0 이상 1 이하 finite number. */
  winrateLoss: number | null;
  confidence: ProductEventConfidenceV1;
  sourceEventId: string | null;
  evidence: ProductEventEvidenceV1;
};

export const PRODUCT_REVIEW_MOVE_CATEGORY_LABELS_V1: Record<ProductReviewMoveCategoryV1, string> = {
  learning_candidate: "학습 후보",
  flow_shift_candidate: "흐름 변화 후보",
  response_candidate: "응수 검토 후보",
  direction_candidate: "방향 검토 후보",
  shape_review_candidate: "모양 검토 후보",
  deep_search_candidate: "추가 탐색 후보",
  volatility_candidate: "변동 장면 후보",
  score_shift_candidate: "집 차이 변화 후보",
  winrate_shift_candidate: "승률 변화 후보",
};

export const PRODUCT_EVENT_CONFIDENCE_LABELS_V1: Record<ProductEventConfidenceV1, string> = {
  low: "낮음",
  medium: "보통",
  high: "높음",
};

const RESULT_TYPES = new Set<ProductGameResultTypeV1>([
  "points",
  "resign",
  "time",
  "forfeit",
  "draw",
  "unknown",
]);

const CONFIDENCE = new Set<ProductEventConfidenceV1>(["low", "medium", "high"]);

const EVIDENCE_SOURCES = new Set<ProductEventEvidenceSourceV1>([
  "learningEventsV1",
  "analysisPlan",
  "turnAnalyses",
  "bsiV1",
  "adiV1",
  "deepSearchResultsV1",
  "winrateTimelineV1",
  "manual",
]);

const KEY_MOVE_TAXONOMY_V25 = new Set<ProductKeyMoveTaxonomyV25>([
  "decisive_candidate",
  "swing_candidate",
  "learning_candidate",
  "shape_review_candidate",
  "direction_candidate",
  "deep_search_candidate",
  "volatility_candidate",
]);

const EVIDENCE_TYPES_V25 = new Set<ProductEvidenceTypeV25>([
  "loss_evidence",
  "search_evidence",
  "volatility_context",
  "learning_context",
  "deep_search_context",
]);

const REVIEW_CATEGORIES = new Set<ProductReviewMoveCategoryV1>([
  "learning_candidate",
  "flow_shift_candidate",
  "response_candidate",
  "direction_candidate",
  "shape_review_candidate",
  "deep_search_candidate",
  "volatility_candidate",
  "score_shift_candidate",
  "winrate_shift_candidate",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function isColor(v: unknown): v is ProductColorV1 {
  return v === "B" || v === "W";
}

function oppositeColor(color: ProductColorV1): ProductColorV1 {
  return color === "B" ? "W" : "B";
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function isFiniteNumberOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isFinite(v));
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonNegativeFiniteNumberOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
}

function isWinrateLossOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1);
}

function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isEvidenceSourceArray(v: unknown): v is ProductEventEvidenceSourceV1[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((x) => typeof x === "string" && EVIDENCE_SOURCES.has(x as ProductEventEvidenceSourceV1))
  );
}

function isEvidenceTypeArrayV25(v: unknown): v is ProductEvidenceTypeV25[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string" && EVIDENCE_TYPES_V25.has(x as ProductEvidenceTypeV25));
}

function isRankingBreakdownV25(v: unknown): boolean {
  if (!isPlainObject(v)) {
    return false;
  }
  return (
    isFiniteNumber(v.scoreLoss) &&
    isFiniteNumber(v.winrateLoss) &&
    isFiniteNumber(v.playedMoveRank) &&
    isFiniteNumber(v.bsi) &&
    isFiniteNumber(v.adi) &&
    isFiniteNumber(v.deepSearch) &&
    isFiniteNumber(v.volatility) &&
    isFiniteNumber(v.explainability) &&
    isFiniteNumber(v.openingPenalty) &&
    isFiniteNumber(v.duplicatePenalty)
  );
}

function isProductEvidenceBreakdownV25(v: unknown): v is ProductEvidenceBreakdownV25 {
  if (!isPlainObject(v)) {
    return false;
  }
  return (
    typeof v.taxonomy === "string" &&
    KEY_MOVE_TAXONOMY_V25.has(v.taxonomy as ProductKeyMoveTaxonomyV25) &&
    isEvidenceTypeArrayV25(v.evidenceTypes) &&
    isFiniteNumber(v.rankingScore) &&
    isRankingBreakdownV25(v.ranking)
  );
}

function readSgfBracketValue(s: string, bracketStart: number): { text: string; end: number } | null {
  if (s[bracketStart] !== "[") {
    return null;
  }
  let out = "";
  for (let i = bracketStart + 1; i < s.length; i += 1) {
    const ch = s[i]!;
    if (ch === "\\") {
      if (i + 1 < s.length) {
        out += s[i + 1]!;
        i += 1;
      }
      continue;
    }
    if (ch === "]") {
      return { text: out, end: i + 1 };
    }
    out += ch;
  }
  return null;
}

function findRootSgfPropertyValue(sgf: string, propId: string): string | null {
  const s = sgf.replace(/\r\n|\r|\n/g, " ");
  const rootIdx = s.indexOf("(;");
  if (rootIdx < 0) {
    return null;
  }
  const target = propId.toUpperCase();
  let i = rootIdx + 2;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === ";") {
      return null;
    }
    if (ch === "(" || ch === ")") {
      return null;
    }
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (!/[A-Za-z]/.test(ch)) {
      i += 1;
      continue;
    }
    const idStart = i;
    while (i < s.length && /[A-Za-z]/.test(s[i]!)) {
      i += 1;
    }
    const id = s.slice(idStart, i).toUpperCase();
    while (i < s.length && /\s/.test(s[i]!)) {
      i += 1;
    }
    if (s[i] !== "[") {
      continue;
    }
    const firstValue = readSgfBracketValue(s, i);
    if (firstValue == null) {
      return null;
    }
    if (id === target) {
      return firstValue.text;
    }
    i = firstValue.end;
    while (s[i] === "[") {
      const extra = readSgfBracketValue(s, i);
      if (extra == null) {
        return null;
      }
      i = extra.end;
    }
  }
  return null;
}

export function parseProductGameResultV1(rawResult: string | null | undefined): ProductGameResultV1 {
  const raw = typeof rawResult === "string" ? rawResult.trim() : "";
  if (!raw) {
    return { winnerColor: null, loserColor: null, resultType: "unknown", margin: null, rawResult: null };
  }

  const normalized = raw.replace(/\s+/g, "");
  const lower = normalized.toLowerCase();
  if (lower === "0" || lower === "draw" || lower === "jigo") {
    return { winnerColor: null, loserColor: null, resultType: "draw", margin: null, rawResult: raw };
  }

  const match = normalized.match(/^([BW])\+(.+)$/i);
  if (match == null) {
    return { winnerColor: null, loserColor: null, resultType: "unknown", margin: null, rawResult: raw };
  }

  const winnerColor = match[1]!.toUpperCase() as ProductColorV1;
  const loserColor = oppositeColor(winnerColor);
  const suffix = match[2]!.toLowerCase();
  const pointSuffix = suffix.replace(",", ".");
  if (/^\d+(?:\.\d+)?$/.test(pointSuffix)) {
    const pointMargin = Number(pointSuffix);
    if (pointMargin <= 0) {
      return { winnerColor: null, loserColor: null, resultType: "unknown", margin: null, rawResult: raw };
    }
    return { winnerColor, loserColor, resultType: "points", margin: pointMargin, rawResult: raw };
  }
  if (suffix === "r" || suffix === "resign" || suffix === "resignation") {
    return { winnerColor, loserColor, resultType: "resign", margin: null, rawResult: raw };
  }
  if (suffix === "t" || suffix === "time") {
    return { winnerColor, loserColor, resultType: "time", margin: null, rawResult: raw };
  }
  if (suffix === "f" || suffix === "forfeit") {
    return { winnerColor, loserColor, resultType: "forfeit", margin: null, rawResult: raw };
  }
  return { winnerColor: null, loserColor: null, resultType: "unknown", margin: null, rawResult: raw };
}

export function parseProductGameResultV1FromSgf(sgf: string): ProductGameResultV1 {
  return parseProductGameResultV1(findRootSgfPropertyValue(sgf, "RE"));
}

export function isProductGameResultV1(v: unknown): v is ProductGameResultV1 {
  if (!isPlainObject(v)) {
    return false;
  }
  if (
    !(v.winnerColor === null || isColor(v.winnerColor)) ||
    !(v.loserColor === null || isColor(v.loserColor)) ||
    typeof v.resultType !== "string" ||
    !RESULT_TYPES.has(v.resultType as ProductGameResultTypeV1) ||
    !isFiniteNumberOrNull(v.margin) ||
    !isStringOrNull(v.rawResult)
  ) {
    return false;
  }

  if (v.winnerColor != null && v.loserColor != null && v.winnerColor === v.loserColor) {
    return false;
  }

  if (v.resultType === "draw" || v.resultType === "unknown") {
    return v.winnerColor === null && v.loserColor === null && v.margin === null;
  }

  if (v.winnerColor == null || v.loserColor == null) {
    return false;
  }

  if (v.resultType === "points") {
    return typeof v.margin === "number" && Number.isFinite(v.margin) && v.margin > 0;
  }

  return v.margin === null;
}

export function isProductEventEvidenceV1(v: unknown): v is ProductEventEvidenceV1 {
  if (!isPlainObject(v)) {
    return false;
  }
  return (
    isEvidenceSourceArray(v.source) &&
    (v.notes === undefined || isStringArray(v.notes)) &&
    (v.pv === undefined || isStringArray(v.pv)) &&
    (v.v25 === undefined || isProductEvidenceBreakdownV25(v.v25))
  );
}

function hasProductMoveFields(v: Record<string, unknown>): boolean {
  return (
    isNonNegativeInteger(v.turnIndex) &&
    isColor(v.player) &&
    isStringOrNull(v.playedMove) &&
    isStringOrNull(v.recommendedMove) &&
    isNonNegativeFiniteNumberOrNull(v.scoreLoss) &&
    isWinrateLossOrNull(v.winrateLoss) &&
    typeof v.confidence === "string" &&
    CONFIDENCE.has(v.confidence as ProductEventConfidenceV1) &&
    isStringOrNull(v.sourceEventId) &&
    isProductEventEvidenceV1(v.evidence)
  );
}

export function isProductDecisiveMoveV1(v: unknown): v is ProductDecisiveMoveV1 {
  return isPlainObject(v) && hasProductMoveFields(v);
}

export function isProductReviewMoveV1(v: unknown): v is ProductReviewMoveV1 {
  return (
    isPlainObject(v) &&
    hasProductMoveFields(v) &&
    typeof v.category === "string" &&
    REVIEW_CATEGORIES.has(v.category as ProductReviewMoveCategoryV1)
  );
}
