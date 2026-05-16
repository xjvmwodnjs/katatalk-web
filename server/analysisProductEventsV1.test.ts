import { describe, expect, it } from "vitest";
import {
  PRODUCT_EVENT_CONFIDENCE_LABELS_V1,
  PRODUCT_REVIEW_MOVE_CATEGORY_LABELS_V1,
  isProductDecisiveMoveV1,
  isProductGameResultV1,
  isProductReviewMoveV1,
  parseProductGameResultV1FromSgf,
} from "@shared/analysisProductEventsV1";

describe("analysis product events v1", () => {
  it("parses RE[B+R] as black resignation win", () => {
    expect(parseProductGameResultV1FromSgf("(;FF[4]GM[1]SZ[19]RE[B+R];B[pd])")).toEqual({
      winnerColor: "B",
      loserColor: "W",
      resultType: "resign",
      margin: null,
      rawResult: "B+R",
    });
  });

  it("parses RE[W+2.5] as white points win", () => {
    expect(parseProductGameResultV1FromSgf("(;FF[4]GM[1]SZ[19]RE[W+2.5];B[pd])")).toEqual({
      winnerColor: "W",
      loserColor: "B",
      resultType: "points",
      margin: 2.5,
      rawResult: "W+2.5",
    });
  });

  it("parses draw results", () => {
    expect(parseProductGameResultV1FromSgf("(;FF[4]GM[1]SZ[19]RE[0])")).toEqual({
      winnerColor: null,
      loserColor: null,
      resultType: "draw",
      margin: null,
      rawResult: "0",
    });
    expect(parseProductGameResultV1FromSgf("(;FF[4]GM[1]SZ[19]RE[Draw])").resultType).toBe("draw");
    expect(parseProductGameResultV1FromSgf("(;FF[4]GM[1]SZ[19]RE[Jigo])").resultType).toBe("draw");
  });

  it("returns unknown when RE is missing", () => {
    expect(parseProductGameResultV1FromSgf("(;FF[4]GM[1]SZ[19];B[pd])")).toEqual({
      winnerColor: null,
      loserColor: null,
      resultType: "unknown",
      margin: null,
      rawResult: null,
    });
  });

  it("computes loserColor from winnerColor", () => {
    expect(parseProductGameResultV1FromSgf("(;RE[B+2.5])").loserColor).toBe("W");
    expect(parseProductGameResultV1FromSgf("(;RE[W+R])").loserColor).toBe("B");
  });

  it("strictly parses point margins and non-point suffixes", () => {
    expect(parseProductGameResultV1FromSgf("(;RE[B+2.5])")).toMatchObject({
      winnerColor: "B",
      loserColor: "W",
      resultType: "points",
      margin: 2.5,
    });
    expect(parseProductGameResultV1FromSgf("(;RE[W+2,5])")).toMatchObject({
      winnerColor: "W",
      loserColor: "B",
      resultType: "points",
      margin: 2.5,
    });
    expect(parseProductGameResultV1FromSgf("(;RE[B+T])")).toMatchObject({
      winnerColor: "B",
      loserColor: "W",
      resultType: "time",
      margin: null,
    });
    expect(parseProductGameResultV1FromSgf("(;RE[W+F])")).toMatchObject({
      winnerColor: "W",
      loserColor: "B",
      resultType: "forfeit",
      margin: null,
    });
    expect(parseProductGameResultV1FromSgf("(;RE[B+2.5abc])")).toMatchObject({
      winnerColor: null,
      loserColor: null,
      resultType: "unknown",
      margin: null,
    });
    expect(parseProductGameResultV1FromSgf("(;RE[B+-0.5])")).toMatchObject({
      winnerColor: null,
      loserColor: null,
      resultType: "unknown",
      margin: null,
    });
    expect(parseProductGameResultV1FromSgf("(;RE[B+])")).toMatchObject({
      winnerColor: null,
      loserColor: null,
      resultType: "unknown",
      margin: null,
    });
  });

  it("rejects inconsistent game result shapes", () => {
    expect(isProductGameResultV1({
      winnerColor: "B",
      loserColor: "W",
      resultType: "draw",
      margin: null,
      rawResult: "0",
    })).toBe(false);
    expect(isProductGameResultV1({
      winnerColor: "B",
      loserColor: "W",
      resultType: "unknown",
      margin: null,
      rawResult: "B+?",
    })).toBe(false);
    expect(isProductGameResultV1({
      winnerColor: "B",
      loserColor: "B",
      resultType: "resign",
      margin: null,
      rawResult: "B+R",
    })).toBe(false);
    expect(isProductGameResultV1({
      winnerColor: "B",
      loserColor: "W",
      resultType: "points",
      margin: null,
      rawResult: "B+2.5",
    })).toBe(false);
    expect(isProductGameResultV1({
      winnerColor: "B",
      loserColor: "W",
      resultType: "points",
      margin: 0,
      rawResult: "B+0",
    })).toBe(false);
    expect(isProductGameResultV1({
      winnerColor: "B",
      loserColor: "W",
      resultType: "resign",
      margin: 1,
      rawResult: "B+R",
    })).toBe(false);
    expect(isProductGameResultV1({
      winnerColor: "B",
      loserColor: "W",
      resultType: "time",
      margin: 1,
      rawResult: "B+T",
    })).toBe(false);
    expect(isProductGameResultV1({
      winnerColor: "B",
      loserColor: "W",
      resultType: "forfeit",
      margin: 1,
      rawResult: "B+F",
    })).toBe(false);
  });

  it("guards product event schemas", () => {
    const gameResult = parseProductGameResultV1FromSgf("(;RE[B+R])");
    expect(isProductGameResultV1(gameResult)).toBe(true);

    const decisive = {
      turnIndex: 42,
      player: "W",
      playedMove: "D4",
      recommendedMove: "Q16",
      scoreLoss: 5.5,
      winrateLoss: 0.12,
      confidence: "medium",
      sourceEventId: "learning-42",
      evidence: { source: ["learningEventsV1"], notes: ["score loss candidate"], pv: ["Q16", "D16"] },
    };
    expect(isProductDecisiveMoveV1(decisive)).toBe(true);
    expect(isProductDecisiveMoveV1({ ...decisive, turnIndex: 1.5 })).toBe(false);
    expect(isProductDecisiveMoveV1({ ...decisive, scoreLoss: -1 })).toBe(false);
    expect(isProductDecisiveMoveV1({ ...decisive, scoreLoss: Number.NaN })).toBe(false);
    expect(isProductDecisiveMoveV1({ ...decisive, scoreLoss: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isProductDecisiveMoveV1({ ...decisive, scoreLoss: "5" })).toBe(false);
    expect(isProductDecisiveMoveV1({ ...decisive, winrateLoss: -0.1 })).toBe(false);
    expect(isProductDecisiveMoveV1({ ...decisive, winrateLoss: 1.1 })).toBe(false);
    expect(isProductDecisiveMoveV1({ ...decisive, winrateLoss: Number.NaN })).toBe(false);
    expect(isProductDecisiveMoveV1({ ...decisive, winrateLoss: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isProductDecisiveMoveV1({ ...decisive, winrateLoss: "0.1" })).toBe(false);
    expect(isProductDecisiveMoveV1({ ...decisive, evidence: { source: [] } })).toBe(false);

    const review = {
      ...decisive,
      category: "learning_candidate",
      sourceEventId: null,
    };
    expect(isProductReviewMoveV1(review)).toBe(true);
    expect(isProductReviewMoveV1({ ...review, category: "bad_move" })).toBe(false);
  });

  it("keeps product labels free from assertive forbidden terms", () => {
    const labels = [
      ...Object.values(PRODUCT_REVIEW_MOVE_CATEGORY_LABELS_V1),
      ...Object.values(PRODUCT_EVENT_CONFIDENCE_LABELS_V1),
    ].join(" ");
    expect(labels).not.toMatch(/패착 확정|악수|정답|best move|blunder/i);
  });
});
