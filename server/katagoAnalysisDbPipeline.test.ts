import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as creditService from "./creditService";
import * as analysisEngines from "./worker/analysisEngines";
import type { AnalysisJobDbRow } from "./creditService";
import { runKatagoAnalysisDbPipeline } from "./worker/katagoAnalysisDbPipeline";
import { vitestAnalysisJobsStore, vitestSeedAnalysisJob } from "./vitestSetup";

describe("runKatagoAnalysisDbPipeline", () => {
  beforeEach(() => {
    vi.spyOn(creditService, "updateAnalysisJobRow").mockResolvedValue(undefined);
    vi.spyOn(analysisEngines, "analyzeSgfKatago").mockResolvedValue({
      ok: true,
      source: "katago-worker-v1",
      isMock: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks completed job is_mock=false in DB update", async () => {
    const row: AnalysisJobDbRow = {
      id: "kg-job-1",
      user_id: "user_a",
      status: "running",
      file_name: "g.sgf",
      language: "ko",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa01",
      is_mock: false,
      progress: 15,
      result: null,
      error_message: null,
      created_at: "",
      updated_at: "",
      completed_at: null,
      sgf_content: "(;FF[4]GM[1]SZ[19];B[pd])",
      sgf_sha256: "x",
      sgf_size_bytes: 10,
    };

    await runKatagoAnalysisDbPipeline({
      jobId: "kg-job-1",
      row,
      fileName: "g.sgf",
      language: "ko",
    });

    const updateSpy = vi.mocked(creditService.updateAnalysisJobRow);
    const completedCall = updateSpy.mock.calls.find(
      args => (args[1] as { status?: string }).status === "completed"
    );
    expect(completedCall).toBeDefined();
    expect(completedCall![1]).toEqual(
      expect.objectContaining({
        status: "completed",
        progress: 100,
        is_mock: false,
      })
    );
  });

  describe("lease + heartbeat during analyzeSgfKatago", () => {
    const origHb = process.env.ANALYSIS_WORKER_HEARTBEAT_SECONDS;

    beforeEach(() => {
      vi.restoreAllMocks();
      vitestAnalysisJobsStore.clear();
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-09-01T10:00:00.000Z"));
      process.env.ANALYSIS_WORKER_HEARTBEAT_SECONDS = "1";
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      if (origHb === undefined) {
        delete process.env.ANALYSIS_WORKER_HEARTBEAT_SECONDS;
      } else {
        process.env.ANALYSIS_WORKER_HEARTBEAT_SECONDS = origHb;
      }
    });

    it("skips completed write when heartbeat loses lease during long analyze", async () => {
      vitestSeedAnalysisJob({
        id: "kg-hb-loss",
        user_id: "user_a",
        status: "running",
        file_name: "g.sgf",
        language: "ko",
        credit_cost: 1,
        credit_log_id: "00000000-0000-0000-0000-00000000aa01",
        is_mock: false,
        progress: 1,
        result: null,
        error_message: null,
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z",
        completed_at: null,
        locked_at: "2025-09-01T09:00:00.000Z",
        locked_by: "worker-x",
        attempt_count: 1,
        max_attempts: 3,
        sgf_content: "(;FF[4]GM[1]SZ[19])",
        sgf_sha256: "x",
        sgf_size_bytes: 12,
      });
      const lease = { lockedBy: "worker-x", attemptCount: 1 };

      vi.spyOn(analysisEngines, "analyzeSgfKatago").mockImplementation(
        () =>
          new Promise(resolve =>
            setTimeout(() => resolve({ ok: true, source: "katago-worker-v1", isMock: false }), 3500)
          )
      );

      const row = vitestAnalysisJobsStore.get("kg-hb-loss") as AnalysisJobDbRow;
      const done = runKatagoAnalysisDbPipeline({
        jobId: "kg-hb-loss",
        row,
        fileName: "g.sgf",
        language: "ko",
        lease,
      });

      await vi.advanceTimersByTimeAsync(1500);
      const r = vitestAnalysisJobsStore.get("kg-hb-loss") as Record<string, unknown>;
      Object.assign(r, { locked_by: "worker-reclaimed", attempt_count: 2 });

      await vi.advanceTimersByTimeAsync(2500);
      await done;

      const rowAfter = vitestAnalysisJobsStore.get("kg-hb-loss") as { status: string; result: unknown };
      expect(rowAfter.status).toBe("running");
      expect(rowAfter.result).toBeNull();
    });
  });
});
