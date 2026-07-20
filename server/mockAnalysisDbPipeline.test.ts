import { beforeEach, describe, expect, it, vi } from "vitest";
import * as creditService from "./creditService";
import { runMockAnalysisDbPipeline } from "./mockAnalysisDbPipeline";
import {
  vitestAnalysisJobsStore,
  vitestAnalysisRefundedJobsStore,
  vitestSeedAnalysisJob,
} from "./vitestSetup";

describe("runMockAnalysisDbPipeline leased failure", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vitestAnalysisJobsStore.clear();
    vitestAnalysisRefundedJobsStore.clear();
  });

  it("atomically fails and refunds a leased paid mock job without the legacy callback", async () => {
    const lease = { lockedBy: "mock-worker", attemptCount: 2 };
    vitestSeedAnalysisJob({
      id: "mock-leased-failure",
      user_id: "user_a",
      status: "running",
      file_name: "game.sgf",
      language: "ko",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa01",
      is_mock: true,
      progress: 1,
      result: null,
      error_message: null,
      completed_at: null,
      locked_at: "2026-07-20T00:00:00.000Z",
      locked_by: lease.lockedBy,
      attempt_count: lease.attemptCount,
      max_attempts: 3,
      next_retry_at: null,
    });
    const legacyRefund = vi.fn(async () => undefined);
    vi.spyOn(creditService, "updateAnalysisJobRowWithLease").mockRejectedValueOnce(
      new Error("mock progress persistence failed")
    );
    const legacyRpc = vi.spyOn(creditService, "refundCreditIfJobFailed");

    await expect(
      runMockAnalysisDbPipeline({
        jobId: "mock-leased-failure",
        fileName: "game.sgf",
        language: "ko",
        lease,
        onJobFailed: legacyRefund,
      })
    ).resolves.toBe("failed");

    expect(vitestAnalysisJobsStore.get("mock-leased-failure")).toEqual(
      expect.objectContaining({
        status: "failed",
        failure_worker_id: lease.lockedBy,
        failure_attempt_count: lease.attemptCount,
      })
    );
    expect(vitestAnalysisRefundedJobsStore.has("mock-leased-failure")).toBe(true);
    expect(legacyRefund).not.toHaveBeenCalled();
    expect(legacyRpc).not.toHaveBeenCalled();
  });
});
