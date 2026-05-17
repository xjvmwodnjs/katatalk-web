import type {
  ProductCandidateComparisonDeltaTypeV1,
  ProductCandidateComparisonSeverityV1,
  ProductCandidateComparisonV1,
  ProductConceptTagEvidenceV1,
  ProductDecisiveMoveV1,
  ProductForbiddenConceptClaimV1,
  ProductReviewMoveV1,
} from "./analysisProductEventsV1";

export const CANDIDATE_COMPARISON_V1_VERSION = "candidate-comparison-v1" as const;

export type BuildCandidateComparisonV1Input = {
  turnIndex: number;
  playedMove: string | null;
  recommendedMove: string | null;
  pv?: string[];
  scoreLoss: number | null;
  winrateLoss: number | null;
  conceptTagsV1?: ProductConceptTagEvidenceV1[];
  forbiddenConceptClaims?: ProductForbiddenConceptClaimV1[];
};

type ProductMoveWithComparisonV1 = (ProductDecisiveMoveV1 | ProductReviewMoveV1) & {
  candidateComparisonV1?: ProductCandidateComparisonV1;
};

function isSafeComparisonStringV1(v: unknown): v is string {
  if (typeof v !== "string") {
    return false;
  }
  const s = v.trim();
  if (s.length === 0 || s.length > 160) {
    return false;
  }
  if (/\(;\s*(?=[\s\S]{0,200}(?:FF\[|GM\[|B\[|W\[))[\s\S]*?\)\s*/i.test(s)) {
    return false;
  }
  if (/(^|[^A-Za-z])(?:B|W|C|SZ|FF|GM|AB|AW|AE|RE|KM)\[[^\]\r\n]{0,80}\]/.test(s)) {
    return false;
  }
  if (/[A-Za-z]:\\(?:[^\\\r\n]+\\)+[^\s\r\n]+/.test(s) || /\/(?:Users|home|opt|usr|var)\/[^\s"'`]+/.test(s)) {
    return false;
  }
  if (/(?:sk|pk|rk|key|token|secret)_[A-Za-z0-9_-]{12,}/i.test(s)) {
    return false;
  }
  if (/[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/.test(s)) {
    return false;
  }
  if (/\b[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/.test(s)) {
    return false;
  }
  return true;
}

function safeStrings(values: string[]): string[] {
  return values.filter(isSafeComparisonStringV1);
}

function addDelta(
  deltas: ProductCandidateComparisonV1["deltas"],
  type: ProductCandidateComparisonDeltaTypeV1,
  severity: ProductCandidateComparisonSeverityV1,
  evidence: string[],
  caveats: string[]
): void {
  const safeEvidence = safeStrings(evidence);
  const safeCaveats = safeStrings(caveats);
  if (safeEvidence.length === 0) {
    return;
  }
  deltas.push({ type, severity, evidence: safeEvidence, caveats: safeCaveats });
}

function scoreSeverity(loss: number): ProductCandidateComparisonSeverityV1 {
  if (loss >= 8) return "high";
  if (loss >= 2) return "medium";
  return "low";
}

function winrateSeverity(loss: number): ProductCandidateComparisonSeverityV1 {
  if (loss >= 0.15) return "high";
  if (loss >= 0.05) return "medium";
  return "low";
}

function conceptSeverity(tags: ProductConceptTagEvidenceV1[]): ProductCandidateComparisonSeverityV1 {
  return tags.some((tag) => tag.confidence === "high") ? "medium" : "low";
}

function comparisonTypeFor(input: BuildCandidateComparisonV1Input): ProductCandidateComparisonV1["comparisonType"] {
  if (input.playedMove == null) {
    return "insufficient_data";
  }
  if (input.recommendedMove == null) {
    return "no_recommendation";
  }
  return input.playedMove === input.recommendedMove ? "same_move" : "move_difference";
}

export function buildCandidateComparisonV1(input: BuildCandidateComparisonV1Input): ProductCandidateComparisonV1 {
  const deltas: ProductCandidateComparisonV1["deltas"] = [];
  const comparisonType = comparisonTypeFor(input);
  const caveats = ["comparison_material_only"];

  if (typeof input.scoreLoss === "number" && Number.isFinite(input.scoreLoss) && input.scoreLoss > 0) {
    addDelta(deltas, "score_loss", scoreSeverity(input.scoreLoss), [`scoreLoss=${input.scoreLoss}`], caveats);
  }
  if (typeof input.winrateLoss === "number" && Number.isFinite(input.winrateLoss) && input.winrateLoss > 0) {
    addDelta(deltas, "winrate_loss", winrateSeverity(input.winrateLoss), [`winrateLoss=${Math.round(input.winrateLoss * 1000) / 1000}`], caveats);
  }

  const conceptTags = input.conceptTagsV1 ?? [];
  if (conceptTags.length > 0) {
    addDelta(
      deltas,
      "concept_difference",
      conceptSeverity(conceptTags),
      conceptTags.map((tag) => `concept=${tag.tag}:${tag.confidence}`),
      ["concept_tags_are_conservative_hints"]
    );
    if (conceptTags.some((tag) => tag.tag === "connection" || tag.tag === "cut" || tag.tag === "shape")) {
      addDelta(deltas, "local_shape", "low", ["local_shape_hint_from_concept_tags"], ["not_a_shape_reading"]);
    }
    if (conceptTags.some((tag) => tag.tag === "endgame" || tag.tag === "sente_context" || tag.tag === "gote_context" || tag.tag === "tenuki_context")) {
      addDelta(deltas, "timing", "low", ["timing_hint_from_concept_tags"], ["not_a_timing_judgment"]);
    }
  }

  const pv = input.pv ?? [];
  if (pv.length > 0 && input.recommendedMove != null) {
    addDelta(deltas, "pv_direction", "low", [`pvLength=${pv.length}`, `recommendedMove=${input.recommendedMove}`], ["pv_is_reference_line"]);
  }

  const forbiddenClaims = safeStrings(
    (input.forbiddenConceptClaims ?? []).map((claim) => `${claim.concept}:${claim.reason}`)
  );

  return {
    turnIndex: input.turnIndex,
    playedMove: input.playedMove,
    recommendedMove: input.recommendedMove,
    comparisonType,
    deltas,
    forbiddenClaims,
  };
}

export function attachCandidateComparisonToProductMoveV1<T extends ProductMoveWithComparisonV1>(move: T): T {
  return {
    ...move,
    candidateComparisonV1: buildCandidateComparisonV1({
      turnIndex: move.turnIndex,
      playedMove: move.playedMove,
      recommendedMove: move.recommendedMove,
      pv: move.evidence.pv ?? [],
      scoreLoss: move.scoreLoss,
      winrateLoss: move.winrateLoss,
      conceptTagsV1: move.conceptTagsV1 ?? [],
      forbiddenConceptClaims: move.forbiddenConceptClaims ?? [],
    }),
  };
}
