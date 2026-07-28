import { describe, expect, it } from "vitest";
import {
  parseSgfForKatagoV1,
  SgfKatagoParseError,
  summarizeSgfForKatagoDebugV1,
} from "@shared/sgfKatagoParseV1";
import { extractMainlineBwMoves } from "@shared/sgfPlaybackV1";
import { parseMinimalSgfForSmoke } from "./worker/analysisEngines/katagoSgfQuery";

describe("sgfKatagoParseV1", () => {
  it("defaults missing or blank root RU to Japanese rules", () => {
    expect(parseSgfForKatagoV1("(;GM[1]SZ[19];B[pd])").rules).toBe("japanese");
    expect(parseSgfForKatagoV1("(;GM[1]SZ[19]RU[];B[pd])").rules).toBe("japanese");
    expect(parseSgfForKatagoV1("(;GM[1]SZ[19]RU[   ];B[pd])").rules).toBe("japanese");
  });

  it("normalizes reviewed Japanese rules aliases", () => {
    const aliases = [
      "Japanese",
      " JAPANESE   RULES ",
      "Japan",
      "Japan Rules",
      "Ｊａｐａｎｅｓｅ",
      "日本",
      "日本式",
      "日本ルール",
    ];
    for (const alias of aliases) {
      expect(
        parseSgfForKatagoV1(`(;GM[1]SZ[19]RU[${alias}];B[pd])`).rules
      ).toBe("japanese");
    }
  });

  it("rejects unsupported root RU values without reflecting the raw label", () => {
    const unsupported = ["Chinese", "AGA", "NZ", "Ing", "private-rule-marker-947"];
    for (const rawRules of unsupported) {
      try {
        parseSgfForKatagoV1(`(;GM[1]SZ[19]RU[${rawRules}];B[pd])`);
        throw new Error("expected failure");
      } catch (error) {
        expect(error).toBeInstanceOf(SgfKatagoParseError);
        expect((error as SgfKatagoParseError).code).toBe("SGF_UNSUPPORTED_RULES");
        expect((error as Error).message).not.toContain(rawRules);
      }
    }
  });

  it("reads RU only from the root node and ignores property-value lookalikes", () => {
    const parsed = parseSgfForKatagoV1(
      "(;GM[1]SZ[19]XX[safe][RU[private-rule-marker-947]]C[RU[Chinese]]RU[Japanese];B[pd];RU[AGA](;W[dd]RU[NZ]))"
    );
    expect(parsed.rules).toBe("japanese");
  });

  it("rejects unsupported duplicate or multi-value root RU without an allowlist bypass", () => {
    for (const sgf of [
      "(;GM[1]SZ[19]RU[Japanese][private-rule-marker-947];B[pd])",
      "(;GM[1]SZ[19]RU[Japanese]RU[private-rule-marker-947];B[pd])",
    ]) {
      expect(() => parseSgfForKatagoV1(sgf)).toThrow(SgfKatagoParseError);
      try {
        parseSgfForKatagoV1(sgf);
      } catch (error) {
        expect((error as SgfKatagoParseError).code).toBe("SGF_UNSUPPORTED_RULES");
        expect((error as Error).message).not.toContain("private-rule-marker-947");
      }
    }
  });

  it("reads KM property from actual SGF property values", () => {
    expect(parseSgfForKatagoV1("(;GM[1]FF[4]KM[6.5]SZ[19];B[pd])").komi).toBe(6.5);
    expect(parseSgfForKatagoV1("(;GM[1]FF[4]KM[7.5]SZ[19];B[pd])").komi).toBe(7.5);
    expect(parseSgfForKatagoV1("(;GM[1]FF[4]KM[0]SZ[19];B[pd])").komi).toBe(0);
    expect(parseSgfForKatagoV1("(;GM[1]FF[4]KM[-0.5]SZ[19];B[pd])").komi).toBe(-0.5);
  });

  it("ignores KM-looking text inside comments and property values", () => {
    expect(parseSgfForKatagoV1("(;GM[1]C[KM[999]]KM[7.5];B[pd])").komi).toBe(7.5);
    expect(parseSgfForKatagoV1("(;GM[1]KM[6.5]C[KM[999]];B[pd])").komi).toBe(6.5);
    expect(parseSgfForKatagoV1("(;GM[1]C[escaped \\] text KM[999]]KM[6.5];B[pd])").komi).toBe(6.5);
  });

  it("falls back to default komi when KM is absent or invalid", () => {
    expect(parseSgfForKatagoV1("(;GM[1]SZ[19];B[pd])").komi).toBe(6.5);
    expect(parseSgfForKatagoV1("(;GM[1]KM[abc]SZ[19];B[pd])").komi).toBe(6.5);
  });

  it("does not treat ;B[] inside comment as a move", () => {
    const sgf = "(;SZ[19];C[fake;B[pd]here];B[aa];W[bb])";
    const parsed = parseSgfForKatagoV1(sgf);
    expect(parsed.moves).toHaveLength(2);
    expect(parsed.moves[0]).toEqual({ color: "B", sgfPoint: "aa" });
  });

  it("handles pass moves", () => {
    const sgf = "(;SZ[19];B[pd];W[];B[pp])";
    const parsed = parseSgfForKatagoV1(sgf);
    expect(parsed.moves).toHaveLength(3);
    expect(parsed.moves[1]).toEqual({ color: "W", sgfPoint: "" });
  });

  it("parses initial setup stones before the first move", () => {
    const parsed = parseSgfForKatagoV1("(;FF[4]GM[1]SZ[19]AB[pd][dd]AW[pp]AE[dd];B[qq])");
    expect(parsed.initialStones).toEqual([
      { color: "B", sgfPoint: "pd" },
      { color: "W", sgfPoint: "pp" },
    ]);
    expect(parsed.moves).toEqual([{ color: "B", sgfPoint: "qq" }]);
    expect(parsed.parseWarnings.some((w) => w.code === "setup_stones_applied")).toBe(true);
  });

  it("keeps the later setup color when AB and AW conflict", () => {
    const parsed = parseSgfForKatagoV1("(;FF[4]GM[1]SZ[19]AB[aa]AW[aa];B[bb])");
    expect(parsed.initialStones).toEqual([{ color: "W", sgfPoint: "aa" }]);
    expect(parsed.parseWarnings.some((w) => w.code === "setup_stone_conflict")).toBe(true);
  });

  it("rejects setup stones after the first move with SGF_UNSUPPORTED_SETUP_STONES", () => {
    const sgf = "(;FF[4]GM[1]SZ[19];B[bb];AW[aa])";
    expect(() => parseSgfForKatagoV1(sgf)).toThrow(SgfKatagoParseError);
    try {
      parseSgfForKatagoV1(sgf);
    } catch (e) {
      expect(e).toBeInstanceOf(SgfKatagoParseError);
      expect((e as SgfKatagoParseError).code).toBe("SGF_UNSUPPORTED_SETUP_STONES");
    }
  });

  it("rejects invalid coordinates", () => {
    const sgf = "(;SZ[5];B[zz])";
    expect(() => parseSgfForKatagoV1(sgf)).toThrow(SgfKatagoParseError);
    try {
      parseSgfForKatagoV1(sgf);
    } catch (e) {
      expect((e as SgfKatagoParseError).code).toBe("SGF_INVALID_COORDINATE");
    }
  });

  it("supports SZ[9] and SZ[13]", () => {
    const s9 = parseSgfForKatagoV1("(;SZ[9];B[ee])");
    expect(s9.boardSize).toBe(9);
    const s13 = parseSgfForKatagoV1("(;SZ[13];B[aa])");
    expect(s13.boardSize).toBe(13);
  });

  it("allows missing FF or GM with warnings and rejects non-Go GM", () => {
    const noFf = parseSgfForKatagoV1("(;GM[1]SZ[19];B[pd])");
    expect(noFf.parseWarnings.some((w) => w.code === "missing_ff_assumed_v4")).toBe(true);

    const noGm = parseSgfForKatagoV1("(;FF[4]SZ[19];B[pd])");
    expect(noGm.parseWarnings.some((w) => w.code === "missing_gm_assumed_go")).toBe(true);

    const neither = parseSgfForKatagoV1("(;SZ[19];B[pd])");
    expect(neither.parseWarnings.some((w) => w.code === "missing_ff_assumed_v4")).toBe(true);
    expect(neither.parseWarnings.some((w) => w.code === "missing_gm_assumed_go")).toBe(true);

    try {
      parseSgfForKatagoV1("(;FF[4]GM[2]SZ[19];B[pd])");
      throw new Error("expected failure");
    } catch (e) {
      expect(e).toBeInstanceOf(SgfKatagoParseError);
      expect((e as SgfKatagoParseError).code).toBe("SGF_UNSUPPORTED_GAME_TYPE");
    }
  });

  it("does not treat AB/AW/GM/FF-looking escaped comment text as properties", () => {
    const parsed = parseSgfForKatagoV1("(;FF[4]GM[1]C[AB[aa\\] AW[bb\\] GM[2\\] FF[3\\] escaped \\] text];B[pd])");
    expect(parsed.initialStones).toEqual([]);
    expect(parsed.moves).toEqual([{ color: "B", sgfPoint: "pd" }]);
    expect(parsed.parseWarnings.some((w) => w.code === "unsupported_game_type")).toBe(false);
  });

  it("legacy smoke parser matches mainline move count", () => {
    const samples = [
      "(;SZ[19];B[pd];W[dp];B[pq])",
      "(;SZ[19];C[fake;B[pd]here];B[aa];W[bb])",
      "(;SZ[19];B[pd];W[];B[pp])",
    ];
    for (const sgf of samples) {
      const main = extractMainlineBwMoves(sgf).moves.length;
      const katago = parseSgfForKatagoV1(sgf).moves.length;
      const smoke = parseMinimalSgfForSmoke(sgf).moves.length;
      expect(katago).toBe(main);
      expect(smoke).toBe(main);
    }
  });

  it("summarizeSgfForKatagoDebugV1 omits raw SGF text", () => {
    const sgf = "(;SZ[19];B[pd];W[dp])";
    const summary = summarizeSgfForKatagoDebugV1(sgf);
    expect(summary.totalMoves).toBe(2);
    expect(JSON.stringify(summary)).not.toContain("(;SZ");
  });
});
