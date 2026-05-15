import { describe, expect, it } from "vitest";
import {
  parseSgfForKatagoV1,
  SgfKatagoParseError,
  summarizeSgfForKatagoDebugV1,
} from "@shared/sgfKatagoParseV1";
import { extractMainlineBwMoves } from "@shared/sgfPlaybackV1";
import { parseMinimalSgfForSmoke } from "./worker/analysisEngines/katagoSgfQuery";

describe("sgfKatagoParseV1", () => {
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

  it("rejects AB setup stones with SGF_UNSUPPORTED_SETUP_STONES", () => {
    const sgf = "(;SZ[19];AB[aa];B[bb])";
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
