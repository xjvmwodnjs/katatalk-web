import { describe, expect, it } from "vitest";
import {
  getAnalysisResultUiStrings,
  mapReasonPhraseForUi,
  translateSgfPlaybackWarning,
  translateVmWarning,
  uiTextContainsForbiddenLabel,
} from "@shared/analysisResultI18n";

describe("analysisResultI18n", () => {
  it("provides localized UI strings for each supported language", () => {
    for (const lang of ["ko", "en", "ja", "zh"] as const) {
      const t = getAnalysisResultUiStrings(lang);
      expect(t.summaryTitle.length).toBeGreaterThan(0);
      expect(t.winrateYAxis.toLowerCase()).not.toContain("blunder");
      expect(t.winrateYAxis).not.toContain("흑");
    }
  });

  it("maps signal reason codes without raw snake_case in output", () => {
    expect(mapReasonPhraseForUi("signal_high_adi", "en")).not.toMatch(/signal_high_adi/);
    expect(mapReasonPhraseForUi("played_candidate_rank_gap", "ja")).not.toMatch(/played_candidate_rank_gap/);
  });

  it("translates SGF warning codes", () => {
    const ja = translateSgfPlaybackWarning({ code: "duplicate_move", params: { turnIndex: 2, point: "pd" } }, "ja");
    expect(ja.length).toBeGreaterThan(5);
    expect(ja).toContain("2");
  });

  it("translates VM warning codes", () => {
    expect(translateVmWarning({ code: "mock_demo_disclaimer" }, "zh").length).toBeGreaterThan(10);
  });

  it("detects forbidden verdict words per locale", () => {
    expect(uiTextContainsForbiddenLabel("This looks like a blunder", "en")).toBe(true);
    expect(uiTextContainsForbiddenLabel("reference only", "en")).toBe(false);
    expect(uiTextContainsForbiddenLabel("패착", "ko")).toBe(true);
  });
});
