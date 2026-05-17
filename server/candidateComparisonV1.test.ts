import { describe, expect, it } from "vitest";
import { buildCandidateComparisonV1 } from "@shared/candidateComparisonV1";

describe("candidateComparisonV1", () => {
  it("classifies same_move and no_recommendation", () => {
    expect(buildCandidateComparisonV1({
      turnIndex: 1,
      playedMove: "C3",
      recommendedMove: "C3",
      scoreLoss: null,
      winrateLoss: null,
    }).comparisonType).toBe("same_move");
    expect(buildCandidateComparisonV1({
      turnIndex: 1,
      playedMove: "C3",
      recommendedMove: null,
      scoreLoss: null,
      winrateLoss: null,
    }).comparisonType).toBe("no_recommendation");
  });

  it("adds numeric deltas only when product loss values exist", () => {
    const out = buildCandidateComparisonV1({
      turnIndex: 2,
      playedMove: "C3",
      recommendedMove: "D4",
      scoreLoss: 4.5,
      winrateLoss: 0.08,
    });

    expect(out.comparisonType).toBe("move_difference");
    expect(out.deltas).toContainEqual(expect.objectContaining({ type: "score_loss", severity: "medium" }));
    expect(out.deltas).toContainEqual(expect.objectContaining({ type: "winrate_loss", severity: "medium" }));
  });

  it("does not create loss deltas for ADI or timeline-only context", () => {
    const out = buildCandidateComparisonV1({
      turnIndex: 3,
      playedMove: "C3",
      recommendedMove: "D4",
      scoreLoss: null,
      winrateLoss: null,
    });

    expect(out.deltas.some((delta) => delta.type === "score_loss" || delta.type === "winrate_loss")).toBe(false);
  });

  it("adds concept delta only when concept tags exist", () => {
    const empty = buildCandidateComparisonV1({
      turnIndex: 4,
      playedMove: "C3",
      recommendedMove: "D4",
      scoreLoss: null,
      winrateLoss: null,
      conceptTagsV1: [],
    });
    const tagged = buildCandidateComparisonV1({
      turnIndex: 4,
      playedMove: "C3",
      recommendedMove: "D4",
      scoreLoss: null,
      winrateLoss: null,
      conceptTagsV1: [{ tag: "connection", confidence: "medium", evidence: ["ownAdjacentGroups=2"], caveats: ["adjacency_heuristic_only"] }],
    });

    expect(empty.deltas.some((delta) => delta.type === "concept_difference")).toBe(false);
    expect(tagged.deltas).toContainEqual(expect.objectContaining({ type: "concept_difference" }));
    expect(tagged.deltas).toContainEqual(expect.objectContaining({ type: "local_shape" }));
  });

  it("adds pv_direction only when PV is available", () => {
    const withoutPv = buildCandidateComparisonV1({
      turnIndex: 5,
      playedMove: "C3",
      recommendedMove: "D4",
      scoreLoss: null,
      winrateLoss: null,
      pv: [],
    });
    const withPv = buildCandidateComparisonV1({
      turnIndex: 5,
      playedMove: "C3",
      recommendedMove: "D4",
      scoreLoss: null,
      winrateLoss: null,
      pv: ["D4", "C4"],
    });

    expect(withoutPv.deltas.some((delta) => delta.type === "pv_direction")).toBe(false);
    expect(withPv.deltas).toContainEqual(expect.objectContaining({ type: "pv_direction" }));
  });

  it("carries forbiddenConceptClaims into safe forbiddenClaims", () => {
    const out = buildCandidateComparisonV1({
      turnIndex: 6,
      playedMove: "C3",
      recommendedMove: "D4",
      scoreLoss: null,
      winrateLoss: null,
      forbiddenConceptClaims: [{ concept: "invasion", reason: "ownership_evidence_unavailable" }],
    });

    expect(out.forbiddenClaims).toContain("invasion:ownership_evidence_unavailable");
  });

  it("filters unsafe generated evidence and forbidden claims", () => {
    const sgfFragment = "candidate B[pd]";
    const out = buildCandidateComparisonV1({
      turnIndex: 7,
      playedMove: "C3",
      recommendedMove: "D4",
      scoreLoss: null,
      winrateLoss: null,
      conceptTagsV1: [{ tag: "connection", confidence: "medium", evidence: [sgfFragment], caveats: [] }],
      forbiddenConceptClaims: [{ concept: "invasion", reason: sgfFragment }],
    });

    expect(JSON.stringify(out)).not.toContain("B[pd]");
    expect(out.forbiddenClaims).toEqual([]);
  });
});
