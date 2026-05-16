import { describe, expect, it } from "vitest";
import {
  getAnalysisResultUiStrings,
  mapReasonPhraseForUi,
  translateCandidateLabelKey,
  translateLearningEventChipPrefix,
  translateLearningEventSourceLabel,
  translateSgfPlaybackWarning,
  translateVmWarning,
  uiTextContainsForbiddenLabel,
} from "@shared/analysisResultI18n";
import type { AnalysisLearningEventTypeV1 } from "@shared/analysisLearningEventsV1";

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

  it("checks forbidden lists across locales when lang is specified", () => {
    expect(uiTextContainsForbiddenLabel("悪手", "en")).toBe(true);
    expect(uiTextContainsForbiddenLabel("blunder", "ko")).toBe(true);
  });

  it("keeps PV disclaimer free of verdict words in all UI languages", () => {
    for (const lang of ["ko", "en", "ja", "zh"] as const) {
      const d = getAnalysisResultUiStrings(lang).variationPvDisclaimer;
      expect(d).not.toContain("정답");
      expect(d).not.toContain("正解");
      expect(d.toLowerCase()).not.toContain("correct answer");
      expect(d.toLowerCase()).not.toContain("best move");
    }
  });

  it("has learning-event i18n without forbidden verdict words", () => {
    const eventTypes: AnalysisLearningEventTypeV1[] = [
      "review_candidate",
      "flow_shift_candidate",
      "response_candidate",
      "high_adi_candidate",
      "high_bsi_candidate",
      "deep_search_candidate",
      "winrate_shift_candidate",
      "score_lead_shift_candidate",
    ];
    const labelKeys = [
      "ar_label_flow_shift_candidate",
      "ar_label_response_candidate",
      "ar_label_high_adi_candidate",
      "ar_label_high_bsi_candidate",
      "ar_label_deep_search_candidate",
    ];
    for (const lang of ["ko", "en", "ja", "zh"] as const) {
      const t = getAnalysisResultUiStrings(lang);
      for (const key of labelKeys) {
        expect(uiTextContainsForbiddenLabel(translateCandidateLabelKey(key, lang), lang)).toBe(false);
      }
      for (const type of eventTypes) {
        expect(uiTextContainsForbiddenLabel(translateLearningEventChipPrefix(type, lang), lang)).toBe(false);
      }
      expect(uiTextContainsForbiddenLabel(translateLearningEventSourceLabel("embedded", lang), lang)).toBe(false);
      expect(uiTextContainsForbiddenLabel(translateLearningEventSourceLabel("blunder", lang), lang)).toBe(false);
      expect(translateLearningEventSourceLabel("best move", lang).toLowerCase()).not.toContain("best move");
      expect(uiTextContainsForbiddenLabel(t.analysisMemoLearningEvent, lang)).toBe(false);
      expect(uiTextContainsForbiddenLabel(t.analysisMemoDeepSearchEvidence, lang)).toBe(false);
    }
  });
});
