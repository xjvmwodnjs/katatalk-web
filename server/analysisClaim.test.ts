import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  analysisJobProcessingLeaseFromClaimedRow,
  claimNextAnalysisJobRpc,
  failAnalysisJobAndRefundWithLease,
  heartbeatAnalysisJobLease,
  updateAnalysisJobRowWithLease,
} from "./creditService";
import {
  vitestAnalysisFinalizationFailuresStore,
  vitestAnalysisJobsStore,
  vitestAnalysisRefundedJobsStore,
  vitestAtomicFailureRpcCalls,
  vitestSeedAnalysisJob,
} from "./vitestSetup";

function seedQueued(
  id: string,
  createdAt: string,
  extra: Partial<Record<string, unknown>> = {}
) {
  vitestSeedAnalysisJob({
    id,
    user_id: "user_a",
    status: "queued",
    created_at: createdAt,
    file_name: "game.sgf",
    language: "ko",
    credit_cost: 1,
    credit_log_id: "00000000-0000-0000-0000-00000000aa01",
    is_mock: true,
    progress: 0,
    result: null,
    error_message: null,
    completed_at: null,
    ...extra,
  });
}

describe("claim_next_analysis_job (RPC)", () => {
  beforeEach(() => {
    vitestAnalysisJobsStore.clear();
    vitestAnalysisRefundedJobsStore.clear();
    vitestAnalysisFinalizationFailuresStore.clear();
    vitestAtomicFailureRpcCalls.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseJobFields = {
    user_id: "user_a",
    file_name: "game.sgf",
    language: "ko",
    credit_cost: 1,
    credit_log_id: "00000000-0000-0000-0000-00000000aa01",
    is_mock: true,
    progress: 0,
    result: null,
    error_message: null,
    completed_at: null,
  } as const;

  it("returns null when no queued jobs", async () => {
    await expect(claimNextAnalysisJobRpc()).resolves.toBeNull();
  });

  it("claims the oldest queued job by created_at", async () => {
    seedQueued("job-newer", "2025-02-02T00:00:00.000Z");
    seedQueued("job-older", "2025-02-01T00:00:00.000Z");
    const claimed = await claimNextAnalysisJobRpc();
    expect(claimed?.id).toBe("job-older");
    expect((vitestAnalysisJobsStore.get("job-older") as { status: string }).status).toBe("running");
    expect((vitestAnalysisJobsStore.get("job-newer") as { status: string }).status).toBe("queued");
    expect(claimed?.attempt_count).toBe(1);
    expect(claimed?.locked_by).toBe("unknown");
    expect(claimed?.locked_at).toBeTruthy();
  });

  it("second claim returns the next queued job", async () => {
    seedQueued("j1", "2025-01-01T00:00:00.000Z");
    seedQueued("j2", "2025-01-02T00:00:00.000Z");
    const first = await claimNextAnalysisJobRpc();
    const second = await claimNextAnalysisJobRpc();
    expect(first?.id).toBe("j1");
    expect(second?.id).toBe("j2");
  });

  it("claim returns sgf columns when present on the row", async () => {
    const sgf = "(;FF[4]GM[1]SZ[19];B[pd];W[dp])";
    seedQueued("job-sgf", "2025-01-01T00:00:00.000Z", {
      sgf_content: sgf,
      sgf_sha256: "abc123",
      sgf_size_bytes: 42,
    });
    const claimed = await claimNextAnalysisJobRpc();
    expect(claimed?.id).toBe("job-sgf");
    expect(claimed?.sgf_content).toBe(sgf);
    expect(claimed?.sgf_sha256).toBe("abc123");
    expect(claimed?.sgf_size_bytes).toBe(42);
    expect(claimed?.attempt_count).toBe(1);
  });

  it("does not claim queued when next_retry_at is in the future", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T12:00:00.000Z"));
    seedQueued("q-later", "2025-01-01T00:00:00.000Z", {
      next_retry_at: "2030-01-01T00:00:00.000Z",
    });
    seedQueued("q-now", "2025-02-01T00:00:00.000Z");
    const c = await claimNextAnalysisJobRpc({ staleSeconds: 60 });
    expect(c?.id).toBe("q-now");
  });

  it("skips non-stale running and claims queued instead", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T12:00:00.000Z"));
    vitestSeedAnalysisJob({
      ...baseJobFields,
      id: "warm-run",
      status: "running",
      locked_at: "2025-06-01T11:59:30.000Z",
      locked_by: "other-worker",
      attempt_count: 1,
      max_attempts: 3,
      created_at: "2024-01-01T00:00:00.000Z",
    });
    seedQueued("pick-q", "2025-06-01T11:00:00.000Z");
    const c = await claimNextAnalysisJobRpc({ staleSeconds: 900 });
    expect(c?.id).toBe("pick-q");
  });

  it("reclaims stale running (older created_at wins over queued)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T15:00:00.000Z"));
    vitestSeedAnalysisJob({
      ...baseJobFields,
      id: "stale-run",
      status: "running",
      locked_at: "2025-06-01T12:00:00.000Z",
      locked_by: "dead-worker",
      attempt_count: 1,
      max_attempts: 3,
      created_at: "2024-01-01T00:00:00.000Z",
    });
    seedQueued("younger-q", "2025-06-01T00:00:00.000Z");
    const c = await claimNextAnalysisJobRpc({ staleSeconds: 120 });
    expect(c?.id).toBe("stale-run");
    expect((vitestAnalysisJobsStore.get("stale-run") as { attempt_count: number }).attempt_count).toBe(2);
  });

  it("does not claim queued rows with attempt_count >= max_attempts", async () => {
    seedQueued("exhausted", "2025-01-01T00:00:00.000Z", {
      attempt_count: 3,
      max_attempts: 3,
    });
    seedQueued("still-good", "2025-02-01T00:00:00.000Z");
    const c = await claimNextAnalysisJobRpc();
    expect(c?.id).toBe("still-good");
  });

  it("atomically fails and refunds stale running at max attempts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T20:00:00.000Z"));
    vitestSeedAnalysisJob({
      ...baseJobFields,
      id: "dead-max",
      status: "running",
      locked_at: "2025-06-01T18:00:00.000Z",
      locked_by: "dead-worker",
      attempt_count: 3,
      max_attempts: 3,
      created_at: "2024-01-01T00:00:00.000Z",
    });
    const c = await claimNextAnalysisJobRpc({ staleSeconds: 60 });
    expect(c).toBeNull();
    expect(vitestAnalysisJobsStore.get("dead-max")).toEqual(
      expect.objectContaining({
        status: "failed",
        failure_worker_id: "dead-worker",
        failure_attempt_count: 3,
      })
    );
    expect(vitestAnalysisRefundedJobsStore.has("dead-max")).toBe(true);
  });

  it("keeps a max-attempt job with a broken paid ledger running and unclaimable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T20:00:00.000Z"));
    vitestSeedAnalysisJob({
      ...baseJobFields,
      id: "dead-max-broken-ledger",
      status: "running",
      credit_log_id: null,
      locked_at: "2025-06-01T18:00:00.000Z",
      locked_by: "dead-worker",
      attempt_count: 3,
      max_attempts: 3,
      created_at: "2024-01-01T00:00:00.000Z",
    });

    await expect(claimNextAnalysisJobRpc({ staleSeconds: 60 })).resolves.toBeNull();
    expect(vitestAnalysisJobsStore.get("dead-max-broken-ledger")).toEqual(
      expect.objectContaining({
        status: "running",
        locked_by: "dead-worker",
        attempt_count: 3,
      })
    );
    expect(vitestAnalysisJobsStore.get("dead-max-broken-ledger")).not.toHaveProperty("failure_worker_id");
    expect(vitestAnalysisRefundedJobsStore.has("dead-max-broken-ledger")).toBe(false);
    expect(vitestAnalysisFinalizationFailuresStore.get("dead-max-broken-ledger")).toEqual({
      leaseWorkerId: "dead-worker",
      leaseAttemptCount: 3,
      failureCode: "LEDGER_INVARIANT",
      occurrenceCount: 1,
      resolved: false,
    });
    expect(vitestAtomicFailureRpcCalls.get("dead-max-broken-ledger")).toBe(1);

    await expect(claimNextAnalysisJobRpc({ staleSeconds: 60 })).resolves.toBeNull();
    expect(vitestAtomicFailureRpcCalls.get("dead-max-broken-ledger")).toBe(1);

    const damagedRow = vitestAnalysisJobsStore.get("dead-max-broken-ledger");
    if (!damagedRow) throw new Error("expected seeded job");
    damagedRow.credit_log_id = "00000000-0000-0000-0000-00000000aa99";
    await expect(
      failAnalysisJobAndRefundWithLease({
        jobId: "dead-max-broken-ledger",
        lease: { lockedBy: "dead-worker", attemptCount: 3 },
        errorCode: "MAX_ATTEMPTS_EXCEEDED",
        errorMessage: "Analysis failed. Please try again.",
      })
    ).resolves.toEqual({
      ok: true,
      code: "FAILED_AND_REFUNDED",
      duplicate: false,
      refunded: true,
    });
    expect(vitestAnalysisFinalizationFailuresStore.get("dead-max-broken-ledger")?.resolved).toBe(true);
    expect(vitestAnalysisJobsStore.get("dead-max-broken-ledger")).toEqual(expect.objectContaining({ status: "failed" }));
    expect(vitestAnalysisRefundedJobsStore.has("dead-max-broken-ledger")).toBe(true);
  });

  it("does not claim completed jobs", async () => {
    vitestSeedAnalysisJob({
      ...baseJobFields,
      id: "done-job",
      status: "completed",
      progress: 100,
      created_at: "2024-01-01T00:00:00.000Z",
      completed_at: "2024-01-02T00:00:00.000Z",
    });
    await expect(claimNextAnalysisJobRpc()).resolves.toBeNull();
  });

  it("lease fencing rejects updates after another worker reclaims (locked_by/attempt_count)", async () => {
    vitestSeedAnalysisJob({
      ...baseJobFields,
      id: "fence-1",
      status: "running",
      locked_at: "2025-01-01T00:00:00.000Z",
      locked_by: "worker-a",
      attempt_count: 1,
      max_attempts: 3,
      created_at: "2025-01-01T00:00:00.000Z",
    });
    const row = vitestAnalysisJobsStore.get("fence-1") as Record<string, unknown>;
    Object.assign(row, { locked_by: "worker-b", attempt_count: 2 });

    let r = await updateAnalysisJobRowWithLease("fence-1", { lockedBy: "worker-a", attemptCount: 1 }, {
      status: "completed",
      progress: 100,
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected lease loss");
    expect(r.reason).toBe("LEASE_LOST");

    r = await updateAnalysisJobRowWithLease("fence-1", { lockedBy: "worker-b", attemptCount: 2 }, {
      status: "completed",
      progress: 100,
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
    });
    expect(r.ok).toBe(true);
    expect((vitestAnalysisJobsStore.get("fence-1") as { status: string }).status).toBe("completed");
  });

  it("analysisJobProcessingLeaseFromClaimedRow returns null without lease fields", () => {
    expect(
      analysisJobProcessingLeaseFromClaimedRow({
        id: "x",
        user_id: "u",
        status: "running",
        file_name: null,
        language: null,
        credit_cost: 1,
        credit_log_id: null,
        result: null,
        error_message: null,
        is_mock: true,
        created_at: "",
        updated_at: "",
        completed_at: null,
      })
    ).toBeNull();
  });
});

