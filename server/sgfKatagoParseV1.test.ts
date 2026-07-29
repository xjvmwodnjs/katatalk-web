import { describe, expect, it } from "vitest";
import {
  parseSgfForKatagoV1,
  SgfKatagoParseError,
  summarizeSgfForKatagoDebugV1,
} from "@shared/sgfKatagoParseV1";
import { extractMainlineBwMoves } from "@shared/sgfPlaybackV1";
import { parseMinimalSgfForSmoke } from "./worker/analysisEngines/katagoSgfQuery";

function expectParseErrorCode(
  sgf: string,
  code: SgfKatagoParseError["code"]
): SgfKatagoParseError {
  try {
    parseSgfForKatagoV1(sgf);
    throw new Error("expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(SgfKatagoParseError);
    expect((error as SgfKatagoParseError).code).toBe(code);
    return error as SgfKatagoParseError;
  }
}

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

  it("resolves initial player from setup PL, first move, handicap, then the standard default", () => {
    const explicit = parseSgfForKatagoV1(
      "(;FF[4]GM[1]SZ[19]HA[2]AB[pd][dp];PL[ W ];W[qq];B[dd])"
    );
    expect(explicit.initialPlayer).toBe("W");
    expect(explicit.initialPlayerSource).toBe("setup_pl");
    expect(explicit.handicapStones).toBe(2);

    const firstMove = parseSgfForKatagoV1(
      "(;FF[4]GM[1]SZ[19]AB[pd]AW[dp];W[qq];B[dd])"
    );
    expect(firstMove.initialPlayer).toBe("W");
    expect(firstMove.initialPlayerSource).toBe("first_move");
    expect(firstMove.handicapStones).toBeNull();

    const handicapOnly = parseSgfForKatagoV1(
      "(;FF[4]GM[1]SZ[19]HA[2]AB[pd][dp])"
    );
    expect(handicapOnly.initialPlayer).toBe("W");
    expect(handicapOnly.initialPlayerSource).toBe("handicap_default_white");

    const emptyBoard = parseSgfForKatagoV1("(;FF[4]GM[1]SZ[19])");
    expect(emptyBoard.initialPlayer).toBe("B");
    expect(emptyBoard.initialPlayerSource).toBe("standard_default_black");
  });

  it("allows HA[0] as a no-handicap exporter marker", () => {
    const parsed = parseSgfForKatagoV1("(;FF[4]GM[1]SZ[19]HA[0];B[pd];W[dp])");
    expect(parsed.handicapStones).toBeNull();
    expect(parsed.initialPlayer).toBe("B");
    expect(parsed.initialPlayerSource).toBe("first_move");
  });

  it("rejects invalid, conflicting, mixed-node, or post-move PL", () => {
    const invalidMarker = "private-player-marker-947";
    const invalid = expectParseErrorCode(
      `(;FF[4]GM[1]SZ[19]PL[${invalidMarker}];B[pd])`,
      "SGF_INVALID_PLAYER_TO_PLAY"
    );
    expect(invalid.message).not.toContain(invalidMarker);

    expectParseErrorCode(
      "(;FF[4]GM[1]SZ[19]PL[B];W[pd])",
      "SGF_PLAYER_TO_PLAY_CONFLICT"
    );
    expectParseErrorCode(
      "(;FF[4]GM[1]SZ[19]PL[B]B[pd])",
      "SGF_INVALID_PLAYER_TO_PLAY"
    );
    expectParseErrorCode(
      "(;FF[4]GM[1]SZ[19]PL[B]PL[B];B[pd])",
      "SGF_INVALID_PLAYER_TO_PLAY"
    );
    expectParseErrorCode(
      "(;FF[4]GM[1]SZ[19];B[pd];PL[W];W[dp])",
      "SGF_UNSUPPORTED_PLAYER_TO_PLAY"
    );
    const unclosed = expectParseErrorCode(
      `(;FF[4]GM[1]SZ[19];B[pd];PL[${invalidMarker}`,
      "SGF_INVALID_PLAYER_TO_PLAY"
    );
    expect(unclosed.message).not.toContain(invalidMarker);
  });

  it("rejects invalid or duplicate HA and HA/setup mismatches", () => {
    for (const sgf of [
      "(;FF[4]GM[1]SZ[19]HA[1]AB[pd];W[qq])",
      "(;FF[4]GM[1]SZ[19]HA[-2]AB[pd][dp];W[qq])",
      "(;FF[4]GM[1]SZ[19]HA[private-handicap-marker-947]AB[pd][dp];W[qq])",
      "(;FF[4]GM[1]SZ[19]HA[2][3]AB[pd][dp];W[qq])",
      "(;FF[4]GM[1]SZ[19]HA[2]HA[2]AB[pd][dp];W[qq])",
    ]) {
      const error = expectParseErrorCode(sgf, "SGF_INVALID_HANDICAP");
      expect(error.message).not.toContain("private-handicap-marker-947");
    }

    expectParseErrorCode(
      "(;FF[4]GM[1]SZ[19]HA[2]AB[pd];W[qq])",
      "SGF_HANDICAP_SETUP_MISMATCH"
    );
    const unclosed = expectParseErrorCode(
      "(;FF[4]GM[1]SZ[19];B[pd];HA[private-handicap-marker-947",
      "SGF_INVALID_HANDICAP"
    );
    expect(unclosed.message).not.toContain("private-handicap-marker-947");
  });

  it("ignores PL and HA lookalikes inside comments and variations", () => {
    const parsed = parseSgfForKatagoV1(
      "(;FF[4]GM[1]SZ[19]C[PL[X\\] HA[9\\]];B[pd](;PL[W];W[dd]);W[dp])"
    );
    expect(parsed.initialPlayer).toBe("B");
    expect(parsed.initialPlayerSource).toBe("first_move");
    expect(parsed.handicapStones).toBeNull();
  });

  it("accepts the supported root SZ and exact KataGo KM contract", () => {
    const fixtures = [
      { sgf: "(;GM[1]FF[4]SZ[9]KM[0];B[ee])", boardSize: 9, komi: 0 },
      { sgf: "(;GM[1]FF[4]SZ[13]KM[6.5];B[gg])", boardSize: 13, komi: 6.5 },
      { sgf: "(;GM[1]FF[4]SZ[19]KM[+7.5];B[pd])", boardSize: 19, komi: 7.5 },
      { sgf: "(;GM[1]FF[4]SZ[19]KM[-0.5];B[pd])", boardSize: 19, komi: -0.5 },
      {
        sgf: "(;GM[1]FF[4]SZ[+019]KM[ 6.50 ];B[pd])",
        boardSize: 19,
        komi: 6.5,
      },
      { sgf: "(;GM[1]FF[4]SZ[19]KM[150];B[pd])", boardSize: 19, komi: 150 },
      { sgf: "(;GM[1]FF[4]SZ[19]KM[-150.0];B[pd])", boardSize: 19, komi: -150 },
    ] as const;
    for (const fixture of fixtures) {
      const parsed = parseSgfForKatagoV1(fixture.sgf);
      expect(parsed.boardSize).toBe(fixture.boardSize);
      expect(parsed.boardSizeSource).toBe("root_sz");
      expect(parsed.komi).toBe(fixture.komi);
      expect(parsed.komiSource).toBe("root_km");
    }
  });

  it("ignores SZ/KM-looking text inside comments, property values, and variations", () => {
    expect(parseSgfForKatagoV1("(;GM[1]C[KM[999]]KM[7.5];B[pd])").komi).toBe(
      7.5
    );
    expect(parseSgfForKatagoV1("(;GM[1]KM[6.5]C[KM[999]];B[pd])").komi).toBe(
      6.5
    );
    expect(
      parseSgfForKatagoV1("(;GM[1]C[escaped \\] text KM[999]]KM[6.5];B[pd])")
        .komi
    ).toBe(6.5);
    const variation = parseSgfForKatagoV1(
      "(;GM[1]SZ[19]KM[6.5];B[pd](;C[parentheses ) ( stay text]SZ[9]KM[0];W[dd]);W[dp])"
    );
    expect(variation.boardSize).toBe(19);
    expect(variation.komi).toBe(6.5);
    expect(variation.moves).toHaveLength(2);
  });

  it("defaults only absent SZ/KM to 19 and 6.5", () => {
    const parsed = parseSgfForKatagoV1("(;GM[1];B[pd])");
    expect(parsed.boardSize).toBe(19);
    expect(parsed.boardSizeSource).toBe("sgf_default_missing");
    expect(parsed.komi).toBe(6.5);
    expect(parsed.komiSource).toBe("product_default_missing");
  });

  it("rejects malformed, repeated, multi-valued, non-root, or unclosed SZ", () => {
    const marker = "private-board-marker-947";
    for (const sgf of [
      "(;GM[1]SZ[];B[pd])",
      `(;GM[1]SZ[${marker}];B[pd])`,
      "(;GM[1]SZ[19.0];B[pd])",
      "(;GM[1]SZ[0];B[pd])",
      "(;GM[1]SZ[-1];B[pd])",
      "(;GM[1]SZ[53];B[pd])",
      "(;GM[1]SZ[19:19];B[pd])",
      "(;GM[1]SZ[19][13];B[pd])",
      "(;GM[1]SZ[19]SZ[19];B[pd])",
      "(;GM[1];SZ[19];B[pd])",
      `(;GM[1]SZ[${marker}`,
    ]) {
      const error = expectParseErrorCode(sgf, "SGF_INVALID_BOARD_SIZE");
      expect(error.message).not.toContain(marker);
    }
  });

  it("rejects rectangular or launch-unsupported board sizes", () => {
    for (const raw of ["1", "2", "5", "21", "25", "26", "52", "19:13"]) {
      expectParseErrorCode(
        `(;GM[1]SZ[${raw}];B[aa])`,
        "SGF_UNSUPPORTED_BOARD_SIZE"
      );
    }
  });

  it("rejects malformed, repeated, multi-valued, non-root, or unclosed KM", () => {
    const marker = "private-komi-marker-947";
    for (const sgf of [
      "(;GM[1]SZ[19]KM[];B[pd])",
      `(;GM[1]SZ[19]KM[${marker}];B[pd])`,
      "(;GM[1]SZ[19]KM[6,5];B[pd])",
      "(;GM[1]SZ[19]KM[.5];B[pd])",
      "(;GM[1]SZ[19]KM[6.];B[pd])",
      "(;GM[1]SZ[19]KM[6.5e1];B[pd])",
      "(;GM[1]SZ[19]KM[6.5points];B[pd])",
      "(;GM[1]SZ[19]KM[6.5][7.5];B[pd])",
      "(;GM[1]SZ[19]KM[6.5]KM[6.5];B[pd])",
      "(;GM[1]SZ[19];KM[6.5];B[pd])",
      `(;GM[1]SZ[19]KM[${marker}`,
    ]) {
      const error = expectParseErrorCode(sgf, "SGF_INVALID_KOMI");
      expect(error.message).not.toContain(marker);
    }
  });

  it("rejects KM values KataGo cannot analyze exactly", () => {
    for (const raw of ["6.25", "-0.25", "150.5", "-150.5", "151", "-151"]) {
      expectParseErrorCode(
        `(;GM[1]SZ[19]KM[${raw}];B[pd])`,
        "SGF_UNSUPPORTED_KOMI"
      );
    }
  });

  it("rejects an unclosed variation without reflecting its content", () => {
    const marker = "private-variation-marker-947";
    const error = expectParseErrorCode(
      `(;GM[1]SZ[19]KM[6.5];B[pd](;C[${marker}`,
      "SGF_PARSE_FAILED"
    );
    expect(error.message).not.toContain(marker);
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

  it("rejects setup stones mixed with a move regardless of property order", () => {
    for (const sgf of [
      "(;FF[4]GM[1]SZ[19]AB[pd]B[qq])",
      "(;FF[4]GM[1]SZ[19]B[qq]AB[pd])",
    ]) {
      try {
        parseSgfForKatagoV1(sgf);
        throw new Error("expected failure");
      } catch (error) {
        expect(error).toBeInstanceOf(SgfKatagoParseError);
        expect((error as SgfKatagoParseError).code).toBe(
          "SGF_UNSUPPORTED_SETUP_STONES"
        );
      }
    }
  });

  it("rejects invalid coordinates", () => {
    const sgf = "(;SZ[9];B[zz])";
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
