const JOB_ID_PARAM_KEYS = ["jobId", "analysisJobId"] as const;

export function readAnalysisJobIdFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  for (const key of JOB_ID_PARAM_KEYS) {
    const raw = params.get(key);
    const value = raw?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}
