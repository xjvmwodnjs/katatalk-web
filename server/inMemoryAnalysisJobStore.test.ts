import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { InMemoryAnalysisJobStore } from "./inMemoryAnalysisJobStore";
import { getAnalysisJobRow, insertAnalysisJobQueued } from "./creditService";
import { vitestAnalysisJobsStore } from "./vitestSetup";
import { sha256HexUtf8, utf8ByteLength } from "./sgfPayload";

const sgfA = "(;FF[4]GM[1]SZ[19];B[pd];W[dp])";
const sgfB = "(;FF[4]GM[1]SZ[19];B[dd];W[dp])";

const payload = {
  fileName: "game.sgf",
  language: "en" as const,
};

describe("InMemoryAnalysisJobStore (DB-backed mock pipeline)", () => {
  beforeEach(() => {
    vitestAnalysisJobsStore.clear();
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates Supabase analysis_jobs from queued to completed with mock result", async () => {
    const store = new InMemoryAnalysisJobStore();
    const jobId = "test-job-db-1";
    await insertAnalysisJobQueued({
      jobId,
      profileId: "owner-1",
      fileName: payload.fileName,
      language: payload.language,
      creditLogId: "00000000-0000-0000-0000-000000000001",
      sgfContent: sgfA,
      sgfSha256: sha256HexUtf8(sgfA),
      sgfSizeBytes: utf8ByteLength(sgfA),
    });

    store.createAndEnqueueMock({
      jobId,
      payload,
    });

    expect((await getAnalysisJobRow(jobId))?.status).toBe("queued");

    await vi.runAllTimersAsync();

    const row = await getAnalysisJobRow(jobId);
    expect(row?.status).toBe("completed");
    expect(row?.result).toBeDefined();
    expect(row?.progress).toBe(100);
  });

  it("does not depend on in-memory job map", async () => {
    const store = new InMemoryAnalysisJobStore();
    const jobId = "test-job-db-2";
    await insertAnalysisJobQueued({
      jobId,
      profileId: "owner-x",
      fileName: "x.sgf",
      language: "ko",
      creditLogId: "00000000-0000-0000-0000-000000000002",
      sgfContent: sgfB,
      sgfSha256: sha256HexUtf8(sgfB),
      sgfSizeBytes: utf8ByteLength(sgfB),
    });
    store.createAndEnqueueMock({ jobId, payload: { fileName: "x.sgf", language: "ko" } });
    await vi.runAllTimersAsync();
    const row = await getAnalysisJobRow(jobId);
    expect(row?.status).toBe("completed");
  });
});
