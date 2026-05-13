import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processMockAnalysisJob } from "./worker/mockAnalysisProcessor";
import { vitestAnalysisJobsStore, vitestSeedAnalysisJob } from "./vitestSetup";

describe("processMockAnalysisJob (worker path)", () => {
  beforeEach(() => {
    vitestAnalysisJobsStore.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    });

    const p = processMockAnalysisJob({
      id: "w-job-1",
      user_id: "user_a",
      file_name: "game.sgf",
      language: "en",
      credit_cost: 1,
    });
    await vi.runAllTimersAsync();
    await p;

    const row = vitestAnalysisJobsStore.get("w-job-1") as { status: string; progress: number; result?: unknown };
    expect(row.status).toBe("completed");
    expect(row.progress).toBe(100);
    expect(row.result).toBeDefined();
  });
});
