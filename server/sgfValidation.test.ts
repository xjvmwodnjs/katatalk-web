import { describe, expect, it } from "vitest";
import { validateSgfText } from "./sgfValidation";

const MINIMAL_SGF =
  "(;FF[4]GM[1]SZ[19]PB[Black]PW[White];B[pd];W[dd];B[pp];W[dp])";

describe("validateSgfText", () => {
  it("accepts a minimal valid SGF", () => {
    expect(validateSgfText(MINIMAL_SGF)).toEqual({ ok: true });
  });

  it("accepts UTF-8 BOM then root", () => {
    expect(validateSgfText(`\uFEFF${MINIMAL_SGF}`)).toEqual({ ok: true });
  });

  it("rejects empty content", () => {
    const r = validateSgfText("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/empty/i);
  });

  it("rejects when root does not start with '('", () => {
    const r = validateSgfText(";FF[4]GM[1];B[pd]");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/\(/);
  });

  it("rejects without FF or GM", () => {
    const r = validateSgfText("(;SZ[19];B[pd];W[dd])");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/FF|GM/i);
  });

  it("rejects without B[] or W[] moves", () => {
    const r = validateSgfText("(;FF[4]GM[1]SZ[19]AB[pd][dd])");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/B\[|W\[/);
  });

  it("accepts pass moves", () => {
    const r = validateSgfText("(;FF[4]GM[1];B[];W[])");
    expect(r).toEqual({ ok: true });
  });
});
