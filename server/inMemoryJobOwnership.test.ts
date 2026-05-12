import { describe, expect, it, beforeEach } from "vitest";
import { vitestAnalysisJobsStore, vitestSeedAnalysisJob } from "./vitestSetup";

describe("analysis_jobs ownership (DB)", () => {
  beforeEach(() => {
    vitestAnalysisJobsStore.clear();
  });

  it("stores clerk profile id on analysis_jobs.user_id", () => {
    vitestSeedAnalysisJob({
      id: "jid-owner",
      user_id: "user_sub_abc",
      status: "queued",
      file_name: "x.sgf",
      language: "ko",
      credit_cost: 1,
      credit_log_id: null,
      is_mock: true,
      progress: 0,
    });
    expect(vitestAnalysisJobsStore.get("jid-owner")?.user_id).toBe("user_sub_abc");
  });
});
