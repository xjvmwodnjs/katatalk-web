import { describe, expect, it } from "vitest";
import { enqueuePaidAnalysisJob, ensureProfileForClerkUser, spendCreditForAnalysisJob } from "./creditService";
import type { AuthenticatedUser } from "./_core/sdk";

const sampleUser = {
  id: 1,
  openId: "clerk:tester_rpc",
  email: "rpc@katatalk.test",
  name: "RPC Tester",
  loginMethod: "clerk",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
} as AuthenticatedUser;

describe("Supabase-backed credit RPC (mocked client)", () => {
  it("ensureProfileForClerkUser returns credits from RPC", async () => {
    const r = await ensureProfileForClerkUser(sampleUser);
    expect(r.credits).toBe(2);
  });

  it("spendCreditForAnalysisJob deducts when RPC ok", async () => {
    const r = await spendCreditForAnalysisJob(sampleUser, `job-ok-${Date.now()}`, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.balanceAfter).toBe(1);
      expect(r.ledgerId).toMatch(/^[0-9a-f-]{36}$/i);
    }
  });

  it("spendCreditForAnalysisJob returns INSUFFICIENT_CREDITS for dedicated job id", async () => {
    const r = await spendCreditForAnalysisJob(sampleUser, "insufficient-job", 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INSUFFICIENT_CREDITS");
  });

  it("enqueuePaidAnalysisJob returns one atomic enqueue-and-debit result", async () => {
    const r = await enqueuePaidAnalysisJob({
      user: sampleUser,
      jobId: `atomic-job-${Date.now()}`,
      fileName: "game.sgf",
      language: "ko",
      sgfContent: "(;FF[4]GM[1]SZ[19])",
      sgfSha256: "a".repeat(64),
      sgfSizeBytes: 22,
      isMock: false,
    });
    expect(r).toMatchObject({ ok: true, balanceAfter: 1 });
  });
});
