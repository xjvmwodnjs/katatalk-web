const JOB_ID_PARAM_KEYS = ["jobId", "analysisJobId"] as const;

export const ACTIVE_ANALYSIS_JOB_ID_STORAGE_KEY = "katatalk.activeAnalysisJobId.v1";

type AnalysisJobStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function normalizeAnalysisJobId(value: string | null | undefined): string | null {
  const t = value?.trim();
  if (!t) {
    return null;
  }
  return /^[A-Za-z0-9_-]{1,128}$/.test(t) ? t : null;
}

export function readAnalysisJobIdFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  for (const key of JOB_ID_PARAM_KEYS) {
    const value = normalizeAnalysisJobId(params.get(key));
    if (value) {
      return value;
    }
  }
  return null;
}

export function searchHasBillingStatus(search: string): boolean {
  return new URLSearchParams(search).has("billing");
}

export function buildAnalysisJobSearch(search: string, jobId: string): string {
  const safeJobId = normalizeAnalysisJobId(jobId);
  if (!safeJobId) {
    return search || "";
  }
  const params = new URLSearchParams(search);
  params.set("jobId", safeJobId);
  params.delete("analysisJobId");
  params.delete("billing");
  const next = params.toString();
  return next ? `?${next}` : "";
}

export function buildSearchWithoutAnalysisJob(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("jobId");
  params.delete("analysisJobId");
  const next = params.toString();
  return next ? `?${next}` : "";
}

export function readStoredAnalysisJobId(storage: AnalysisJobStorage | null | undefined): string | null {
  if (!storage) {
    return null;
  }
  try {
    return normalizeAnalysisJobId(storage.getItem(ACTIVE_ANALYSIS_JOB_ID_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredAnalysisJobId(
  storage: AnalysisJobStorage | null | undefined,
  jobId: string
): void {
  const safeJobId = normalizeAnalysisJobId(jobId);
  if (!storage || !safeJobId) {
    return;
  }
  try {
    storage.setItem(ACTIVE_ANALYSIS_JOB_ID_STORAGE_KEY, safeJobId);
  } catch {
    /* ignore unavailable storage */
  }
}

export function clearStoredAnalysisJobId(storage: AnalysisJobStorage | null | undefined): void {
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(ACTIVE_ANALYSIS_JOB_ID_STORAGE_KEY);
  } catch {
    /* ignore unavailable storage */
  }
}
