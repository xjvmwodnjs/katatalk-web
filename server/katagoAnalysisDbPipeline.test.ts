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

  describe("heartbeat error handling", () => {
    const base = {
      user_id: "user_a",
      status: "running" as const,
      file_name: "g.sgf",
      language: "ko",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa01",
      is_mock: false,
      progress: 15,
      result: null,
      error_message: null,
      created_at: "2025-01-01T00:00:00.000Z",
      updated_at: "2025-01-01T00:00:00.000Z",
      completed_at: null,
      locked_at: "2025-09-01T10:00:00.000Z",
      locked_by: "worker-h",
      attempt_count: 1,
      max_attempts: 3,
      sgf_content: "(;FF[4]GM[1]SZ[19])",
      sgf_sha256: "x",
      sgf_size_bytes: 12,
    };

    beforeEach(() => {
      vi.restoreAllMocks();
      vitestAnalysisJobsStore.clear();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("post-run heartbeat throw skips failed update and onJobFailed", async () => {
      vitestSeedAnalysisJob({ ...base, id: "post-throw" });
      const ul = vi.spyOn(creditService, "updateAnalysisJobRowWithLease");
      vi.spyOn(creditService, "heartbeatAnalysisJobLease").mockRejectedValue(new Error("db transport"));
      vi.spyOn(analysisEngines, "analyzeSgfKatago").mockResolvedValue({
        ok: true,
        source: "katago-worker-v1",
        isMock: false,
      });
      const onJobFailed = vi.fn();
      const row = vitestAnalysisJobsStore.get("post-throw") as AnalysisJobDbRow;
      await runKatagoAnalysisDbPipeline({
        jobId: "post-throw",
        row,
        fileName: "g.sgf",
        language: "ko",
        lease: { lockedBy: "worker-h", attemptCount: 1 },
        onJobFailed,
      });
      const failedCalls = ul.mock.calls.filter(c => (c[2] as { status?: string }).status === "failed");
      expect(failedCalls.length).toBe(0);
      expect(onJobFailed).not.toHaveBeenCalled();
      expect((vitestAnalysisJobsStore.get("post-throw") as { status: string }).status).toBe("running");
    });

    it("post-run heartbeat LEASE_LOST skips completed", async () => {
      vitestSeedAnalysisJob({ ...base, id: "post-lease" });
      vi.spyOn(creditService, "heartbeatAnalysisJobLease").mockResolvedValue({ ok: false, reason: "LEASE_LOST" });
      vi.spyOn(analysisEngines, "analyzeSgfKatago").mockResolvedValue({
        ok: true,
        source: "katago-worker-v1",
        isMock: false,
      });
      const ul = vi.spyOn(creditService, "updateAnalysisJobRowWithLease");
      const row = vitestAnalysisJobsStore.get("post-lease") as AnalysisJobDbRow;
      await runKatagoAnalysisDbPipeline({
        jobId: "post-lease",
        row,
        fileName: "g.sgf",
        language: "ko",
        lease: { lockedBy: "worker-h", attemptCount: 1 },
      });
      const completedCalls = ul.mock.calls.filter(c => (c[2] as { status?: string }).status === "completed");
      expect(completedCalls.length).toBe(0);
      expect((vitestAnalysisJobsStore.get("post-lease") as { status: string }).status).toBe("running");
    });

    it("interval heartbeat DB error skips completed without unhandledRejection", async () => {
      const origHb = process.env.ANALYSIS_WORKER_HEARTBEAT_SECONDS;
      vi.useFakeTimers();
      const captured: unknown[] = [];
      const handler = (reason: unknown) => captured.push(reason);
      process.on("unhandledRejection", handler);
      try {
        process.env.ANALYSIS_WORKER_HEARTBEAT_SECONDS = "5";
        vitestSeedAnalysisJob({ ...base, id: "iv-err" });
        vi.spyOn(creditService, "heartbeatAnalysisJobLease").mockRejectedValue(new Error("interval db"));
        vi.spyOn(analysisEngines, "analyzeSgfKatago").mockImplementation(
          () =>
            new Promise(resolve =>
              setTimeout(() => resolve({ ok: true, source: "katago-worker-v1", isMock: false }), 20_000)
            )
        );
        const row = vitestAnalysisJobsStore.get("iv-err") as AnalysisJobDbRow;
        const p = runKatagoAnalysisDbPipeline({
          jobId: "iv-err",
          row,
          fileName: "g.sgf",
          language: "ko",
          lease: { lockedBy: "worker-h", attemptCount: 1 },
        });
        await vi.advanceTimersByTimeAsync(25_000);
        await p;
        expect(captured.length).toBe(0);
        expect((vitestAnalysisJobsStore.get("iv-err") as { status: string }).status).toBe("running");
      } finally {
        process.off("unhandledRejection", handler);
        vi.useRealTimers();
        if (origHb === undefined) {
          delete process.env.ANALYSIS_WORKER_HEARTBEAT_SECONDS;
        } else {
          process.env.ANALYSIS_WORKER_HEARTBEAT_SECONDS = origHb;
        }
      }
    });

    it("with lease and successful heartbeat completes job", async () => {
      vitestSeedAnalysisJob({ ...base, id: "ok-heart" });
      vi.spyOn(analysisEngines, "analyzeSgfKatago").mockResolvedValue({
        ok: true,
        source: "katago-worker-v1",
        isMock: false,
      });
      const row = vitestAnalysisJobsStore.get("ok-heart") as AnalysisJobDbRow;
      await runKatagoAnalysisDbPipeline({
        jobId: "ok-heart",
        row,
        fileName: "g.sgf",
        language: "ko",
        lease: { lockedBy: "worker-h", attemptCount: 1 },
      });
      expect((vitestAnalysisJobsStore.get("ok-heart") as { status: string }).status).toBe("completed");
      expect((vitestAnalysisJobsStore.get("ok-heart") as { result: unknown }).result).toBeTruthy();
    });
  });
});
