/**
 * Analysis Result Page UI v1 — raw JSON helpers (LLM·top_mistakes 생성 없음).
 * 문구 매핑·금지어 검사는 `analysisResultI18n` 에서 제공.
 */

export { mapReasonPhraseForUi, uiTextContainsForbiddenLabel } from "./analysisResultI18n";
export type { AnalysisResultLang } from "./analysisResultI18n";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** `analysisPlan` 기준 final_position 턴은 카드에서 제외(이중 방어) */
export function isFinalPositionTurnFromRaw(raw: unknown, turnIndex: number): boolean {
  if (!isPlainObject(raw)) {
    return false;
  }
  const ap = raw.analysisPlan;
  if (!isPlainObject(ap)) {
    return false;
  }
  const turns = ap.candidateTurns;
  if (!Array.isArray(turns)) {
    return false;
  }
  for (const row of turns) {
    if (!isPlainObject(row)) {
      continue;
    }
    if (row.turnIndex === turnIndex && row.reason === "final_position") {
      return true;
    }
  }
  return false;
}
