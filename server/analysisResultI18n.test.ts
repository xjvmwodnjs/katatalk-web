import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("has product review i18n without forbidden verdict words", () => {
    const keys = [
      "productPrefixDecisive",
      "productPrefixReview",
      "productSummaryDecisive",
      "productSummaryTimeline",
      "productSummaryLearning",
      "productSummaryDefault",
      "productBulletScoreLoss",
      "productBulletWinrateLoss",
      "productBulletBsi",
      "productBulletAdi",
      "productBulletDeepSearch",
      "productBulletTimelineContext",
      "productBulletPv",
      "productBulletLearningEvent",
      "productBulletDefault",
    ] as const;
    for (const lang of ["ko", "en", "ja", "zh"] as const) {
      const t = getAnalysisResultUiStrings(lang);
      for (const key of keys) {
        expect(t[key].length).toBeGreaterThan(0);
        expect(uiTextContainsForbiddenLabel(t[key], lang)).toBe(false);
        expect(t[key].toLowerCase()).not.toContain("best move");
        expect(t[key].toLowerCase()).not.toContain("blunder");
      }
    }
  });

  it("keeps product review component text routed through i18n", () => {
    const root = process.cwd();
    const resultView = readFileSync(resolve(root, "client/src/components/AnalysisResultView.tsx"), "utf8");
    const candidateList = readFileSync(resolve(root, "client/src/components/AnalysisCandidateList.tsx"), "utf8");
    for (const text of [
      "패자 관점에서 수치 근거가 확인된 결정적 장면 후보입니다.",
      "승률 흐름 변화가 있어 함께 확인할 학습 장면 후보입니다.",
      "여러 내부 신호가 겹쳐 검토할 만한 학습 장면 후보입니다.",
      "결정론적 분석 근거로 만든 검토 메모입니다.",
      "집 차이 변화 후보",
      "승률 변화 후보",
      "결정",
      "검토",
    ]) {
      expect(resultView).not.toContain(text);
      expect(candidateList).not.toContain(text);
    }
  });
});
