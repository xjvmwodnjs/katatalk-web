import { describe, expect, it } from "vitest";
import {
  SGF_GAME_INFO_VERSION_V1,
  isValidSgfDateV1,
  parseSgfRootGameMetadataV1,
} from "@shared/sgfGameMetadataV1";

describe("SGF game metadata v1", () => {
  it("parses safe root PB/PW/DT/RE with SGF SimpleText normalization", () => {
    const parsed = parseSgfRootGameMetadataV1(
      "(;FF[4]GM[1]PB[  Cho\\\r\n  Chikun  ]PW[Lee\\] Sedol]DT[2024-02-29,03-01]RE[w+resign];B[pd])"
    );

    expect(parsed).toEqual({
      version: SGF_GAME_INFO_VERSION_V1,
      blackPlayer: "Cho Chikun",
      whitePlayer: "Lee] Sedol",
      date: "2024-02-29,03-01",
      resultRaw: "w+resign",
      result: "W+R",
      warnings: [{ field: "RE", code: "noncanonical_format" }],
    });
  });

  it("keeps joiners in names and consumes CRLF/LFCR soft line breaks", () => {
    const parsed = parseSgfRootGameMetadataV1(
      "(;PB[نام\u200Cبازیکن]PW[White\\\n\rPlayer]DT[2024-01-01]RE[B+R])"
    );
    expect(parsed.blackPlayer).toBe("نام\u200Cبازیکن");
    expect(parsed.whitePlayer).toBe("WhitePlayer");
    expect(parsed.warnings).toEqual([]);
  });

  it("keeps missing metadata unknown without warnings", () => {
    expect(parseSgfRootGameMetadataV1("(;FF[4]GM[1]SZ[19];B[pd])")).toEqual({
      version: SGF_GAME_INFO_VERSION_V1,
      blackPlayer: null,
      whitePlayer: null,
      date: null,
      resultRaw: null,
      result: null,
      warnings: [],
    });
  });

  it("does not choose arbitrary duplicate, multi-value, or non-root fields", () => {
    const parsed = parseSgfRootGameMetadataV1(
      "(;PB[A]PB[B]PW[One][Two];DT[2024-01-01]RE[B+R];B[pd])"
    );

    expect(parsed).toMatchObject({
      blackPlayer: null,
      whitePlayer: null,
      date: null,
      resultRaw: null,
      result: null,
    });
    expect(parsed.warnings).toEqual([
      { field: "PB", code: "duplicate" },
      { field: "PW", code: "multi_value" },
      { field: "DT", code: "non_root" },
      { field: "RE", code: "non_root" },
    ]);
  });

  it("treats explicit blanks as unknown and records fixed warnings", () => {
    const parsed = parseSgfRootGameMetadataV1("(;PB[]PW[ ]DT[\t]RE[])");
    expect(parsed.blackPlayer).toBeNull();
    expect(parsed.whitePlayer).toBeNull();
    expect(parsed.date).toBeNull();
    expect(parsed.result).toBeNull();
    expect(parsed.warnings).toEqual([
      { field: "PB", code: "blank" },
      { field: "PW", code: "blank" },
      { field: "DT", code: "blank" },
      { field: "RE", code: "blank" },
    ]);
  });

  it("ignores comment, unknown-property, and variation lookalikes", () => {
    const parsed = parseSgfRootGameMetadataV1(
      "(;C[PB[Fake\\] RE[W+R\\]]XX[PW[Fake\\] DT[1999\\]]PB[Root B]PW[Root W]RE[B+R];B[pd](;PB[Variation B]RE[W+R];W[dd]))"
    );
    expect(parsed).toMatchObject({
      blackPlayer: "Root B",
      whitePlayer: "Root W",
      date: null,
      resultRaw: "B+R",
      result: "B+R",
      warnings: [],
    });
  });

  it("fails closed on unsafe controls and over-limit values without truncation", () => {
    const accepted = "가".repeat(128);
    const rejected = "나".repeat(129);
    const parsed = parseSgfRootGameMetadataV1(
      `(;PB[${accepted}]PW[${rejected}]RE[B+\u202ER])`
    );
    expect(parsed.blackPlayer).toBe(accepted);
    expect(parsed.whitePlayer).toBeNull();
    expect(parsed.result).toBeNull();
    expect(parsed.warnings).toEqual([
      { field: "PW", code: "too_long" },
      { field: "RE", code: "unsafe_control" },
    ]);
  });

  it("marks malformed target properties without reflecting their contents", () => {
    const parsed = parseSgfRootGameMetadataV1("(;PB;B[pd])");
    expect(parsed.blackPlayer).toBeNull();
    expect(parsed.warnings).toEqual([{ field: "PB", code: "malformed" }]);
  });

  it.each([
    "2024",
    "2024-07",
    "2024-02-29",
    "1996-05,06",
    "1996-05-06,07,08",
    "1996-12-27,28,1997-01-03,04",
  ])("accepts FF4 date form %s", value => {
    expect(isValidSgfDateV1(value)).toBe(true);
    expect(parseSgfRootGameMetadataV1(`(;DT[${value}])`).date).toBe(value);
  });

  it.each([
    "0000",
    "2023-02-29",
    "2024-13",
    "2024-04-31",
    "2024-01-01,32",
    "2024-01,13",
    "1996,05",
    "1996,05-06",
    "2024/01/01",
  ])("rejects invalid date form %s field-locally", value => {
    const parsed = parseSgfRootGameMetadataV1(`(;DT[${value}])`);
    expect(parsed.date).toBeNull();
    expect(parsed.warnings).toContainEqual({
      field: "DT",
      code: "invalid_format",
    });
  });

  it.each([
    ["0", "0"],
    ["Draw", "0"],
    ["Void", "Void"],
    ["?", "?"],
    ["B+", "B+"],
    ["B+R", "B+R"],
    ["W+Time", "W+T"],
    ["B+Forfeit", "B+F"],
    ["W+2.50", "W+2.5"],
    ["B+2,5", "B+2.5"],
  ])("normalizes supported RE[%s] to %s", (raw, expected) => {
    const parsed = parseSgfRootGameMetadataV1(`(;RE[${raw}])`);
    expect(parsed.resultRaw).toBe(raw);
    expect(parsed.result).toBe(expected);
  });

  it.each(["Draw", "B+Resign", "W+Time", "B+Forfeit", "W+2.50"])(
    "does not warn for official RE spelling %s",
    raw => {
      expect(parseSgfRootGameMetadataV1(`(;RE[${raw}])`).warnings).toEqual([]);
    }
  );

  it("canonicalizes numeric margins lexically and rejects unsafe product ranges", () => {
    expect(parseSgfRootGameMetadataV1("(;RE[B+0002.5000])").result).toBe(
      "B+2.5"
    );
    const tooLarge = parseSgfRootGameMetadataV1("(;RE[B+1000.5])");
    expect(tooLarge.result).toBeNull();
    expect(tooLarge.resultRaw).toBeNull();
    expect(tooLarge.warnings).toContainEqual({
      field: "RE",
      code: "invalid_format",
    });
    expect(
      parseSgfRootGameMetadataV1("(;RE[B+999999999999999999999])").result
    ).toBeNull();
    expect(
      parseSgfRootGameMetadataV1("(;RE[B+1000.0000000000000000001])").result
    ).toBeNull();
    expect(
      parseSgfRootGameMetadataV1("(;RE[B+999.999999999999999999])").result
    ).toBeNull();
  });

  it.each(["B+0", "B+-1", "B+2.5abc", "Black wins", "B+?"])(
    "does not infer a winner from invalid RE[%s]",
    raw => {
      const parsed = parseSgfRootGameMetadataV1(`(;RE[${raw}])`);
      expect(parsed.resultRaw).toBeNull();
      expect(parsed.result).toBeNull();
      expect(parsed.warnings).toContainEqual({
        field: "RE",
        code: "invalid_format",
      });
    }
  );
});
