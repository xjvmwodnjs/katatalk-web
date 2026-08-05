import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "./_core/sdk";

const mocks = vi.hoisted(() => ({
  profileData: null as unknown,
  profileError: null as { message: string } | null,
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("./_core/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mocks.maybeSingle,
        }),
      }),
    }),
    rpc: mocks.rpc,
  }),
  SupabaseAdminUnavailableError: class SupabaseAdminUnavailableError extends Error {},
}));

import { getOrProvisionProfileForClerkUser } from "./creditService";

const user = {
  id: 0,
  openId: "clerk:user_first_use",
  email: "first-use@example.test",
  name: "First Use",
  loginMethod: "clerk",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
} as AuthenticatedUser;

describe("read-before-create credit profile provisioning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profileData = null;
    mocks.profileError = null;
    mocks.maybeSingle.mockImplementation(async () => ({
      data: mocks.profileData,
      error: mocks.profileError,
    }));
    mocks.rpc.mockResolvedValue({
      data: { credits: 2, signup_bonus_rows: 1 },
      error: null,
    });
  });

  it("returns an existing profile with zero write RPCs", async () => {
    mocks.profileData = { credits: 7 };

    await expect(getOrProvisionProfileForClerkUser(user)).resolves.toEqual({
      credits: 7,
      signupBonusRows: 0,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("calls the idempotent provisioning RPC only when the profile is missing", async () => {
    await expect(getOrProvisionProfileForClerkUser(user)).resolves.toEqual({
      credits: 2,
      signupBonusRows: 1,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("ensure_profile_with_signup_bonus", {
      p_user_id: "user_first_use",
      p_email: "first-use@example.test",
      p_name: "First Use",
    });
  });

  it("concurrent first use converges to one signup bonus ledger insertion", async () => {
    let call = 0;
    mocks.rpc.mockImplementation(async () => {
      call += 1;
      return {
        data: { credits: 2, signup_bonus_rows: call === 1 ? 1 : 0 },
        error: null,
      };
    });

    const results = await Promise.all([
      getOrProvisionProfileForClerkUser(user),
      getOrProvisionProfileForClerkUser(user),
    ]);

    expect(results.reduce((sum, row) => sum + row.signupBonusRows, 0)).toBe(1);
    expect(results.every(row => row.credits === 2)).toBe(true);
  });

  it("fails closed on a malformed existing profile without invoking a write", async () => {
    mocks.profileData = { credits: "7" };

    await expect(getOrProvisionProfileForClerkUser(user)).rejects.toThrow(
      "profiles: invalid credit response"
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed on a profile read error without invoking a write", async () => {
    mocks.profileError = { message: "database read failed" };

    await expect(getOrProvisionProfileForClerkUser(user)).rejects.toThrow(
      "database read failed"
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