describe("heartbeatAnalysisJobLease", () => {
  const baseJobFields = {
    user_id: "user_a",
    file_name: "game.sgf",
    language: "ko",
    credit_cost: 1,
    credit_log_id: "00000000-0000-0000-0000-00000000aa01",
    is_mock: true,
    progress: 15,
    result: null,
    error_message: null,
    completed_at: null,
  } as const;

  beforeEach(() => {
    vitestAnalysisJobsStore.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-10T14:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes locked_at when lease matches", async () => {
    vitestSeedAnalysisJob({
      ...baseJobFields,
      id: "hb-1",
      status: "running",
      locked_at: "2020-01-01T00:00:00.000Z",
      locked_by: "worker-h1",
      attempt_count: 1,
      max_attempts: 3,
      created_at: "2025-01-01T00:00:00.000Z",
    });
    const r = await heartbeatAnalysisJobLease("hb-1", { lockedBy: "worker-h1", attemptCount: 1 });
    expect(r.ok).toBe(true);
    expect((vitestAnalysisJobsStore.get("hb-1") as { locked_at: string }).locked_at).toBe("2025-08-10T14:00:00.000Z");
  });

  it("returns LEASE_LOST when locked_by changed", async () => {
    vitestSeedAnalysisJob({
      ...baseJobFields,
      id: "hb-2",
      status: "running",
      locked_at: "2025-08-10T13:00:00.000Z",
      locked_by: "worker-b",
      attempt_count: 1,
      max_attempts: 3,
      created_at: "2025-01-01T00:00:00.000Z",
    });
    const r = await heartbeatAnalysisJobLease("hb-2", { lockedBy: "worker-a", attemptCount: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected LEASE_LOST");
    expect(r.reason).toBe("LEASE_LOST");
  });

  it("returns LEASE_LOST when attempt_count changed", async () => {
    vitestSeedAnalysisJob({
      ...baseJobFields,
      id: "hb-3",
      status: "running",
      locked_at: "2025-08-10T13:00:00.000Z",
      locked_by: "worker-x",
      attempt_count: 2,
      max_attempts: 3,
      created_at: "2025-01-01T00:00:00.000Z",
    });
    const r = await heartbeatAnalysisJobLease("hb-3", { lockedBy: "worker-x", attemptCount: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected LEASE_LOST");
    expect(r.reason).toBe("LEASE_LOST");
  });

  it("returns LEASE_LOST when status is completed", async () => {
    vitestSeedAnalysisJob({
      ...baseJobFields,
      id: "hb-4",
      status: "completed",
      progress: 100,
      locked_at: null,
      locked_by: null,
      attempt_count: 1,
      max_attempts: 3,
      created_at: "2025-01-01T00:00:00.000Z",
    });
    const r = await heartbeatAnalysisJobLease("hb-4", { lockedBy: "worker-x", attemptCount: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected LEASE_LOST");
    expect(r.reason).toBe("LEASE_LOST");
  });

  it("running progress update with lease refreshes locked_at", async () => {
    vitestSeedAnalysisJob({
      ...baseJobFields,
      id: "hb-5",
      status: "running",
      locked_at: "2025-08-10T12:00:00.000Z",
      locked_by: "worker-p",
      attempt_count: 1,
      max_attempts: 3,
      created_at: "2025-01-01T00:00:00.000Z",
    });
    vi.setSystemTime(new Date("2025-08-10T15:30:00.000Z"));
    const r = await updateAnalysisJobRowWithLease(
      "hb-5",
      { lockedBy: "worker-p", attemptCount: 1 },
      { status: "running", progress: 42, locked_at: new Date().toISOString() }
    );
    expect(r.ok).toBe(true);
    expect((vitestAnalysisJobsStore.get("hb-5") as { locked_at: string }).locked_at).toBe("2025-08-10T15:30:00.000Z");
    expect((vitestAnalysisJobsStore.get("hb-5") as { progress: number }).progress).toBe(42);
  });
});
