import type {
  ProductColorV1,
  ProductDecisiveMoveV1,
  ProductEventConfidenceV1,
  ProductReviewMoveV1,
} from "./analysisProductEventsV1";

export const EXPLANATION_PLANNER_V1_VERSION = "explanation-planner-v1" as const;

export type ExplanationPlanTargetTypeV1 = "decisive_move" | "review_move";

export type ExplanationPlanSeverityV1 = "low" | "medium" | "high";

export type ExplanationEvidenceBulletTypeV1 =
  | "score_loss"
  | "winrate_loss"
  | "bsi"
  | "adi"
  | "deep_search"
  | "timeline_context"
  | "pv"
  | "learning_event";

export type ExplanationEvidenceBulletUnitV1 = "points" | "ratio" | "percent" | "none";

export type ExplanationEvidenceBulletV1 = {
  type: ExplanationEvidenceBulletTypeV1;
  labelKey: string;
  value: number | string | null;
  unit: ExplanationEvidenceBulletUnitV1;
  textKey: string;
};

export type ExplanationPlanV1 = {
  version: typeof EXPLANATION_PLANNER_V1_VERSION;
  targetType: ExplanationPlanTargetTypeV1;
  turnIndex: number;
  player: ProductColorV1 | null;
  titleKey: string;
  summaryKey: string;
  severity: ExplanationPlanSeverityV1;
  confidence: ProductEventConfidenceV1;
  evidenceBullets: ExplanationEvidenceBulletV1[];
  referenceLine: {
    playedMove: string | null;
    recommendedMove: string | null;
    pv: string[];
  };
  caveats: string[];
  forbiddenLabelSafe: true;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function isColorOrNull(v: unknown): v is ProductColorV1 | null {
  return v === null || v === "B" || v === "W";
}

function isConfidence(v: unknown): v is ProductEventConfidenceV1 {
  return v === "low" || v === "medium" || v === "high";
}

function isSeverity(v: unknown): v is ExplanationPlanSeverityV1 {
  return v === "low" || v === "medium" || v === "high";
}

function isBulletType(v: unknown): v is ExplanationEvidenceBulletTypeV1 {
  return (
    v === "score_loss" ||
    v === "winrate_loss" ||
    v === "bsi" ||
    v === "adi" ||
    v === "deep_search" ||
    v === "timeline_context" ||
    v === "pv" ||
    v === "learning_event"
  );
}

function isBulletUnit(v: unknown): v is ExplanationEvidenceBulletUnitV1 {
  return v === "points" || v === "ratio" || v === "percent" || v === "none";
}

function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isValue(v: unknown): v is number | string | null {
  return v === null || typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
}

function positiveNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function positiveRatio(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1 ? v : null;
}

function makeBullet(
  type: ExplanationEvidenceBulletTypeV1,
  labelKey: string,
  value: number | string | null,
  unit: ExplanationEvidenceBulletUnitV1,
  textKey: string
): ExplanationEvidenceBulletV1 {
  return { type, labelKey, value, unit, textKey };
}

function pushEvidenceForSources(
  bullets: ExplanationEvidenceBulletV1[],
  sources: readonly string[],
  targetType: ExplanationPlanTargetTypeV1
): void {
  if (sources.includes("bsiV1")) {
    bullets.push(makeBullet("bsi", "ep_evidence_bsi", null, "none", "ep_text_bsi_context"));
  }
  if (sources.includes("adiV1")) {
    bullets.push(makeBullet("adi", "ep_evidence_adi", null, "none", targetType === "review_move" ? "ep_text_adi_review_context" : "ep_text_adi_supporting_context"));
  }
  if (sources.includes("deepSearchResultsV1")) {
    bullets.push(makeBullet("deep_search", "ep_evidence_deep_search", null, "none", "ep_text_deep_search_context"));
  }
  if (sources.includes("winrateTimelineV1")) {
    bullets.push(makeBullet("timeline_context", "ep_evidence_timeline_context", null, "none", "ep_text_timeline_context_not_loss"));
  }
  if (sources.includes("learningEventsV1")) {
    bullets.push(makeBullet("learning_event", "ep_evidence_learning_event", null, "none", "ep_text_learning_event_context"));
  }
}

function severityFromLoss(scoreLoss: number | null, winrateLoss: number | null, confidence: ProductEventConfidenceV1): ExplanationPlanSeverityV1 {
  if ((scoreLoss != null && scoreLoss >= 8) || (winrateLoss != null && winrateLoss >= 0.2)) {
    return "high";
  }
  if ((scoreLoss != null && scoreLoss >= 3) || (winrateLoss != null && winrateLoss >= 0.08) || confidence === "high") {
    return "medium";
  }
  return "low";
}

function caveatsFor(sources: readonly string[]): string[] {
  const caveats = ["ep_caveat_candidate_not_final_judgement"];
  if (sources.includes("winrateTimelineV1")) {
    caveats.push("ep_caveat_timeline_is_context_not_loss");
  }
  return caveats;
}

function planBase(args: {
  targetType: ExplanationPlanTargetTypeV1;
  turnIndex: number;
  player: ProductColorV1 | null;
  playedMove: string | null;
  recommendedMove: string | null;
  pv: string[];
  confidence: ProductEventConfidenceV1;
  titleKey: string;
  summaryKey: string;
  scoreLoss: number | null;
  winrateLoss: number | null;
  sources: readonly string[];
}): ExplanationPlanV1 {
  const evidenceBullets: ExplanationEvidenceBulletV1[] = [];
  if (args.scoreLoss != null) {
    evidenceBullets.push(makeBullet("score_loss", "ep_evidence_score_loss", args.scoreLoss, "points", "ep_text_score_loss_candidate"));
  }
  if (args.winrateLoss != null) {
    evidenceBullets.push(makeBullet("winrate_loss", "ep_evidence_winrate_loss", args.winrateLoss, "ratio", "ep_text_winrate_loss_candidate"));
  }
  pushEvidenceForSources(evidenceBullets, args.sources, args.targetType);
  if (args.pv.length > 0) {
    evidenceBullets.push(makeBullet("pv", "ep_evidence_reference_line", String(args.pv.length), "none", "ep_text_reference_line_available"));
  }

  return {
    version: EXPLANATION_PLANNER_V1_VERSION,
    targetType: args.targetType,
    turnIndex: args.turnIndex,
    player: args.player,
    titleKey: args.titleKey,
    summaryKey: args.summaryKey,
    severity: severityFromLoss(args.scoreLoss, args.winrateLoss, args.confidence),
    confidence: args.confidence,
    evidenceBullets,
    referenceLine: {
      playedMove: args.playedMove,
      recommendedMove: args.recommendedMove,
      pv: args.pv,
    },
    caveats: caveatsFor(args.sources),
    forbiddenLabelSafe: true,
  };
}

export function buildExplanationPlanForDecisiveMoveV1(move: ProductDecisiveMoveV1): ExplanationPlanV1 {
  return planBase({
    targetType: "decisive_move",
    turnIndex: move.turnIndex,
    player: move.player,
    playedMove: move.playedMove,
    recommendedMove: move.recommendedMove,
    pv: move.evidence.pv ?? [],
    confidence: move.confidence,
    titleKey: "ep_title_decisive_move_candidate",
    summaryKey: "ep_summary_decisive_loser_perspective_candidate",
    scoreLoss: positiveNumber(move.scoreLoss),
    winrateLoss: positiveRatio(move.winrateLoss),
    sources: move.evidence.source,
  });
}

export function buildExplanationPlanForReviewMoveV1(move: ProductReviewMoveV1): ExplanationPlanV1 {
  return planBase({
    targetType: "review_move",
    turnIndex: move.turnIndex,
    player: move.player,
    playedMove: move.playedMove,
    recommendedMove: move.recommendedMove,
    pv: move.evidence.pv ?? [],
    confidence: move.confidence,
    titleKey: "ep_title_review_move_candidate",
    summaryKey: move.category === "volatility_candidate" ? "ep_summary_review_timeline_context_candidate" : "ep_summary_review_learning_candidate",
    scoreLoss: positiveNumber(move.scoreLoss),
    winrateLoss: positiveRatio(move.winrateLoss),
    sources: move.evidence.source,
  });
}

export function isExplanationEvidenceBulletV1(v: unknown): v is ExplanationEvidenceBulletV1 {
  return (
    isPlainObject(v) &&
    isBulletType(v.type) &&
    typeof v.labelKey === "string" &&
    isValue(v.value) &&
    isBulletUnit(v.unit) &&
    typeof v.textKey === "string"
  );
}

export function isExplanationPlanV1(v: unknown): v is ExplanationPlanV1 {
  if (!isPlainObject(v)) {
    return false;
  }
  const referenceLine = v.referenceLine;
  return (
    v.version === EXPLANATION_PLANNER_V1_VERSION &&
    (v.targetType === "decisive_move" || v.targetType === "review_move") &&
    isNonNegativeInteger(v.turnIndex) &&
    isColorOrNull(v.player) &&
    typeof v.titleKey === "string" &&
    typeof v.summaryKey === "string" &&
    isSeverity(v.severity) &&
    isConfidence(v.confidence) &&
    Array.isArray(v.evidenceBullets) &&
    v.evidenceBullets.every(isExplanationEvidenceBulletV1) &&
    isPlainObject(referenceLine) &&
    isStringOrNull(referenceLine.playedMove) &&
    isStringOrNull(referenceLine.recommendedMove) &&
    isStringArray(referenceLine.pv) &&
    isStringArray(v.caveats) &&
    v.forbiddenLabelSafe === true
  );
}
