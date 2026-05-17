import { describe, expect, it } from "vitest";
import { tagConceptsV1, type ConceptTaggerInputV1 } from "@shared/conceptTaggerV1";

function baseInput(overrides: Partial<ConceptTaggerInputV1> = {}): ConceptTaggerInputV1 {
  return {
    boardSize: 5,
    stonesBefore: [],
    turnIndex: 20,
    totalMoves: 100,
    player: "B",
    playedMove: "C3",
    recommendedMove: "C3",
    pv: ["C3"],
    scoreLoss: null,
    winrateLoss: null,
    ownershipSummary: { available: false },
    ladderEvidence: false,
    ...overrides,
  };
}

function tags(input: ConceptTaggerInputV1) {
  return tagConceptsV1(input).conceptTagsV1;
}

describe("conceptTaggerV1", () => {
  it("adds connection tag from adjacent own groups", () => {
    const out = tags(baseInput({
      stonesBefore: [
        { x: 1, y: 2, color: "B" },
        { x: 3, y: 2, color: "B" },
      ],
    }));

    expect(out).toContainEqual(expect.objectContaining({ tag: "connection", confidence: "medium" }));
  });

  it("adds cut tag from adjacent opponent groups with local support", () => {
    const out = tags(baseInput({
      stonesBefore: [
        { x: 1, y: 2, color: "B" },
        { x: 2, y: 1, color: "W" },
        { x: 2, y: 3, color: "W" },
      ],
    }));

    expect(out).toContainEqual(expect.objectContaining({ tag: "cut", confidence: "medium" }));
  });

  it("does not create high-confidence invasion or reduction without ownership", () => {
    const out = tagConceptsV1(baseInput({ ownershipSummary: { available: false } }));

    expect(out.conceptTagsV1.some((tag) => (tag.tag === "invasion" || tag.tag === "reduction") && tag.confidence === "high")).toBe(false);
    expect(out.forbiddenConceptClaims).toEqual(expect.arrayContaining([
      expect.objectContaining({ concept: "invasion", reason: "ownership_evidence_unavailable" }),
      expect.objectContaining({ concept: "reduction", reason: "ownership_evidence_unavailable" }),
    ]));
  });

  it("does not add life_and_death_context without liberty evidence", () => {
    const out = tagConceptsV1(baseInput());

    expect(out.conceptTagsV1.some((tag) => tag.tag === "life_and_death_context")).toBe(false);
    expect(out.forbiddenConceptClaims).toContainEqual(expect.objectContaining({ concept: "life_and_death_context" }));
  });

  it("does not create high-confidence ladder_risk without ladder evidence", () => {
    const out = tagConceptsV1(baseInput());

    expect(out.conceptTagsV1.some((tag) => tag.tag === "ladder_risk" && tag.confidence === "high")).toBe(false);
    expect(out.forbiddenConceptClaims).toContainEqual(expect.objectContaining({ concept: "ladder_risk", reason: "ladder_reading_unavailable" }));
  });

  it("detects endgame phase conservatively", () => {
    const out = tags(baseInput({ turnIndex: 180, totalMoves: 220 }));

    expect(out).toContainEqual(expect.objectContaining({ tag: "endgame", confidence: "low" }));
  });

  it("is safe when conceptTags is empty", () => {
    const out = tagConceptsV1(baseInput({ playedMove: null, recommendedMove: null, totalMoves: null }));

    expect(out.conceptTagsV1).toEqual([]);
    expect(out.forbiddenConceptClaims.length).toBeGreaterThan(0);
  });

  it("does not promote v2.5 taxonomy directly into concept tags", () => {
    const out = tagConceptsV1(baseInput({
      stonesBefore: [],
      scoreLoss: 4,
      winrateLoss: 0.1,
    }));

    expect(out.conceptTagsV1.some((tag) => tag.tag === "shape")).toBe(false);
    expect(out.conceptTagsV1.some((tag) => tag.tag === "weak_group_attack")).toBe(false);
  });
});
