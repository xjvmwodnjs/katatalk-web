import type {
  ProductCandidateComparisonDeltaV1,
  ProductDecisiveMoveV1,
  ProductGameResultV1,
  ProductReviewMoveV1,
} from "./analysisProductEventsV1";

export const EXPLANATION_PLANNER_V2_VERSION = "v2" as const;

export type ExplanationAudienceV2 = "beginner" | "intermediate" | "dan" | "high_dan";
export type ExplanationPlanTargetTypeV2 = "decisive_move" | "review_move";
export type ExplanationPlanBulletTypeV2 =
  | "score_loss"
  | "winrate_loss"
  | "concept_hint"
  | "candidate_comparison"
  | "pv_reference"
  | "volatility_context"
  | "deep_search_context"
  | "caveat";
export type ExplanationPlanBulletUnitV2 = "points" | "ratio" | "percent" | "none";

export type ExplanationPlanBulletV2 = {
  type: ExplanationPlanBulletTypeV2;
  textKey: string;
  value?: number | null;
  unit?: ExplanationPlanBulletUnitV2;
  evidence: string[];
};

export type ExplanationPlanV2 = {
  version: typeof EXPLANATION_PLANNER_V2_VERSION;
  audience: ExplanationAudienceV2;
  targetType: ExplanationPlanTargetTypeV2;
  turnIndex: number;
  titleKey: string;
  summaryKey: string;
  bullets: ExplanationPlanBulletV2[];
  forbiddenClaims: string[];
  caveats: string[];
};

type ProductMoveV2 = ProductDecisiveMoveV1 | ProductReviewMoveV1;

