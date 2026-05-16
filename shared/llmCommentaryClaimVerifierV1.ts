import type { ExplanationPlanV1 } from "./explanationPlannerV1";
import {
  containsForbiddenCommentaryLabelV1,
  containsUnsafeCommentaryPayloadV1,
  sanitizeGtpMoveV1,
} from "./llmCommentaryGuardV1";

export const LLM_COMMENTARY_CLAIM_VERIFIER_V1_VERSION = "llm-commentary-claim-verifier-v1" as const;

export type LlmCommentaryClaimIssueV1 =
  | "invalid_board_size"
  | "unsafe_reference_line"
  | "unknown_coordinate_claim"
  | "unknown_score_claim"
  | "unknown_winrate_claim"
  | "timeline_loss_claim"
  | "context_signal_loss_claim"
  | "forbidden_label"
  | "unsafe_payload";

export type LlmCommentaryClaimVerifierResultV1 =
  | { ok: true; issues: [] }
  | { ok: false; issues: LlmCommentaryClaimIssueV1[] };

const SUPPORTED_BOARD_SIZES = new Set([9, 13, 19]);
const CLAIM_COORDINATE_RE = /(?<![A-Z])[A-HJ-T](?:[1-9]|1[0-9])(?![A-Z0-9])/gi;
const I_COLUMN_COORDINATE_RE = /(?<![A-Z])I(?:[1-9]|1[0-9])(?![A-Z0-9])/gi;
const SCORE_CLAIM_RE = /(\d+(?:\.\d+)?)\s*(?:집|points?)/gi;
const PERCENT_CLAIM_RE = /(\d+(?:\.\d+)?)\s*(?:%|퍼센트|percent)/gi;
const TIMELINE_LOSS_RE = /(?:timeline|타임라인|승률\s*변동|변동)[\s\S]{0,24}(?:손실|잃|하락|떨어|감소)|(?:손실|잃|하락|떨어|감소)[\s\S]{0,24}(?:timeline|타임라인|승률\s*변동|변동)/i;
const WINRATE_LOSS_WORDING_RE = /승률[\s\S]{0,24}(?:손실|잃|하락|떨어|감소)|(?:손실|잃|하락|떨어|감소)[\s\S]{0,24}승률/i;
const CONTEXT_SIGNAL_LOSS_RE = /(?:ADI|deep\s*search|DeepSearch|추가\s*탐색|learning\s*event|학습\s*후보)[\s\S]{0,24}(?:손실|잃|하락|떨어|감소)|(?:손실|잃|하락|떨어|감소)[\s\S]{0,24}(?:ADI|deep\s*search|DeepSearch|추가\s*탐색|learning\s*event|학습\s*후보)/i;

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values));
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

function outputText(output: unknown): string {
  return collectStrings(output).join("\n");
}

function boardSizeToMaxColumn(boardSize: number): string {
  const columns = "ABCDEFGHJKLMNOPQRST";
  return columns[boardSize - 1] ?? "";
}

export function isSupportedCommentaryBoardSizeV1(boardSize: unknown): boardSize is 9 | 13 | 19 {
  return typeof boardSize === "number" && Number.isInteger(boardSize) && SUPPORTED_BOARD_SIZES.has(boardSize);
}

export function isGtpMoveOnBoardV1(move: string, boardSize: number): boolean {
  if (!isSupportedCommentaryBoardSizeV1(boardSize)) {
    return false;
  }
  const normalized = sanitizeGtpMoveV1(move);
  if (normalized == null || normalized === "pass") {
    return normalized === "pass";
  }
  const column = normalized[0];
  const row = Number(normalized.slice(1));
  const maxColumn = boardSizeToMaxColumn(boardSize);
  return column <= maxColumn && row >= 1 && row <= boardSize;
}

export function sanitizeGtpMoveForBoardSizeV1(move: string | null, boardSize: number): string | null {
  const normalized = sanitizeGtpMoveV1(move);
  if (normalized == null || normalized === "pass") {
    return normalized;
  }
  return isGtpMoveOnBoardV1(normalized, boardSize) ? normalized : null;
}

export function sanitizeReferenceLineForBoardSizeV1(
  referenceLine: ExplanationPlanV1["referenceLine"],
  boardSize: number
): ExplanationPlanV1["referenceLine"] {
  return {
    playedMove: sanitizeGtpMoveForBoardSizeV1(referenceLine.playedMove, boardSize),
    recommendedMove: sanitizeGtpMoveForBoardSizeV1(referenceLine.recommendedMove, boardSize),
    pv: referenceLine.pv.map((move) => sanitizeGtpMoveForBoardSizeV1(move, boardSize)).filter((move): move is string => move != null),
  };
}

