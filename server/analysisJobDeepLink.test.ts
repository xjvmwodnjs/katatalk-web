import { describe, expect, it } from "vitest";
import {
  ACTIVE_ANALYSIS_JOB_ID_STORAGE_KEY,
  buildAnalysisJobSearch,
  buildSearchWithoutAnalysisJob,
  clearStoredAnalysisJobId,
  readAnalysisJobIdFromSearch,
  readStoredAnalysisJobId,
  searchHasBillingStatus,
  writeStoredAnalysisJobId,
} from "../client/src/lib/analysisJobDeepLink";

class MemoryStorage {
  private readonly rows = new Map<string, string>();

  getItem(key: string): string | null {
    return this.rows.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.rows.set(key, value);
  }

  removeItem(key: string): void {
    this.rows.delete(key);
  }
}

describe("analysis job deep link helper", () => {
  it("reads supported job id query params", () => {
    expect(readAnalysisJobIdFromSearch("?jobId=job-1")).toBe("job-1");
    expect(readAnalysisJobIdFromSearch("?analysisJobId=job-2")).toBe("job-2");
    expect(readAnalysisJobIdFromSearch("?jobId=%20job-3%20")).toBe("job-3");
  });

  it("returns null when no job id is present", () => {
    expect(readAnalysisJobIdFromSearch("")).toBe(null);
    expect(readAnalysisJobIdFromSearch("?billing=success")).toBe(null);
  });

  it("rejects unsafe job id values", () => {
    expect(readAnalysisJobIdFromSearch("?jobId=../secret")).toBe(null);
    expect(readAnalysisJobIdFromSearch("?jobId=job%201")).toBe(null);
  });

  it("builds a canonical job deep link search", () => {
    expect(buildAnalysisJobSearch("?billing=success&foo=1", " job-1 ")).toBe("?foo=1&jobId=job-1");
    expect(buildAnalysisJobSearch("?analysisJobId=old&foo=1", "job_2")).toBe("?foo=1&jobId=job_2");
  });

  it("removes job id params without touching unrelated params", () => {
    expect(buildSearchWithoutAnalysisJob("?jobId=job-1&billing=success&foo=1")).toBe("?billing=success&foo=1");
    expect(buildSearchWithoutAnalysisJob("?analysisJobId=job-1")).toBe("");
  });

  it("detects billing callback searches", () => {
    expect(searchHasBillingStatus("?billing=success")).toBe(true);
    expect(searchHasBillingStatus("?jobId=job-1")).toBe(false);
  });

  it("persists and clears the active job id defensively", () => {
    const storage = new MemoryStorage();
    writeStoredAnalysisJobId(storage, " job-1 ");
    expect(storage.getItem(ACTIVE_ANALYSIS_JOB_ID_STORAGE_KEY)).toBe("job-1");
    expect(readStoredAnalysisJobId(storage)).toBe("job-1");

    writeStoredAnalysisJobId(storage, "../secret");
    expect(readStoredAnalysisJobId(storage)).toBe("job-1");

    clearStoredAnalysisJobId(storage);
    expect(readStoredAnalysisJobId(storage)).toBe(null);
  });
});