const AUDIENCES = new Set<ExplanationAudienceV2>(["beginner", "intermediate", "dan", "high_dan"]);
const TARGET_TYPES = new Set<ExplanationPlanTargetTypeV2>(["decisive_move", "review_move"]);
const BULLET_TYPES = new Set<ExplanationPlanBulletTypeV2>([
  "score_loss",
  "winrate_loss",
  "concept_hint",
  "candidate_comparison",
  "pv_reference",
  "volatility_context",
  "deep_search_context",
  "caveat",
]);
const UNITS = new Set<ExplanationPlanBulletUnitV2>(["points", "ratio", "percent", "none"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isSafeExplanationStringV2(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s.length === 0 || s.length > 160) return false;
  if (/\(;\s*(?=[\s\S]{0,200}(?:FF\[|GM\[|B\[|W\[))[\s\S]*?\)\s*/i.test(s)) return false;
  if (/(^|[^A-Za-z])(?:B|W|C|SZ|FF|GM|AB|AW|AE|RE|KM)\[[^\]\r\n]{0,80}\]/.test(s)) return false;
  if (/[A-Za-z]:\\(?:[^\\\r\n]+\\)+[^\s\r\n]+/.test(s) || /\/(?:Users|home|opt|usr|var)\/[^\s"'`]+/.test(s)) return false;
  if (/(?:sk|pk|rk|key|token|secret)_[A-Za-z0-9_-]{12,}/i.test(s)) return false;
  if (/[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(s)) return false;
  if (/\b[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/.test(s)) return false;
  return true;
}

function safeStrings(values: string[]): string[] {
  return values.filter(isSafeExplanationStringV2);
}

function isSafeStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isSafeExplanationStringV2);
}

function positiveScore(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function positiveRatio(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1 ? v : null;
}

function audienceOrDefault(audience: ExplanationAudienceV2 | null | undefined): ExplanationAudienceV2 {
  return audience != null && AUDIENCES.has(audience) ? audience : "dan";
}

function pushBullet(
  bullets: ExplanationPlanBulletV2[],
  bullet: ExplanationPlanBulletV2
): void {
  const evidence = safeStrings(bullet.evidence);
  if (evidence.length === 0) return;
  bullets.push({ ...bullet, evidence });
}

function conceptEvidence(move: ProductMoveV2): string[] {
  return safeStrings((move.conceptTagsV1 ?? []).map((tag) => `concept=${tag.tag}:${tag.confidence}`));
}

function comparisonEvidence(move: ProductMoveV2, preferredTypes?: ProductCandidateComparisonDeltaV1["type"][]): string[] {
  const comparison = move.candidateComparisonV1;
  if (comparison == null) return [];
  const deltas = preferredTypes == null ? comparison.deltas : comparison.deltas.filter((delta) => preferredTypes.includes(delta.type));
  return safeStrings([
    `comparisonType=${comparison.comparisonType}`,
    ...deltas.map((delta) => `delta=${delta.type}:${delta.severity}`),
  ]);
}

function forbiddenClaims(move: ProductMoveV2): string[] {
  return safeStrings([
    ...(move.forbiddenConceptClaims ?? []).map((claim) => `${claim.concept}:${claim.reason}`),
    ...(move.candidateComparisonV1?.forbiddenClaims ?? []),
  ]);
}

function baseCaveats(move: ProductMoveV2): string[] {
  return safeStrings([
    "explanation_material_only",
    "concept_tags_are_conservative_hints",
    "candidate_comparison_not_verdict",
    ...(move.evidence.source.includes("winrateTimelineV1") ? ["volatility_context_not_loss"] : []),
  ]);
}

function titleKey(targetType: ExplanationPlanTargetTypeV2): string {
  return targetType === "decisive_move" ? "ep2_title_decisive_candidate" : "ep2_title_review_candidate";
}

function summaryKey(targetType: ExplanationPlanTargetTypeV2, audience: ExplanationAudienceV2): string {
  return `ep2_summary_${targetType}_${audience}`;
}

export function buildExplanationPlanV2(args: {
  move: ProductMoveV2;
  targetType: ExplanationPlanTargetTypeV2;
  audience?: ExplanationAudienceV2 | null;
  gameResult?: ProductGameResultV1 | null;
}): ExplanationPlanV2 {
  const audience = audienceOrDefault(args.audience);
  const move = args.move;
  const bullets: ExplanationPlanBulletV2[] = [];
  const scoreLoss = positiveScore(move.scoreLoss);
  const winrateLoss = positiveRatio(move.winrateLoss);
  const concept = conceptEvidence(move);
  const comparison = comparisonEvidence(move);
  const pv = move.evidence.pv ?? [];

  if (audience === "beginner") {
    pushBullet(bullets, { type: "concept_hint", textKey: "ep2_text_concept_hint_beginner", unit: "none", evidence: concept });
    if (scoreLoss != null) pushBullet(bullets, { type: "score_loss", textKey: "ep2_text_score_loss_light", value: scoreLoss, unit: "points", evidence: [`scoreLoss=${scoreLoss}`] });
    pushBullet(bullets, { type: "candidate_comparison", textKey: "ep2_text_candidate_comparison_simple", unit: "none", evidence: comparison.slice(0, 2) });
  } else if (audience === "intermediate") {
    pushBullet(bullets, { type: "concept_hint", textKey: "ep2_text_concept_hint_intermediate", unit: "none", evidence: concept });
    if (scoreLoss != null) pushBullet(bullets, { type: "score_loss", textKey: "ep2_text_score_loss", value: scoreLoss, unit: "points", evidence: [`scoreLoss=${scoreLoss}`] });
    if (winrateLoss != null) pushBullet(bullets, { type: "winrate_loss", textKey: "ep2_text_winrate_loss", value: winrateLoss, unit: "ratio", evidence: [`winrateLoss=${Math.round(winrateLoss * 1000) / 1000}`] });
    pushBullet(bullets, { type: "candidate_comparison", textKey: "ep2_text_candidate_comparison", unit: "none", evidence: comparison.slice(0, 3) });
  } else {
    if (scoreLoss != null) pushBullet(bullets, { type: "score_loss", textKey: "ep2_text_score_loss", value: scoreLoss, unit: "points", evidence: [`scoreLoss=${scoreLoss}`] });
    if (winrateLoss != null) pushBullet(bullets, { type: "winrate_loss", textKey: "ep2_text_winrate_loss", value: winrateLoss, unit: "ratio", evidence: [`winrateLoss=${Math.round(winrateLoss * 1000) / 1000}`] });
    pushBullet(bullets, { type: "candidate_comparison", textKey: "ep2_text_candidate_comparison", unit: "none", evidence: comparison });
    pushBullet(bullets, { type: "concept_hint", textKey: "ep2_text_concept_hint", unit: "none", evidence: concept });
  }

  if (pv.length > 0 && audience !== "beginner") {
    pushBullet(bullets, { type: "pv_reference", textKey: "ep2_text_pv_reference", value: pv.length, unit: "none", evidence: [`pvLength=${pv.length}`] });
  }
  if (move.evidence.v25?.evidenceTypes.includes("volatility_context")) {
    pushBullet(bullets, { type: "volatility_context", textKey: "ep2_text_volatility_context", unit: "none", evidence: ["volatility_context_available"] });
  }
  if (move.evidence.v25?.evidenceTypes.includes("deep_search_context")) {
    pushBullet(bullets, { type: "deep_search_context", textKey: "ep2_text_deep_search_context", unit: "none", evidence: ["deep_search_context_available"] });
  }
  if (audience === "high_dan") {
    pushBullet(bullets, { type: "caveat", textKey: "ep2_text_v25_ranking_context", unit: "none", evidence: [`v25Taxonomy=${move.evidence.v25?.taxonomy ?? "none"}`, `v25EvidenceTypes=${move.evidence.v25?.evidenceTypes.join("_") ?? "none"}`] });
  }

  return {
    version: EXPLANATION_PLANNER_V2_VERSION,
    audience,
    targetType: args.targetType,
    turnIndex: move.turnIndex,
    titleKey: titleKey(args.targetType),
    summaryKey: summaryKey(args.targetType, audience),
    bullets,
    forbiddenClaims: forbiddenClaims(move),
    caveats: baseCaveats(move),
  };
}

export function buildExplanationPlanV2ForDecisiveMove(move: ProductDecisiveMoveV1, audience?: ExplanationAudienceV2 | null): ExplanationPlanV2 {
  return buildExplanationPlanV2({ move, targetType: "decisive_move", audience });
}

export function buildExplanationPlanV2ForReviewMove(move: ProductReviewMoveV1, audience?: ExplanationAudienceV2 | null): ExplanationPlanV2 {
  return buildExplanationPlanV2({ move, targetType: "review_move", audience });
}

export function isExplanationPlanBulletV2(v: unknown): v is ExplanationPlanBulletV2 {
  return (
    isPlainObject(v) &&
    typeof v.type === "string" &&
    BULLET_TYPES.has(v.type as ExplanationPlanBulletTypeV2) &&
    typeof v.textKey === "string" &&
    isSafeExplanationStringV2(v.textKey) &&
    (v.value === undefined || v.value === null || (typeof v.value === "number" && Number.isFinite(v.value))) &&
    (v.unit === undefined || (typeof v.unit === "string" && UNITS.has(v.unit as ExplanationPlanBulletUnitV2))) &&
    isSafeStringArray(v.evidence)
  );
}

export function isExplanationPlanV2(v: unknown): v is ExplanationPlanV2 {
  return (
    isPlainObject(v) &&
    v.version === EXPLANATION_PLANNER_V2_VERSION &&
    typeof v.audience === "string" &&
    AUDIENCES.has(v.audience as ExplanationAudienceV2) &&
    typeof v.targetType === "string" &&
    TARGET_TYPES.has(v.targetType as ExplanationPlanTargetTypeV2) &&
    isNonNegativeInteger(v.turnIndex) &&
    typeof v.titleKey === "string" &&
    isSafeExplanationStringV2(v.titleKey) &&
    typeof v.summaryKey === "string" &&
    isSafeExplanationStringV2(v.summaryKey) &&
    Array.isArray(v.bullets) &&
    v.bullets.every(isExplanationPlanBulletV2) &&
    isSafeStringArray(v.forbiddenClaims) &&
    isSafeStringArray(v.caveats)
  );
}
