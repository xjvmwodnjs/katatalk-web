import { describe, expect, it } from "vitest";
import { readAnalysisJobIdFromSearch } from "../client/src/lib/analysisJobDeepLink";

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
});
