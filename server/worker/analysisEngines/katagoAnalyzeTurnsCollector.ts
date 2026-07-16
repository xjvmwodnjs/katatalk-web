import { extractJsonObjectsFromKatagoStdout } from "./katagoRawParser";
import type { WinrateTimelineProgressEventV1 } from "@shared/winrateTimelineV1";
import type { KatagoConfiguredWinratePerspectiveV1 } from "@shared/winratePerspectiveV1";

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

/** KataGo final analysis line: `isDuringSearch === false` only (field must be present). */
export function isKatagoFinalAnalyzeTurnResponse(
  obj: Record<string, unknown>
): boolean {
  return obj.isDuringSearch === false;
}

/**
 * Collect final responses keyed by turnNumber (last wins per turn).
 * Does not use `id` for matching.
 */
export function collectFinalResponsesByTurnNumber(
  stdout: string
): Map<number, Record<string, unknown>> {
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

function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseBw(v: unknown): "B" | "W" | null {
  return v === "B" || v === "W" ? v : null;
}

export function katagoAnalyzeTurnResponseToProgressEventV1(
  obj: unknown,
  jobId: string,
  receivedAt = new Date().toISOString(),
  winratePerspective: KatagoConfiguredWinratePerspectiveV1 = "unknown"
): WinrateTimelineProgressEventV1 | null {
  if (!isPlainObject(obj)) {
    return null;
  }
  const turnNumber = parseTurnNumber(obj.turnNumber);
  if (turnNumber == null || typeof obj.isDuringSearch !== "boolean") {
    return null;
  }
  const root = obj.rootInfo;
  if (!isPlainObject(root)) {
    return null;
  }
  return {
    jobId,
    turnIndex: turnNumber,
    isDuringSearch: obj.isDuringSearch,
    visits: finiteNumber(root.visits),
    winrate: finiteNumber(root.winrate),
    scoreLead: finiteNumber(root.scoreLead) ?? finiteNumber(root.scoreMean),
    currentPlayer: parseBw(root.currentPlayer),
    winratePerspective,
    receivedAt,
  };
}
