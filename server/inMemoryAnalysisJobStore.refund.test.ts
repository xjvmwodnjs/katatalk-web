import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as mockAnalysisResult from "./mockAnalysisResult";
import { InMemoryAnalysisJobStore } from "./inMemoryAnalysisJobStore";
import * as creditService from "./creditService";
import { vitestAnalysisJobsStore } from "./vitestSetup";
import type { AuthenticatedUser } from "./_core/sdk";
import { sha256HexUtf8, utf8ByteLength } from "./sgfPayload";

const refundSgf = "(;FF[4]GM[1]SZ[19];B[pd];W[dp])";

const refundUser = {
  id: 99,
  openId: "clerk:refund_u",
  email: "r@test.com",
  name: "Refund User",
  loginMethod: "clerk",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
} as AuthenticatedUser;

describe("InMemoryAnalysisJobStore refund on mock failure", () => {
  beforeEach(() => {
    vitestAnalysisJobsStore.clear();
    vi.useFakeTimers();
    vi.spyOn(mockAnalysisResult, "buildMockAnalysisReport").mockImplementation(() => {
      throw new Error("forced mock pipeline failure");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("calls refundCreditIfJobFailed and persists failed status", async () => {
    const refundSpy = vi.spyOn(creditService, "refundCreditIfJobFailed").mockResolvedValue(undefined);
    const jobId = "job-refund-1";
    await creditService.insertAnalysisJobQueued({
      jobId,
      profileId: "refund_u",
      fileName: "x.sgf",
      language: "ko",
      creditLogId: "00000000-0000-0000-0000-00000000ee01",
      sgfContent: refundSgf,
      sgfSha256: sha256HexUtf8(refundSgf),
      sgfSizeBytes: utf8ByteLength(refundSgf),
    });

    const store = new InMemoryAnalysisJobStore();
    store.createAndEnqueueMock({
      jobId,
      payload: { fileName: "x.sgf", language: "ko" },
      onJobFailed: () => creditService.refundCreditIfJobFailed(refundUser, jobId, 1),
    });

    await vi.runAllTimersAsync();

    expect(refundSpy).toHaveBeenCalledWith(refundUser, jobId, 1);
    const row = await creditService.getAnalysisJobRow(jobId);
    expect(row?.status).toBe("failed");
    expect(row?.error_message).toContain("forced mock pipeline failure");
  });
});
