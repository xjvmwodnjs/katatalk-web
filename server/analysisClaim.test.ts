import { beforeEach, describe, expect, it } from "vitest";
import { claimNextAnalysisJobRpc } from "./creditService";
import { vitestAnalysisJobsStore, vitestSeedAnalysisJob } from "./vitestSetup";

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
  });

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
  });

  it("second claim returns the next queued job", async () => {
    seedQueued("j1", "2025-01-01T00:00:00.000Z");
    seedQueued("j2", "2025-01-02T00:00:00.000Z");
    const first = await claimNextAnalysisJobRpc();
    const second = await claimNextAnalysisJobRpc();
    expect(first?.id).toBe("j1");
    expect(second?.id).toBe("j2");
  });
});
