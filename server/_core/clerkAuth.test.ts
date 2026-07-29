import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    clerkSecretKey: "sk_test_clerk",
    databaseUrl: "postgres://test",
  },
  verifyToken: vi.fn(),
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
  ensureWalletWithSignupBonus: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));
vi.mock("./env", () => ({ ENV: mocks.env }));
vi.mock("../db", () => ({
  upsertUser: mocks.upsertUser,
  getUserByOpenId: mocks.getUserByOpenId,
}));
vi.mock("../creditService", () => ({
  ensureWalletWithSignupBonus: mocks.ensureWalletWithSignupBonus,
}));

import { verifyClerkBearerAndSyncUser } from "./clerkAuth";

const dbUser = {
  id: 17,
  openId: "clerk:user_123",
  name: "Kata User",
  email: "kata@example.com",
  loginMethod: "clerk",
  role: "user",
  subscriptionTier: "free",
  remainingAnalysisCount: 2,
  maxAnalysisCount: 3,
  subscriptionStartDate: null,
  preferredLanguage: "ko",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  lastSignedIn: new Date("2026-01-01T00:00:00.000Z"),
};

describe("verifyClerkBearerAndSyncUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.databaseUrl = "postgres://test";
    mocks.verifyToken.mockResolvedValue({
      sub: "user_123",
      email: "kata@example.com",
      name: "Kata User",
    });
    mocks.upsertUser.mockResolvedValue(undefined);
    mocks.getUserByOpenId.mockResolvedValue(dbUser);
    mocks.ensureWalletWithSignupBonus.mockResolvedValue(undefined);
  });

  it("keeps DB identity sync but skips wallet provisioning for admission auth", async () => {
    const user = await verifyClerkBearerAndSyncUser("valid-token", {
      ensureWallet: false,
    });

    expect(user).toMatchObject({ id: 17, openId: "clerk:user_123" });
    expect(mocks.upsertUser).toHaveBeenCalledTimes(1);
    expect(mocks.getUserByOpenId).toHaveBeenCalledWith("clerk:user_123");
    expect(mocks.ensureWalletWithSignupBonus).not.toHaveBeenCalled();

    await verifyClerkBearerAndSyncUser("valid-token");
    expect(mocks.ensureWalletWithSignupBonus).toHaveBeenCalledTimes(1);
  });

  it("skips wallet provisioning in the no-database identity fallback", async () => {
    mocks.env.databaseUrl = "";

    const user = await verifyClerkBearerAndSyncUser("valid-token", {
      ensureWallet: false,
    });

    expect(user).toMatchObject({ id: 0, openId: "clerk:user_123" });
    expect(mocks.upsertUser).not.toHaveBeenCalled();
    expect(mocks.getUserByOpenId).not.toHaveBeenCalled();
    expect(mocks.ensureWalletWithSignupBonus).not.toHaveBeenCalled();

    await verifyClerkBearerAndSyncUser("valid-token");
    expect(mocks.ensureWalletWithSignupBonus).toHaveBeenCalledTimes(1);
  });

  it("returns null without provisioning when Clerk rejects the token", async () => {
    mocks.verifyToken.mockRejectedValue(new Error("invalid token"));

    await expect(
      verifyClerkBearerAndSyncUser("invalid-token", { ensureWallet: false })
    ).resolves.toBeNull();
    expect(mocks.ensureWalletWithSignupBonus).not.toHaveBeenCalled();
  });
});
