import type {
  ExplanationEvidenceBulletV1,
  ExplanationPlanV1,
} from "./explanationPlannerV1";
import {
  EXPLANATION_PLANNER_V1_VERSION,
  isExplanationPlanV1,
} from "./explanationPlannerV1";

export const LLM_COMMENTARY_GUARD_V1_VERSION = "llm-commentary-guard-v1" as const;

export type LlmCommentaryGuardIssueV1 =
  | "invalid_plan_schema"
  | "invalid_evidence_invariant"
  | "unsafe_reference_line"
  | "unsafe_string_payload"
  | "forbidden_label";

export type LlmCommentaryGuardResultV1 =
  | { ok: true; plan: ExplanationPlanV1; issues: [] }
  | { ok: false; plan: null; issues: LlmCommentaryGuardIssueV1[] };

export type LlmCommentaryOutputV1 = {
  version: typeof LLM_COMMENTARY_GUARD_V1_VERSION;
  title: string;
  body: string;
  bullets: string[];
  caveat: string | null;
};

export type LlmCommentaryOutputGuardResultV1 =
  | { ok: true; output: LlmCommentaryOutputV1; issues: [] }
  | { ok: false; output: null; issues: LlmCommentaryGuardIssueV1[] };

const FORBIDDEN_LABEL_RE = /패착\s*확정|완착\s*확정|악수|정답|best\s*move|blunder/i;
const RAW_SGF_RE = /\(\s*;|;[BW]\[[a-z]{0,2}\]|(?:AB|AW|AE)\[[a-z]{2}\]/i;
const SECRET_OR_PATH_RE =
  /(?:api[_-]?key|secret|token|password|SUPABASE_|KATAGO_|OPENAI_|ANTHROPIC_|[A-Za-z]:\\|\/(?:home|users|etc|var)\/)/i;
const GTP_MOVE_RE = /^(?:[A-HJ-T](?:[1-9]|1[0-9]))$/i;

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function isPositiveFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function isSafeString(v: string, maxLength = 240): boolean {
  return (
    v.length <= maxLength &&
    !RAW_SGF_RE.test(v) &&
    !SECRET_OR_PATH_RE.test(v)
  );
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out);
    }
    return out;
  }
  if (value != null && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStrings(item, out);
    }
  }
  return out;
}

export function containsForbiddenCommentaryLabelV1(value: unknown): boolean {
  return collectStrings(value).some((s) => FORBIDDEN_LABEL_RE.test(s));
}

export function containsUnsafeCommentaryPayloadV1(value: unknown): boolean {
  return collectStrings(value).some((s) => !isSafeString(s));
}

export function sanitizeGtpMoveV1(move: string | null): string | null {
  if (move == null) {
    return null;
  }
  const trimmed = move.trim();
  if (/^pass$/i.test(trimmed)) {
    return "pass";
  }
  return GTP_MOVE_RE.test(trimmed) ? trimmed.toUpperCase() : null;
}

export function sanitizeReferenceLineV1(referenceLine: ExplanationPlanV1["referenceLine"]): ExplanationPlanV1["referenceLine"] {
  return {
    playedMove: sanitizeGtpMoveV1(referenceLine.playedMove),
    recommendedMove: sanitizeGtpMoveV1(referenceLine.recommendedMove),
    pv: referenceLine.pv.map(sanitizeGtpMoveV1).filter((move): move is string => move != null),
  };
}

function isValidBulletInvariant(bullet: ExplanationEvidenceBulletV1): boolean {
  switch (bullet.type) {
    case "score_loss":
      return bullet.unit === "points" && isPositiveFiniteNumber(bullet.value);
    case "winrate_loss":
      if (!isPositiveFiniteNumber(bullet.value)) return false;
      if (bullet.unit === "ratio") return bullet.value <= 1;
      if (bullet.unit === "percent") return bullet.value <= 100;
      return false;
    case "timeline_context":
      return (
        (bullet.unit === "none" && (bullet.value == null || typeof bullet.value === "string")) ||
        (bullet.unit === "percent" && isPositiveFiniteNumber(bullet.value) && bullet.value <= 100)
      );
    case "adi":
    case "bsi":
    case "deep_search":
    case "learning_event":
    case "pv":
      return bullet.unit === "none";
    default:
      return false;
  }
}

function hasUnsafePlanStrings(plan: ExplanationPlanV1): boolean {
  const strings = [
    plan.titleKey,
    plan.summaryKey,
    ...plan.caveats,
    ...plan.evidenceBullets.flatMap((b) => [b.labelKey, b.textKey, typeof b.value === "string" ? b.value : ""]),
  ];
  return strings.some((s) => s.length > 0 && !isSafeString(s, 160));
}

export function validateAndNormalizeExplanationPlanForLlmV1(input: unknown): LlmCommentaryGuardResultV1 {
  const issues: LlmCommentaryGuardIssueV1[] = [];
  if (!isExplanationPlanV1(input) || input.version !== EXPLANATION_PLANNER_V1_VERSION) {
    return { ok: false, plan: null, issues: ["invalid_plan_schema"] };
  }

  const sanitizedReferenceLine = sanitizeReferenceLineV1(input.referenceLine);
  const hadUnsafeReference =
    sanitizedReferenceLine.playedMove !== input.referenceLine.playedMove ||
    sanitizedReferenceLine.recommendedMove !== input.referenceLine.recommendedMove ||
    sanitizedReferenceLine.pv.length !== input.referenceLine.pv.length ||
    sanitizedReferenceLine.pv.some((move, idx) => move !== input.referenceLine.pv[idx]);

  if (input.evidenceBullets.some((bullet) => !isValidBulletInvariant(bullet))) {
    issues.push("invalid_evidence_invariant");
  }
  if (hasUnsafePlanStrings(input)) {
    issues.push("unsafe_string_payload");
  }
  if (containsForbiddenCommentaryLabelV1(input)) {
    issues.push("forbidden_label");
  }
  if (issues.length > 0) {
    return { ok: false, plan: null, issues: uniq(issues) };
  }

  const normalizedPlan: ExplanationPlanV1 = {
    ...input,
    referenceLine: sanitizedReferenceLine,
  };

  if (hadUnsafeReference && sanitizedReferenceLine.playedMove == null && input.referenceLine.playedMove != null) {
    return { ok: false, plan: null, issues: ["unsafe_reference_line"] };
  }

  return { ok: true, plan: normalizedPlan, issues: [] };
}

function isSafeOutputShape(value: unknown): value is LlmCommentaryOutputV1 {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    obj.version === LLM_COMMENTARY_GUARD_V1_VERSION &&
    typeof obj.title === "string" &&
    typeof obj.body === "string" &&
    Array.isArray(obj.bullets) &&
    obj.bullets.every((b) => typeof b === "string") &&
    (obj.caveat === null || typeof obj.caveat === "string")
  );
}

export function validateLlmCommentaryOutputV1(output: unknown): LlmCommentaryOutputGuardResultV1 {
  if (!isSafeOutputShape(output)) {
    return { ok: false, output: null, issues: ["invalid_plan_schema"] };
  }
  if (containsForbiddenCommentaryLabelV1(output)) {
    return { ok: false, output: null, issues: ["forbidden_label"] };
  }
  if (
    output.title.length > 80 ||
    output.body.length > 600 ||
    output.bullets.length > 5 ||
    output.bullets.some((b) => b.length > 160) ||
    (output.caveat != null && output.caveat.length > 160) ||
    containsUnsafeCommentaryPayloadV1(output)
  ) {
    return { ok: false, output: null, issues: ["unsafe_string_payload"] };
  }
  return { ok: true, output, issues: [] };
}
