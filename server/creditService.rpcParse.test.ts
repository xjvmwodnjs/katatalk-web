import { describe, expect, it } from "vitest";
import { parseSupabaseRpcJson } from "./creditService";

describe("parseSupabaseRpcJson (add_credits_from_payment shape)", () => {
  it("parses plain object", () => {
    expect(parseSupabaseRpcJson({ ok: true, duplicate: false, credits: 22 })).toEqual({
      ok: true,
      duplicate: false,
      credits: 22,
    });
  });

  it("parses single-element array row", () => {
    expect(parseSupabaseRpcJson([{ ok: true, duplicate: false, credits: 33 }])).toEqual({
      ok: true,
      duplicate: false,
      credits: 33,
    });
  });

  it("parses JSON string object", () => {
    expect(parseSupabaseRpcJson('{"ok":true,"duplicate":false,"credits":44}')).toEqual({
      ok: true,
      duplicate: false,
      credits: 44,
    });
  });
});
