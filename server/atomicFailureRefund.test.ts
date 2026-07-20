import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertAtomicFailureRefundRpcReady,
  failAnalysisJobAndRefundWithLease,
} from "./creditService";
import { finalizeAnalysisJobFailure } from "./worker/finalizeAnalysisJobFailure";
import { vitestAnalysisJobsStore, vitestAnalysisRefundedJobsStore, vitestAtomicFailureRpcCalls, vitestSeedAnalysisJob } from "./vitestSetup";

const lease = { lockedBy: "worker-atomic", attemptCount: 2 } as const;

function seedRunning(jobId: string, overrides: Record<string, unknown> = {}): void {
  vitestSeedAnalysisJob({
    id: jobId,
    user_id: "user_a",
    status: "running",
    file_name: "game.sgf",
    language: "ko",
    credit_cost: 1,
    credit_log_id: "00000000-0000-0000-0000-00000000aa01",
    is_mock: false,
    progress: 50,
    result: null,
    error_message: null,
    completed_at: null,
    locked_at: "2026-07-20T00:00:00.000Z",
    locked_by: lease.lockedBy,
    attempt_count: lease.attemptCount,
    max_attempts: 3,
    next_retry_at: null,
    last_error_code: null,
    ...overrides,
  });
}

async function fail(jobId: string, overrideLease = lease) {
  return failAnalysisJobAndRefundWithLease({
    jobId,
    lease: overrideLease,
    errorCode: "KATAGO_EXIT_NONZERO",
    errorMessage: "KATAGO_EXIT_NONZERO: exit 1",
  });
}

