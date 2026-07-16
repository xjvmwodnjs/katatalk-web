import { describe, expect, it } from "vitest";
import { analysisDataRetentionUntil, readAnalysisDataRetentionDays } from "./analysisDataRetention";

describe("analysis data retention", () => {
  it("is disabled unless a retention period is explicitly configured", () => {
    expect(readAnalysisDataRetentionDays({})).toBeNull();
    expect(analysisDataRetentionUntil(null, new Date("2026-07-16T00:00:00.000Z"))).toBeNull();
  });

  it("accepts a bounded integer retention period and computes a UTC expiration", () => {
    expect(readAnalysisDataRetentionDays({ ANALYSIS_DATA_RETENTION_DAYS: "90" })).toBe(90);
    expect(analysisDataRetentionUntil(90, new Date("2026-07-16T00:00:00.000Z"))).toBe(
      "2026-10-14T00:00:00.000Z"
    );
  });

  it("rejects malformed, zero, and excessive retention periods", () => {
    expect(() => readAnalysisDataRetentionDays({ ANALYSIS_DATA_RETENTION_DAYS: "0" })).toThrow(/integer/);
    expect(() => readAnalysisDataRetentionDays({ ANALYSIS_DATA_RETENTION_DAYS: "90days" })).toThrow(/integer/);
    expect(() => readAnalysisDataRetentionDays({ ANALYSIS_DATA_RETENTION_DAYS: "3651" })).toThrow(/integer/);
  });
});
