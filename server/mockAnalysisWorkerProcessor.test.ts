import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisJobDbRow } from "./creditService";
import { processClaimedAnalysisJob } from "./worker/processClaimedAnalysisJob";
import { vitestAnalysisJobsStore, vitestSeedAnalysisJob } from "./vitestSetup";

describe("processClaimedAnalysisJob (mock engine)", () => {
  beforeEach(() => {
    vitestAnalysisJobsStore.clear();
    vi.useFakeTimers();
    process.env.ANALYSIS_ENGINE = "mock";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ANALYSIS_ENGINE;
  });

  it("writes completed result to analysis_jobs", async () => {
    vitestSeedAnalysisJob({
      id: "w-job-1",
      user_id: "user_a",
      status: "running",
      file_name: "game.sgf",
      language: "en",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa01",
      is_mock: true,
      progress: 1,
      result: null,
      error_message: null,
      completed_at: null,
      locked_at: "2026-07-20T00:00:00.000Z",
      locked_by: "worker-mock-test",
      attempt_count: 1,
      max_attempts: 3,
    });

    const jobRow: AnalysisJobDbRow = {
      id: "w-job-1",
      user_id: "user_a",
      status: "running",
      file_name: "game.sgf",
      language: "en",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa01",
      is_mock: true,
      progress: 1,
      result: null,
      error_message: null,
      created_at: "",
      updated_at: "",
      completed_at: null,
      sgf_content: "(;FF[4]GM[1]SZ[19])",
      sgf_sha256: "abc",
      sgf_size_bytes: 20,
      locked_at: "2026-07-20T00:00:00.000Z",
      locked_by: "worker-mock-test",
      attempt_count: 1,
      max_attempts: 3,
    };

    const p = processClaimedAnalysisJob(jobRow);
    await vi.runAllTimersAsync();
    await p;

    const stored = vitestAnalysisJobsStore.get("w-job-1") as {
      status: string;
      progress: number;
      result?: unknown;
      is_mock?: boolean;
    };
    expect(stored.status).toBe("completed");
    expect(stored.progress).toBe(100);
    expect(stored.result).toBeDefined();
    expect(stored.is_mock).toBe(true);
  });
});
