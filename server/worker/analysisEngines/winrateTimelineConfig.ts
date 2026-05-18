function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw == null || raw.trim() === "") {
    return defaultValue;
  }
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") {
    return true;
  }
  if (v === "0" || v === "false" || v === "no" || v === "off") {
    return false;
  }
  return defaultValue;
}

export function readWinrateTimelineEnabledFrom(env: NodeJS.ProcessEnv): boolean {
  return parseBool(env.KATAGO_WINRATE_TIMELINE_ENABLED, false);
}

/** Default 50; invalid → 50; clamped to [1, 2000]. */
export function readWinrateTimelineVisitsFrom(env: NodeJS.ProcessEnv): number {
  const raw = (env.KATAGO_WINRATE_TIMELINE_MAX_VISITS ?? env.KATAGO_WINRATE_TIMELINE_VISITS)?.trim();
  const n = raw != null && raw !== "" ? Number.parseInt(raw, 10) : NaN;
  const v = Number.isFinite(n) && n > 0 ? n : 50;
  return clampInt(v, 1, 2000);
}

export function readWinrateTimelineMaxTurnsFrom(env: NodeJS.ProcessEnv): number {
  const raw = env.KATAGO_WINRATE_TIMELINE_MAX_TURNS?.trim();
  const n = raw != null && raw !== "" ? Number.parseInt(raw, 10) : NaN;
  const v = Number.isFinite(n) && n > 0 ? n : 300;
  return clampInt(v, 1, 500);
}

export function readWinrateTimelineTimeoutMsFrom(env: NodeJS.ProcessEnv): number {
  const raw = env.KATAGO_WINRATE_TIMELINE_TIMEOUT_MS?.trim();
  const n = raw != null && raw !== "" ? Number.parseInt(raw, 10) : NaN;
  const v = Number.isFinite(n) && n > 0 ? n : 600_000;
  return clampInt(v, 30_000, 1_800_000);
}

export function readWinrateTimelineAnalysisPvLenFrom(env: NodeJS.ProcessEnv): number {
  const raw = env.KATAGO_WINRATE_TIMELINE_ANALYSIS_PV_LEN?.trim();
  const n = raw != null && raw !== "" ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? clampInt(n, 0, 16) : 1;
}

export function readWinrateTimelineIncludeFinalFrom(env: NodeJS.ProcessEnv): boolean {
  return parseBool(env.KATAGO_WINRATE_TIMELINE_INCLUDE_FINAL, true);
}

export function readWinrateTimelineReportEverySecondsFrom(env: NodeJS.ProcessEnv): number {
  const raw = env.KATAGO_WINRATE_TIMELINE_REPORT_EVERY_SECONDS?.trim();
  const n = raw != null && raw !== "" ? Number.parseFloat(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) {
    return 0.5;
  }
  return Math.min(10, Math.max(0.1, n));
}

export function readWinrateTimelineLocalProgressEnabledFrom(env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV?.trim().toLowerCase() === "production") {
    return false;
  }
  return parseBool(env.KATAGO_WINRATE_TIMELINE_LOCAL_PROGRESS, false);
}

/** Which turnNumbers to request via analyzeTurns (0..cap, optional final). */
export function buildAnalyzeTurnNumbers(totalMoves: number, maxTurns: number, includeFinal: boolean): number[] {
  const cap = Math.min(Math.max(0, totalMoves), maxTurns);
  const turns: number[] = [];
  for (let i = 0; i <= cap; i++) {
    turns.push(i);
  }
  if (includeFinal && totalMoves > cap && !turns.includes(totalMoves)) {
    turns.push(totalMoves);
  }
  return turns;
}

export function buildAnalyzeTurnsAllMoves(totalMoves: number, maxTurns: number): number[] {
  return buildAnalyzeTurnNumbers(totalMoves, maxTurns, false);
}
