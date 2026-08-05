import {
  TokenVerificationError,
  TokenVerificationErrorReason,
} from "@clerk/backend/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    clerkSecretKey: "sk_test_clerk",
    databaseUrl: "postgres://test",
  },
  verifyToken: vi.fn(),
  upsertUser: vi.fn(),
  getUserByOpenIdRequired: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({ verifyToken: mocks.verifyToken }));
vi.mock("./env", () => ({ ENV: mocks.env }));
vi.mock("../db", () => ({
  upsertUser: mocks.upsertUser,
  getUserByOpenIdRequired: mocks.getUserByOpenIdRequired,
}));

import { AuthDependencyUnavailableError } from "./authErrors";
import {
  provisionClerkUserForFirstUse,
  verifyClerkBearerReadOnly,
} from "./clerkAuth";

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

const PARSABLE_TEST_JWT =
  "eyJhbGciOiJSUzI1NiIsImtpZCI6ImtpZF90ZXN0In0.eyJzdWIiOiJ1c2VyXzEyMyJ9.c2ln";

function tokenError(
  reason: (typeof TokenVerificationErrorReason)[keyof typeof TokenVerificationErrorReason]
) {
  return new TokenVerificationError({
    reason,
    message: "sensitive clerk detail",
  });
}

describe("read-only Clerk authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.clerkSecretKey = "sk_test_clerk";
    mocks.env.databaseUrl = "postgres://test";
    mocks.verifyToken.mockResolvedValue({
      sub: "user_123",
      email: "kata@example.com",
      name: "Kata User",
    });
    mocks.getUserByOpenIdRequired.mockResolvedValue(dbUser);
    mocks.upsertUser.mockResolvedValue(undefined);
  });

  it("performs zero identity writes across 1,000 polling authentications", async () => {
    const users = await Promise.all(
      Array.from({ length: 1_000 }, () =>
        verifyClerkBearerReadOnly("valid-token")
      )
    );

    expect(users).toHaveLength(1_000);
    expect(users.every(user => user?.openId === "clerk:user_123")).toBe(true);
    expect(mocks.getUserByOpenIdRequired).toHaveBeenCalledTimes(1_000);
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  it("returns a verified claim identity without writing when the DB row is absent", async () => {
    mocks.getUserByOpenIdRequired.mockResolvedValue(null);

    const user = await verifyClerkBearerReadOnly("valid-token");

    expect(user).toMatchObject({ id: 0, openId: "clerk:user_123" });
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  it("uses the claim identity without touching MySQL when DATABASE_URL is absent", async () => {
    mocks.env.databaseUrl = "";

    const user = await verifyClerkBearerReadOnly("valid-token");

    expect(user).toMatchObject({ id: 0, openId: "clerk:user_123" });
    expect(mocks.getUserByOpenIdRequired).not.toHaveBeenCalled();
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  it.each([
    TokenVerificationErrorReason.TokenInvalid,
    TokenVerificationErrorReason.TokenExpired,
    TokenVerificationErrorReason.TokenInvalidAuthorizedParties,
    TokenVerificationErrorReason.JWKKidMismatch,
  ])("treats %s as an unauthenticated token", async reason => {
    mocks.verifyToken.mockRejectedValue(tokenError(reason));

    await expect(
      verifyClerkBearerReadOnly("invalid-token")
    ).resolves.toBeNull();
    expect(mocks.getUserByOpenIdRequired).not.toHaveBeenCalled();
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  it("treats a malformed JWT parser failure as an unauthenticated token", async () => {
    mocks.verifyToken.mockRejectedValue(
      new SyntaxError("sensitive parser detail")
    );

    await expect(verifyClerkBearerReadOnly("a.b.c")).resolves.toBeNull();
    expect(mocks.getUserByOpenIdRequired).not.toHaveBeenCalled();
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  it.each([
    TokenVerificationErrorReason.RemoteJWKFailedToLoad,
    TokenVerificationErrorReason.InvalidSecretKey,
  ])("fails closed with a dependency error for %s", async reason => {
    mocks.verifyToken.mockRejectedValue(tokenError(reason));

    await expect(
      verifyClerkBearerReadOnly(PARSABLE_TEST_JWT)
    ).rejects.toBeInstanceOf(AuthDependencyUnavailableError);
  });

  it("keeps an unknown verifier failure for a parsable JWT as dependency unavailable", async () => {
    mocks.verifyToken.mockRejectedValue(
      new SyntaxError("sensitive remote response detail")
    );

    await expect(
      verifyClerkBearerReadOnly(PARSABLE_TEST_JWT)
    ).rejects.toBeInstanceOf(AuthDependencyUnavailableError);
  });

  it("fails closed when the identity store read fails", async () => {
    mocks.getUserByOpenIdRequired.mockRejectedValue(
      new Error("database host leaked")
    );

    await expect(
      verifyClerkBearerReadOnly("valid-token")
    ).rejects.toBeInstanceOf(AuthDependencyUnavailableError);
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  it("fails closed when the Clerk server key is missing", async () => {
    mocks.env.clerkSecretKey = "";

    await expect(
      verifyClerkBearerReadOnly("valid-token")
    ).rejects.toBeInstanceOf(AuthDependencyUnavailableError);
    expect(mocks.verifyToken).not.toHaveBeenCalled();
  });
});

describe("explicit Clerk first-use provisioning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.clerkSecretKey = "sk_test_clerk";
    mocks.env.databaseUrl = "postgres://test";
    mocks.upsertUser.mockResolvedValue(undefined);
  });

  const claimUser = { ...dbUser, id: 0 };

  it("returns an existing identity without an upsert", async () => {
    mocks.getUserByOpenIdRequired.mockResolvedValue(dbUser);

    const user = await provisionClerkUserForFirstUse(claimUser);

    expect(user.id).toBe(17);
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  it("creates a missing identity once and reads it back", async () => {
    mocks.getUserByOpenIdRequired
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(dbUser);

    const user = await provisionClerkUserForFirstUse(claimUser);

    expect(user.id).toBe(17);
    expect(mocks.upsertUser).toHaveBeenCalledTimes(1);
    expect(mocks.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({
        openId: "clerk:user_123",
        loginMethod: "clerk",
      })
    );
  });

  it("fails closed when a created identity cannot be read back", async () => {
    mocks.getUserByOpenIdRequired.mockResolvedValue(null);

    await expect(
      provisionClerkUserForFirstUse(claimUser)
    ).rejects.toBeInstanceOf(AuthDependencyUnavailableError);
    expect(mocks.upsertUser).toHaveBeenCalledTimes(1);
  });
});
