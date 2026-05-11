import { describe, expect, it } from "vitest";
import { ensureProfileForClerkUser, spendCreditForAnalysisJob } from "./creditService";
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
});
