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

  it("keeps invalid optional game metadata field-local and admission-safe", () => {
    const sgf =
      "(;FF[4]GM[1]SZ[19]PB[A]PB[B]PW[One][Two]DT[2023-02-29]RE[B+private-marker];B[pd])";
    expect(validateSgfText(sgf)).toEqual({ ok: true });
    expect(parseSgfForKatagoV1(sgf).gameMetadata).toMatchObject({
      blackPlayer: null,
      whitePlayer: null,
      date: null,
      resultRaw: null,
      result: null,
    });
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

  it("enforces fixed root SZ admission errors without reflecting submitted values", () => {
    const marker = "private-board-marker-947";
    const invalid = validateSgfText(`(;GM[1]SZ[${marker}];B[pd])`);
    expect(invalid).toEqual({
      ok: false,
      code: "SGF_INVALID_BOARD_SIZE",
      message:
        "Invalid SGF: SZ must be a single root property with one integer value.",
    });
    expect(JSON.stringify(invalid)).not.toContain(marker);

    expect(validateSgfText("(;GM[1]SZ[19:13];B[pd])")).toEqual({
      ok: false,
      code: "SGF_UNSUPPORTED_BOARD_SIZE",
      message:
        "Invalid SGF: only square 9x9, 13x13, and 19x19 boards are supported.",
    });
  });

  it("enforces fixed root KM admission errors without reflecting submitted values", () => {
    const marker = "private-komi-marker-947";
    const invalid = validateSgfText(`(;GM[1]SZ[19]KM[${marker}];B[pd])`);
    expect(invalid).toEqual({
      ok: false,
      code: "SGF_INVALID_KOMI",
      message:
        "Invalid SGF: KM must be a single root property with one numeric value.",
    });
    expect(JSON.stringify(invalid)).not.toContain(marker);

    expect(validateSgfText("(;GM[1]SZ[19]KM[6.25];B[pd])")).toEqual({
      ok: false,
      code: "SGF_UNSUPPORTED_KOMI",
      message:
        "Invalid SGF: KM must be an integer or half-integer from -150 to 150.",
    });
  });

  it("preserves missing SZ/KM defaults and accepted 9/13/19 half-point fixtures", () => {
    expect(validateSgfText("(;GM[1];B[pd])")).toEqual({ ok: true });
    for (const sgf of [
      "(;GM[1]SZ[9]KM[0];B[ee])",
      "(;GM[1]SZ[13]KM[6.5];B[gg])",
      "(;GM[1]SZ[19]KM[-0.5];B[pd])",
    ]) {
      expect(validateSgfText(sgf)).toEqual({ ok: true });
    }
  });

  it("accepts a consistent handicap and pre-move PL contract", () => {
    const sgf = "(;FF[4]GM[1]SZ[19]HA[2]AB[pd][dp];PL[W];W[qq];B[dd])";
    expect(validateSgfText(sgf)).toEqual({ ok: true });
    const parsed = parseSgfForKatagoV1(sgf);
    expect(parsed.initialPlayer).toBe("W");
    expect(parsed.handicapStones).toBe(2);
  });

  it("rejects invalid PL contracts with fixed non-reflective errors", () => {
    const marker = "private-player-marker-947";
    expect(validateSgfText(`(;FF[4]GM[1]SZ[19]PL[${marker}];B[pd])`)).toEqual({
      ok: false,
      code: "SGF_INVALID_PLAYER_TO_PLAY",
      message:
        "Invalid SGF: PL must contain exactly B or W in a setup node before the first move.",
    });
    expect(validateSgfText("(;FF[4]GM[1]SZ[19]PL[B];W[pd])")).toEqual({
      ok: false,
      code: "SGF_PLAYER_TO_PLAY_CONFLICT",
      message: "Invalid SGF: PL conflicts with the first move color.",
    });
    expect(validateSgfText("(;FF[4]GM[1]SZ[19];B[pd];PL[W];W[dp])")).toEqual({
      ok: false,
      code: "SGF_UNSUPPORTED_PLAYER_TO_PLAY",
      message: "Invalid SGF: PL after the first move is not supported.",
    });
    expect(
      JSON.stringify(validateSgfText(`(;FF[4]GM[1]SZ[19]PL[${marker}];B[pd])`))
    ).not.toContain(marker);
  });

  it("rejects invalid or inconsistent HA with fixed non-reflective errors", () => {
    const marker = "private-handicap-marker-947";
    expect(
      validateSgfText(`(;FF[4]GM[1]SZ[19]HA[${marker}]AB[pd][dp];W[qq])`)
    ).toEqual({
      ok: false,
      code: "SGF_INVALID_HANDICAP",
      message: "Invalid SGF: HA must be 0 or an integer of at least 2.",
    });
    expect(validateSgfText("(;FF[4]GM[1]SZ[19]HA[2]AB[pd];W[qq])")).toEqual({
      ok: false,
      code: "SGF_HANDICAP_SETUP_MISMATCH",
      message: "Invalid SGF: HA does not match the initial black setup stones.",
    });
    expect(
      JSON.stringify(
        validateSgfText(`(;FF[4]GM[1]SZ[19]HA[${marker}]AB[pd][dp];W[qq])`)
      )
    ).not.toContain(marker);
  });

  it("rejects out-of-board setup coordinates before paid admission", () => {
    expect(
      validateSgfText("(;FF[4]GM[1]SZ[19]HA[2]AB[zz][yy];W[qq])")
    ).toEqual({
      ok: false,
      code: "SGF_INVALID_COORDINATE",
      message:
        "Invalid SGF: one or more move or setup coordinates are invalid for the board size.",
    });
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

  it("rejects setup stones mixed with a move regardless of property order", () => {
    for (const sgf of [
      "(;FF[4]GM[1]SZ[19]AB[pd]B[qq])",
      "(;FF[4]GM[1]SZ[19]B[qq]AB[pd])",
    ]) {
      const result = validateSgfText(sgf);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/move node|setup stones/i);
      }
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
