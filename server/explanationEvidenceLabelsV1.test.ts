import { describe, expect, it } from "vitest";
import { mapExplanationEvidenceLabelsV1 } from "@shared/explanationEvidenceLabelsV1";
import type { ExplanationPlanBulletV2 } from "@shared/explanationPlannerV2";

function bullet(type: ExplanationPlanBulletV2["type"], evidence: string[]): ExplanationPlanBulletV2 {
  return { type, textKey: "ep2_text", unit: type === "score_loss" ? "points" : type === "winrate_loss" ? "ratio" : "none", value: type === "score_loss" || type === "winrate_loss" ? 0.1 : null, evidence };
}

describe("explanation evidence labels v1", () => {
  it("maps score_loss evidence to label key", () => {
    expect(mapExplanationEvidenceLabelsV1(bullet("score_loss", ["scoreLoss=3.5"]))).toEqual(["score_loss"]);
  });

  it("maps winrate_loss evidence to label key", () => {
    expect(mapExplanationEvidenceLabelsV1(bullet("winrate_loss", ["winrateLoss=0.12"]))).toEqual(["winrate_loss"]);
  });

  it("maps concept_hint evidence to conservative concept label", () => {
    expect(mapExplanationEvidenceLabelsV1(bullet("concept_hint", ["concept=connection:medium"]))).toEqual(["concept_hint"]);
  });

  it("maps candidate comparison evidence to comparison label", () => {
    expect(mapExplanationEvidenceLabelsV1(bullet("candidate_comparison", ["comparisonType=move_difference", "delta=score_loss:medium"]))).toEqual(["candidate_comparison"]);
  });

  it("does not expose unknown evidence raw strings", () => {
    expect(mapExplanationEvidenceLabelsV1(bullet("caveat", ["adjacency_heuristic_only"]))).toEqual(["additional_evidence"]);
  });

  it("does not expose SGF fragments as evidence labels", () => {
    expect(mapExplanationEvidenceLabelsV1(bullet("caveat", ["B[pd]"]))).toEqual(["additional_evidence"]);
    expect(mapExplanationEvidenceLabelsV1(bullet("caveat", ["(;FF[4]GM[1];B[pd])"]))).toEqual(["additional_evidence"]);
  });

  it("keeps labels free from assertive forbidden terms", () => {
    const labels = [
      mapExplanationEvidenceLabelsV1(bullet("score_loss", ["scoreLoss=3.5"])),
      mapExplanationEvidenceLabelsV1(bullet("winrate_loss", ["winrateLoss=0.12"])),
      mapExplanationEvidenceLabelsV1(bullet("candidate_comparison", ["delta=pv_direction:low"])),
      mapExplanationEvidenceLabelsV1(bullet("caveat", ["unknown_internal_value"])),
    ].flat();
    const forbidden = new RegExp([["패착", " ", "확정"].join(""), ["완착", " ", "확정"].join(""), ["악", "수"].join(""), ["정", "답"].join(""), ["best", " ", "move"].join(""), ["blun", "der"].join("")].join("|"), "i");
    expect(JSON.stringify(labels)).not.toMatch(forbidden);
  });
});
