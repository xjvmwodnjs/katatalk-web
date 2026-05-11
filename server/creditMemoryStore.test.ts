import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetCreditMemoryStoreForTests,
  memoryCountSignupBonuses,
  memoryEnsureWalletWithSignupBonus,
  memoryGetWalletBalance,
  memoryRefundSpendForJob,
  memorySpendCredit,
} from "./creditMemoryStore";

describe("creditMemoryStore", () => {
  beforeEach(() => {
    __resetCreditMemoryStoreForTests();
  });

  it("grants signup bonus once (idempotent)", async () => {
    await memoryEnsureWalletWithSignupBonus("clerk_user_a", null);
    await memoryEnsureWalletWithSignupBonus("clerk_user_a", null);
    expect(memoryCountSignupBonuses("clerk_user_a")).toBe(1);
    expect(await memoryGetWalletBalance("clerk_user_a")).toBe(2);
  });

  it("spends credits and records ledger", async () => {
    await memoryEnsureWalletWithSignupBonus("clerk_user_b", null);
    const s1 = await memorySpendCredit("clerk_user_b", "job-1", 1);
    expect(s1.ok).toBe(true);
    if (s1.ok) expect(s1.balanceAfter).toBe(1);
    const s2 = await memorySpendCredit("clerk_user_b", "job-2", 1);
    expect(s2.ok).toBe(true);
    if (s2.ok) expect(s2.balanceAfter).toBe(0);
  });

  it("returns INSUFFICIENT_CREDITS when balance too low", async () => {
    await memoryEnsureWalletWithSignupBonus("clerk_user_c", null);
    await memorySpendCredit("clerk_user_c", "job-a", 1);
    await memorySpendCredit("clerk_user_c", "job-b", 1);
    const s3 = await memorySpendCredit("clerk_user_c", "job-c", 1);
    expect(s3.ok).toBe(false);
    if (!s3.ok) expect(s3.code).toBe("INSUFFICIENT_CREDITS");
  });

  it("refunds spend on job failure (idempotent)", async () => {
    await memoryEnsureWalletWithSignupBonus("clerk_user_d", null);
    await memorySpendCredit("clerk_user_d", "job-x", 1);
    expect(await memoryGetWalletBalance("clerk_user_d")).toBe(1);
    await memoryRefundSpendForJob("clerk_user_d", "job-x", 1);
    expect(await memoryGetWalletBalance("clerk_user_d")).toBe(2);
    await memoryRefundSpendForJob("clerk_user_d", "job-x", 1);
    expect(await memoryGetWalletBalance("clerk_user_d")).toBe(2);
  });
});