describe("failAnalysisJobAndRefundWithLease", () => {
  beforeEach(() => {
    vitestAnalysisJobsStore.clear();
    vitestAnalysisRefundedJobsStore.clear();
    vitestAtomicFailureRpcCalls.clear();
  });

  it("verifies the Worker startup RPC contract without mutating a job", async () => {
    await expect(assertAtomicFailureRefundRpcReady()).resolves.toBeUndefined();
    expect(vitestAnalysisJobsStore.size).toBe(0);
    expect(vitestAnalysisRefundedJobsStore.size).toBe(0);
  });

  it("atomically marks a paid job failed and records one refund", async () => {
    seedRunning("atomic-failure-ok");

    await expect(fail("atomic-failure-ok")).resolves.toEqual({
      ok: true,
      code: "FAILED_AND_REFUNDED",
      duplicate: false,
      refunded: true,
    });

    expect(vitestAnalysisRefundedJobsStore.has("atomic-failure-ok")).toBe(true);
    expect(vitestAnalysisJobsStore.get("atomic-failure-ok")).toEqual(
      expect.objectContaining({
        status: "failed",
        progress: null,
        result: null,
        error_message: "Analysis failed. Please try again.",
        last_error_code: "KATAGO_EXIT_NONZERO",
        locked_at: null,
        locked_by: null,
        failure_worker_id: lease.lockedBy,
        failure_attempt_count: lease.attemptCount,
      })
    );
  });

  it("is idempotent for the exact finalizing lease", async () => {
    seedRunning("atomic-failure-duplicate");

    await fail("atomic-failure-duplicate");
    await expect(fail("atomic-failure-duplicate")).resolves.toEqual({
      ok: true,
      code: "ALREADY_FAILED",
      duplicate: true,
      refunded: true,
    });
    expect(vitestAnalysisRefundedJobsStore.size).toBe(1);
  });

  it("retries safely when the first success response is lost", async () => {
    seedRunning("atomic-failure-response-lost");

    await expect(fail("atomic-failure-response-lost")).resolves.toEqual({
      ok: true,
      code: "ALREADY_FAILED",
      duplicate: true,
      refunded: true,
    });
    expect(vitestAtomicFailureRpcCalls.get("atomic-failure-response-lost")).toBe(2);
    expect(vitestAnalysisRefundedJobsStore.size).toBe(1);
  });

  it("returns failed from the finalizer after a committed response is lost without legacy fallback", async () => {
    seedRunning("atomic-failure-response-lost");
    const legacyRefund = vi.fn(async () => undefined);

    await expect(
      finalizeAnalysisJobFailure({
        jobId: "atomic-failure-response-lost",
        rawError: "KATAGO_EXIT_NONZERO: exit 1",
        lease,
        onLegacyJobFailed: legacyRefund,
        logPrefix: "atomicFailureRefund.test",
      })
    ).resolves.toBe("failed");

    expect(vitestAtomicFailureRpcCalls.get("atomic-failure-response-lost")).toBe(2);
    expect(vitestAnalysisRefundedJobsStore.size).toBe(1);
    expect(legacyRefund).not.toHaveBeenCalled();
  });

  it("rejects another lease after a committed response loss without a second refund", async () => {
    seedRunning("atomic-failure-response-lost");

    await expect(fail("atomic-failure-response-lost")).resolves.toEqual({
      ok: true,
      code: "ALREADY_FAILED",
      duplicate: true,
      refunded: true,
    });

    await expect(
      fail("atomic-failure-response-lost", { lockedBy: "replacement-worker", attemptCount: 3 })
    ).resolves.toEqual({ ok: false, code: "ALREADY_FAILED" });
    expect(vitestAnalysisRefundedJobsStore.size).toBe(1);
    expect(vitestAnalysisJobsStore.get("atomic-failure-response-lost")).toEqual(
      expect.objectContaining({
        failure_worker_id: lease.lockedBy,
        failure_attempt_count: lease.attemptCount,
      })
    );
  });

  it("rejects a stale lease without changing job or refund state", async () => {
    seedRunning("atomic-failure-stale");

    await expect(fail("atomic-failure-stale", { lockedBy: "old-worker", attemptCount: 1 })).resolves.toEqual({
      ok: false,
      code: "LEASE_LOST",
    });
    expect(vitestAnalysisJobsStore.get("atomic-failure-stale")).toEqual(expect.objectContaining({ status: "running", locked_by: lease.lockedBy }));
    expect(vitestAnalysisRefundedJobsStore.size).toBe(0);
  });

  it("leaves a completed job and its ledger unchanged", async () => {
    seedRunning("atomic-failure-completed", {
      status: "completed",
      progress: 100,
      completed_at: "2026-07-20T00:01:00.000Z",
      locked_at: null,
      locked_by: null,
    });

    await expect(fail("atomic-failure-completed")).resolves.toEqual({
      ok: false,
      code: "ALREADY_COMPLETED",
    });
    expect(vitestAnalysisJobsStore.get("atomic-failure-completed")).toEqual(expect.objectContaining({ status: "completed", progress: 100 }));
    expect(vitestAnalysisRefundedJobsStore.size).toBe(0);
  });

  it("fails closed on a broken paid-job ledger", async () => {
    seedRunning("atomic-failure-ledger-broken", { credit_log_id: null });

    await expect(fail("atomic-failure-ledger-broken")).resolves.toEqual({
      ok: false,
      code: "LEDGER_INVARIANT",
    });
    expect(vitestAnalysisJobsStore.get("atomic-failure-ledger-broken")).toEqual(expect.objectContaining({ status: "running" }));
    expect(vitestAnalysisRefundedJobsStore.size).toBe(0);
  });

  it("finalizes a zero-credit job without creating a refund", async () => {
    seedRunning("atomic-failure-free", { credit_cost: 0, credit_log_id: null });

    await expect(fail("atomic-failure-free")).resolves.toEqual({
      ok: true,
      code: "FAILED_NO_CHARGE",
      duplicate: false,
      refunded: false,
    });
    expect(vitestAnalysisJobsStore.get("atomic-failure-free")).toEqual(expect.objectContaining({ status: "failed" }));
    expect(vitestAnalysisRefundedJobsStore.size).toBe(0);
  });

  it("does not fall back after three RPC transport failures", async () => {
    seedRunning("atomic-failure-rpc-error");

    await expect(fail("atomic-failure-rpc-error")).rejects.toThrow("failed after 3 attempt(s)");
    expect(vitestAtomicFailureRpcCalls.get("atomic-failure-rpc-error")).toBe(3);
    expect(vitestAnalysisJobsStore.get("atomic-failure-rpc-error")).toEqual(expect.objectContaining({ status: "running" }));
    expect(vitestAnalysisRefundedJobsStore.size).toBe(0);
  });

  it("keeps the job running when atomic finalization is unconfirmed", async () => {
    seedRunning("atomic-failure-rpc-error");
    const legacyRefund = vi.fn(async () => undefined);

    await expect(
      finalizeAnalysisJobFailure({
        jobId: "atomic-failure-rpc-error",
        rawError: "KATAGO_EXIT_NONZERO: exit 1",
        lease,
        onLegacyJobFailed: legacyRefund,
        logPrefix: "atomicFailureRefund.test",
      })
    ).resolves.toBe("lease_lost");

    expect(legacyRefund).not.toHaveBeenCalled();
    expect(vitestAnalysisJobsStore.get("atomic-failure-rpc-error")).toEqual(expect.objectContaining({ status: "running" }));
    expect(vitestAnalysisRefundedJobsStore.size).toBe(0);
  });
});
