export function readAnalysisDataRetentionDays(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.ANALYSIS_DATA_RETENTION_DAYS?.trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) {
    throw new Error("ANALYSIS_DATA_RETENTION_DAYS must be an integer from 1 to 3650.");
  }
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error("ANALYSIS_DATA_RETENTION_DAYS must be an integer from 1 to 3650.");
  }
  return days;
}

export function analysisDataRetentionUntil(days: number | null, now = new Date()): string | null {
  if (days == null) return null;
  const until = new Date(now.getTime());
  until.setUTCDate(until.getUTCDate() + days);
  return until.toISOString();
}