function isClose(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.000001;
}

function allowedCoordinates(plan: ExplanationPlanV1, boardSize: number): Set<string> {
  const sanitized = sanitizeReferenceLineForBoardSizeV1(plan.referenceLine, boardSize);
  return new Set([sanitized.playedMove, sanitized.recommendedMove, ...sanitized.pv].filter((move): move is string => move != null));
}

function allowedScoreValues(plan: ExplanationPlanV1): number[] {
  return plan.evidenceBullets
    .filter((b) => b.type === "score_loss" && b.unit === "points" && typeof b.value === "number" && Number.isFinite(b.value))
    .map((b) => b.value as number);
}

function allowedWinrateValues(plan: ExplanationPlanV1): number[] {
  return plan.evidenceBullets.flatMap((b) => {
    if ((b.type !== "winrate_loss" && b.type !== "timeline_context") || typeof b.value !== "number" || !Number.isFinite(b.value)) {
      return [];
    }
    if (b.unit === "ratio") {
      return [b.value, b.value * 100];
    }
    if (b.unit === "percent") {
      return [b.value, b.value / 100];
    }
    return [];
  });
}

function extractCoordinates(text: string): string[] {
  return (text.match(CLAIM_COORDINATE_RE) ?? []).map((move) => move.toUpperCase());
}

function extractNumbers(text: string, re: RegExp): number[] {
  const values: number[] = [];
  let match: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((match = re.exec(text)) != null) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) {
      values.push(value);
    }
  }
  return values;
}

function hasContextSignalOnly(plan: ExplanationPlanV1): boolean {
  return (
    plan.evidenceBullets.some((b) => b.type === "adi" || b.type === "deep_search" || b.type === "learning_event") &&
    !plan.evidenceBullets.some((b) => b.type === "score_loss" || b.type === "winrate_loss")
  );
}

export function verifyLlmCommentaryClaimsV1(args: {
  plan: ExplanationPlanV1;
  boardSize: number;
  output: unknown;
}): LlmCommentaryClaimVerifierResultV1 {
  const issues: LlmCommentaryClaimIssueV1[] = [];
  const { plan, boardSize, output } = args;
  const text = outputText(output);

  if (!isSupportedCommentaryBoardSizeV1(boardSize)) {
    issues.push("invalid_board_size");
  }
  if (containsForbiddenCommentaryLabelV1(output)) {
    issues.push("forbidden_label");
  }
  if (containsUnsafeCommentaryPayloadV1(output)) {
    issues.push("unsafe_payload");
  }

  if (isSupportedCommentaryBoardSizeV1(boardSize)) {
    const sanitizedReference = sanitizeReferenceLineForBoardSizeV1(plan.referenceLine, boardSize);
    if (plan.referenceLine.playedMove != null && sanitizedReference.playedMove == null) {
      issues.push("unsafe_reference_line");
    }
    const allowed = allowedCoordinates(plan, boardSize);
    if (
      I_COLUMN_COORDINATE_RE.test(text) ||
      extractCoordinates(text).some((coord) => !isGtpMoveOnBoardV1(coord, boardSize) || !allowed.has(coord))
    ) {
      issues.push("unknown_coordinate_claim");
    }
  }

  const allowedScores = allowedScoreValues(plan);
  if (extractNumbers(text, SCORE_CLAIM_RE).some((value) => !allowedScores.some((allowed) => isClose(value, allowed)))) {
    issues.push("unknown_score_claim");
  }

  const allowedWinrates = allowedWinrateValues(plan);
  if (extractNumbers(text, PERCENT_CLAIM_RE).some((value) => !allowedWinrates.some((allowed) => isClose(value, allowed)))) {
    issues.push("unknown_winrate_claim");
  }

  if (
    plan.evidenceBullets.some((b) => b.type === "timeline_context") &&
    (TIMELINE_LOSS_RE.test(text) || (!plan.evidenceBullets.some((b) => b.type === "winrate_loss") && WINRATE_LOSS_WORDING_RE.test(text)))
  ) {
    issues.push("timeline_loss_claim");
  }
  if (hasContextSignalOnly(plan) && CONTEXT_SIGNAL_LOSS_RE.test(text)) {
    issues.push("context_signal_loss_claim");
  }

  return issues.length > 0 ? { ok: false, issues: uniq(issues) } : { ok: true, issues: [] };
}
