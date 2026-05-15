import { extractJsonObjectsFromKatagoStdout } from "./katagoRawParser";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function parseTurnNumber(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return null;
  }
  const n = Math.trunc(v);
  return n >= 0 ? n : null;
}

/** KataGo final analysis line: `isDuringSearch === false` only. */
export function isKatagoFinalAnalyzeTurnResponse(obj: Record<string, unknown>): boolean {
  if (obj.isDuringSearch === true) {
    return false;
  }
  if (obj.isDuringSearch === false) {
    return true;
  }
  return parseTurnNumber(obj.turnNumber) != null;
}

/**
 * Collect final responses keyed by turnNumber (last wins per turn).
 * Does not use `id` for matching.
 */
export function collectFinalResponsesByTurnNumber(stdout: string): Map<number, Record<string, unknown>> {
  const byTurn = new Map<number, Record<string, unknown>>();
  for (const raw of extractJsonObjectsFromKatagoStdout(stdout)) {
    if (!isPlainObject(raw)) {
      continue;
    }
    if (!isKatagoFinalAnalyzeTurnResponse(raw)) {
      continue;
    }
    const tn = parseTurnNumber(raw.turnNumber);
    if (tn == null) {
      continue;
    }
    const root = raw.rootInfo;
    if (!isPlainObject(root)) {
      continue;
    }
    byTurn.set(tn, raw);
  }
  return byTurn;
}

export function hasAllExpectedTurnNumbers(
  byTurn: Map<number, Record<string, unknown>>,
  expected: readonly number[]
): boolean {
  for (const tn of expected) {
    if (!byTurn.has(tn)) {
      return false;
    }
  }
  return true;
}
