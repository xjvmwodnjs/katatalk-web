import type { ExplanationPlanBulletV2 } from "./explanationPlannerV2";

export type ExplanationEvidenceLabelKeyV1 =
  | "score_loss"
  | "winrate_loss"
  | "concept_hint"
  | "candidate_comparison"
  | "pv_reference"
  | "volatility_context"
  | "deep_search_context"
  | "caveat"
  | "additional_evidence";

const SGF_FRAGMENT_RE = /(^|[^A-Za-z])(?:B|W|C|SZ|FF|GM|AB|AW|AE|RE|KM)\[[^\]\r\n]{0,80}\]/;

function isUnsafeEvidenceText(raw: string): boolean {
  return SGF_FRAGMENT_RE.test(raw) || /\(;\s*(?=[\s\S]{0,200}(?:FF\[|GM\[|B\[|W\[))[\s\S]*?\)\s*/i.test(raw);
}

function labelForEvidence(raw: string, bulletType: ExplanationPlanBulletV2["type"]): ExplanationEvidenceLabelKeyV1 | null {
  if (isUnsafeEvidenceText(raw)) {
    return "additional_evidence";
  }
  if (/^scoreLoss=/.test(raw)) {
    return bulletType === "score_loss" ? "score_loss" : "additional_evidence";
  }
  if (/^winrateLoss=/.test(raw)) {
    return bulletType === "winrate_loss" ? "winrate_loss" : "additional_evidence";
  }
  if (/^concept=/.test(raw)) {
    return "concept_hint";
  }
  if (/^(comparisonType=|delta=)/.test(raw)) {
    return "candidate_comparison";
  }
  if (/^pvLength=/.test(raw)) {
    return "pv_reference";
  }
  if (raw === "volatility_context_available") {
    return "volatility_context";
  }
  if (raw === "deep_search_context_available") {
    return "deep_search_context";
  }
  if (/^(v25Taxonomy=|v25EvidenceTypes=)/.test(raw)) {
    return "caveat";
  }
  return null;
}

export function mapExplanationEvidenceLabelsV1(bullet: Pick<ExplanationPlanBulletV2, "type" | "evidence">): ExplanationEvidenceLabelKeyV1[] {
  const labels: ExplanationEvidenceLabelKeyV1[] = [];
  for (const raw of bullet.evidence) {
    const label = labelForEvidence(raw, bullet.type) ?? "additional_evidence";
    if (!labels.includes(label)) {
      labels.push(label);
    }
  }
  return labels;
}
