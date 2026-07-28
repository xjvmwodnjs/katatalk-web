import { describe, expect, it } from "vitest";
import { parseSgfForKatagoV1, SgfKatagoParseError } from "@shared/sgfKatagoParseV1";
import { validateSgfText } from "./sgfValidation";

const MINIMAL_SGF =
  "(;FF[4]GM[1]SZ[19]PB[Black]PW[White];B[pd];W[dd];B[pp];W[dp])";

const LEARNING_EVENTS_SMOKE_SGF =
  "(;FF[4]GM[1]SZ[19]KM[6.5];B[pd];W[dp];B[pp];W[dd];B[fq];W[cn];B[qf];W[dc];B[cf];W[fc];B[jj];W[qq];B[qd];W[dq];B[oc];W[co];B[pc];W[cp];B[qn];W[dn];B[jp])";

describe("validateSgfText", () => {
  it("accepts a minimal valid SGF", () => {
    expect(validateSgfText(MINIMAL_SGF)).toEqual({ ok: true });
  });

  it("accepts supported, missing, and blank root rules", () => {
    expect(validateSgfText("(;GM[1]SZ[19]RU[Japanese];B[pd])")).toEqual({
      ok: true,
    });
    expect(validateSgfText("(;GM[1]SZ[19];B[pd])")).toEqual({ ok: true });
    expect(validateSgfText("(;GM[1]SZ[19]RU[];B[pd])")).toEqual({ ok: true });
  });

  it("rejects unsupported root rules with a fixed non-reflective error", () => {
    const marker = "private-rule-marker-947";
    const result = validateSgfText(`(;GM[1]SZ[19]RU[${marker}];B[pd])`);
    expect(result).toEqual({
      ok: false,
      code: "SGF_UNSUPPORTED_RULES",
      message: "Invalid SGF: only Japanese rules are supported.",
    });
    expect(JSON.stringify(result)).not.toContain(marker);

    try {
      parseSgfForKatagoV1(`(;GM[1]SZ[19]RU[${marker}];B[pd])`);
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(SgfKatagoParseError);
      expect((error as SgfKatagoParseError).code).toBe("SGF_UNSUPPORTED_RULES");
      expect((error as Error).message).not.toContain(marker);
    }
  });

  it("rejects an unclosed root RU with a fixed parse error", () => {
    const marker = "private-unclosed-rule-marker-947";
    const result = validateSgfText(`(;GM[1]SZ[19]B[pd]RU[${marker}`);
    expect(result).toEqual({
      ok: false,
      code: "SGF_PARSE_FAILED",
      message: "Invalid SGF: the root RU property is not closed.",
    });
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("does not treat comment, later-node, or variation RU text as root rules", () => {
    expect(
      validateSgfText(
        "(;GM[1]SZ[19]C[RU[private-rule-marker-947]];B[pd];RU[AGA](;W[dd]RU[NZ]))"
      )
    ).toEqual({ ok: true });
  });

  it("accepts the learning events smoke fixture", () => {
    expect(validateSgfText(LEARNING_EVENTS_SMOKE_SGF)).toEqual({ ok: true });
    expect(() => parseSgfForKatagoV1(LEARNING_EVENTS_SMOKE_SGF)).not.toThrow();
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

  it("accepts SGF with moves even when both FF and GM are missing", () => {
    expect(validateSgfText("(;SZ[19];B[pd])")).toEqual({ ok: true });
    const parsed = parseSgfForKatagoV1("(;SZ[19];B[pd])");
    expect(parsed.parseWarnings.some((w) => w.code === "missing_ff_assumed_v4")).toBe(true);
    expect(parsed.parseWarnings.some((w) => w.code === "missing_gm_assumed_go")).toBe(true);
  });

  it("accepts SGF with FF but missing GM", () => {
    expect(validateSgfText("(;FF[4]SZ[19];B[pd])")).toEqual({ ok: true });
    const parsed = parseSgfForKatagoV1("(;FF[4]SZ[19];B[pd])");
    expect(parsed.parseWarnings.some((w) => w.code === "missing_gm_assumed_go")).toBe(true);
  });

  it("accepts SGF with GM[1] but missing FF", () => {
    expect(validateSgfText("(;GM[1]SZ[19];B[pd])")).toEqual({ ok: true });
    const parsed = parseSgfForKatagoV1("(;GM[1]SZ[19];B[pd])");
    expect(parsed.parseWarnings.some((w) => w.code === "missing_ff_assumed_v4")).toBe(true);
  });

  it("rejects explicit non-Go GM", () => {
    const r = validateSgfText("(;GM[2]SZ[19];B[pd])");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/GM\[2\]|game type/i);
    expect(() => parseSgfForKatagoV1("(;GM[2]SZ[19];B[pd])")).toThrow(SgfKatagoParseError);
  });

  it("rejects without B[] or W[] moves", () => {
    const r = validateSgfText("(;FF[4]GM[1]SZ[19]AB[pd][dd])");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/B\[|W\[/);
  });

  it("does not count move-looking comment text as a real move", () => {
    const r = validateSgfText("(;SZ[19]C[B[pd]])");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/B\[|W\[/);
  });

  it("accepts initial setup stones when a real mainline move exists", () => {
    expect(validateSgfText("(;SZ[19]AB[pd][dd]AW[pp]AE[dd];W[qq])")).toEqual({ ok: true });
  });

  it("rejects after-move setup stones before enqueue", () => {
    const sgf = "(;SZ[19];B[pd];AW[dd])";
    const r = validateSgfText(sgf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/AB\/AW\/AE|setup stones/i);
    try {
      parseSgfForKatagoV1(sgf);
      throw new Error("expected failure");
    } catch (e) {
      expect(e).toBeInstanceOf(SgfKatagoParseError);
      expect((e as SgfKatagoParseError).code).toBe("SGF_UNSUPPORTED_SETUP_STONES");
    }
  });

  it("does not treat setup-looking comment text as setup stones", () => {
    expect(validateSgfText("(;SZ[19]C[AB[aa] AW[bb] AE[cc]];B[pd])")).toEqual({ ok: true });
    expect(validateSgfText("(;SZ[19]C[escaped \\] text AB[aa\\] AW[bb\\]];B[pd])")).toEqual({ ok: true });
  });

  it("accepts pass moves", () => {
    const r = validateSgfText("(;FF[4]GM[1];B[];W[])");
    expect(r).toEqual({ ok: true });
  });
});
