import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { InMemoryAnalysisJobStore } from "./inMemoryAnalysisJobStore";

const payload = {
  fileName: "game.sgf",
  language: "en" as const,
  sgfContent: "(;FF[4]GM[1];B[pd];W[dd])",
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
    const jobId = store.createAndEnqueueMock(payload);

    expect(store.toPublicGetResponse(jobId)?.status).toBe("queued");

    await vi.runAllTimersAsync();

    const done = store.toPublicGetResponse(jobId);
    expect(done?.status).toBe("completed");
    expect(done?.progress).toBe(100);
    expect(done?.data).toBeDefined();
    expect(done?.meta?.mock).toBe(true);
  });

  it("returns null for unknown job id", () => {
    const store = new InMemoryAnalysisJobStore();
    expect(store.toPublicGetResponse("nonexistent")).toBeNull();
  });
});
