import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "./_core/sdk";
import { walletSubjectFromAuthUser } from "./creditService";

describe("walletSubjectFromAuthUser", () => {
  it("strips clerk: prefix", () => {
    const u = {
      openId: "clerk:user_2AbC",
    } as AuthenticatedUser;
    expect(walletSubjectFromAuthUser(u)).toBe("user_2AbC");
  });

  it("prefixes non-clerk openIds", () => {
    const u = { openId: "local-dev-user" } as AuthenticatedUser;
    expect(walletSubjectFromAuthUser(u)).toBe("non-clerk:local-dev-user");
  });
});
