import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { InMemoryAnalysisJobStore } from "./inMemoryAnalysisJobStore";

const payload = {
  fileName: "game.sgf",
  language: "en" as const,
};

describe("InMemoryAnalysisJobStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts queued then completes with mock data", async () => {
    const store = new InMemoryAnalysisJobStore();
    const jobId = "test-job-1";
    store.createAndEnqueueMock({
      jobId,
      payload,
      ownerClerkSubject: "owner-1",
      ownerAppUserId: 1,
      creditLedgerId: 1,
    });

    expect(store.toPublicGetResponse(jobId)?.status).toBe("queued");

    await vi.runAllTimersAsync();

    const done = store.toPublicGetResponse(jobId);
    expect(done?.status).toBe("completed");
    expect(done?.progress).toBe(100);
    expect(done?.data).toBeDefined();
    expect(done?.meta?.mock).toBe(true);
    const internal = store.getInternal(jobId);
    expect(internal?.payload.fileName).toBe("game.sgf");
  });

  it("returns null for unknown job id", () => {
    const store = new InMemoryAnalysisJobStore();
    expect(store.toPublicGetResponse("nonexistent")).toBeNull();
  });
});
