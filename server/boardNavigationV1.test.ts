import { describe, expect, it } from "vitest";
import { buildMockAnalysisReport } from "./mockAnalysisResult";
import { buildAnalysisResultViewModel } from "@shared/analysisResultViewModel";
import {
  boardNavFirstTurnIndexV1,
  boardNavLastTurnIndexV1,
  boardNavStepTurnIndexV1,
  clampSelectedTurnIndexV1,
  isBoardKeyboardNavigationEnabledV1,
  isBoardKeyboardNavKeyV1,
  nextTurnIndexFromBoardKeyboardV1,
  shouldIgnoreBoardKeyboardNavFocusV1,
  shouldShowBoardTurnNavigationV1,
} from "@shared/boardNavigationV1";
import { getAnalysisResultUiStrings, uiTextContainsForbiddenLabel } from "@shared/analysisResultI18n";

const minimalSgf19 = "(;FF[4]GM[1]SZ[19];B[pd];W[dp];B[pp])";

describe("boardNavigationV1", () => {
  it("clamp keeps selectedTurnIndex within 0..totalMoves", () => {
    expect(clampSelectedTurnIndexV1(-3, 3)).toBe(0);
    expect(clampSelectedTurnIndexV1(99, 3)).toBe(3);
    expect(clampSelectedTurnIndexV1(2, 3)).toBe(2);
  });

  it("first/prev/next/end navigation respects bounds", () => {
    const total = 3;
    expect(boardNavFirstTurnIndexV1()).toBe(0);
    expect(boardNavLastTurnIndexV1(total)).toBe(3);
    expect(boardNavStepTurnIndexV1(0, -1, total)).toBe(0);
    expect(boardNavStepTurnIndexV1(3, 1, total)).toBe(3);
    expect(boardNavStepTurnIndexV1(1, 1, total)).toBe(2);
    expect(boardNavStepTurnIndexV1(2, -1, total)).toBe(1);
  });

  it("shouldShowBoardTurnNavigationV1 is false for mock and placeholder", () => {
    expect(
      shouldShowBoardTurnNavigationV1({ vmKind: "mock-legacy", sgfPlaceholder: true })
    ).toBe(false);
    expect(
      shouldShowBoardTurnNavigationV1({ vmKind: "katago-worker-v1", sgfPlaceholder: true })
    ).toBe(false);
    expect(
      shouldShowBoardTurnNavigationV1({ vmKind: "katago-worker-v1", sgfPlaceholder: false })
    ).toBe(true);
  });

  it("selectedTurnIndex updates sgfPlayback snapshot (slider/step equivalent)", () => {
    const payload = { source: "katago-worker-v1", ok: true, sgf_content: minimalSgf19 };
    const atStart = buildAnalysisResultViewModel(payload, { selectedTurnIndex: boardNavFirstTurnIndexV1() });
    const atEnd = buildAnalysisResultViewModel(payload, {
      selectedTurnIndex: boardNavLastTurnIndexV1(3),
    });
    if (atStart.kind !== "katago-worker-v1" || atEnd.kind !== "katago-worker-v1") {
      return;
    }
    if (atStart.sgfPlayback.placeholder || atEnd.sgfPlayback.placeholder) {
      return;
    }
    expect(atStart.sgfPlayback.stones.length).toBe(0);
    expect(atEnd.sgfPlayback.stones.length).toBe(3);
    expect(atEnd.sgfPlayback.selectedTurnIndex).toBe(3);
  });

  it("mock-legacy keeps placeholder (no real board navigation context)", () => {
    const vm = buildAnalysisResultViewModel(buildMockAnalysisReport({ fileName: "x.sgf", language: "ko" }));
    expect(vm.kind).toBe("mock-legacy");
    expect(
      shouldShowBoardTurnNavigationV1({ vmKind: vm.kind, sgfPlaceholder: vm.sgfPlayback.placeholder })
    ).toBe(false);
  });

  it("navigation UI strings exist for ko/en/ja/zh without forbidden labels", () => {
    for (const lang of ["ko", "en", "ja", "zh"] as const) {
      const t = getAnalysisResultUiStrings(lang);
      expect(t.navFirst.length).toBeGreaterThan(0);
      expect(t.navTurnCounter).toContain("{current}");
      expect(t.navKeyboardHint.length).toBeGreaterThan(0);
      expect(uiTextContainsForbiddenLabel(t.navFirst, lang)).toBe(false);
      expect(uiTextContainsForbiddenLabel(t.navNext, lang)).toBe(false);
      expect(uiTextContainsForbiddenLabel(t.navAriaToolbar, lang)).toBe(false);
      expect(uiTextContainsForbiddenLabel(t.navKeyboardHint, lang)).toBe(false);
    }
  });

  it("keyboard arrows and Home/End map to clamped turn indices", () => {
    const total = 5;
    expect(nextTurnIndexFromBoardKeyboardV1("ArrowLeft", 3, total)).toBe(2);
    expect(nextTurnIndexFromBoardKeyboardV1("ArrowRight", 3, total)).toBe(4);
    expect(nextTurnIndexFromBoardKeyboardV1("Home", 3, total)).toBe(0);
    expect(nextTurnIndexFromBoardKeyboardV1("End", 3, total)).toBe(5);
    expect(nextTurnIndexFromBoardKeyboardV1("ArrowLeft", 0, total)).toBe(0);
    expect(nextTurnIndexFromBoardKeyboardV1("ArrowRight", 5, total)).toBe(5);
  });

  it("isBoardKeyboardNavKeyV1 recognizes navigation keys only", () => {
    expect(isBoardKeyboardNavKeyV1("ArrowLeft")).toBe(true);
    expect(isBoardKeyboardNavKeyV1("End")).toBe(true);
    expect(isBoardKeyboardNavKeyV1("Enter")).toBe(false);
  });

  it("shouldIgnoreBoardKeyboardNavFocusV1 blocks form controls and sliders", () => {
    const mk = (tag: string, role?: string, closestSlider = false) =>
      ({
        tagName: tag.toUpperCase(),
        isContentEditable: false,
        getAttribute: (name: string) => (name === "role" ? (role ?? null) : null),
        closest: (sel: string) =>
          closestSlider && (sel.includes("slider") || sel.includes("data-slot")) ? {} : null,
      }) as unknown as HTMLElement;

    expect(shouldIgnoreBoardKeyboardNavFocusV1(mk("input"))).toBe(true);
    expect(shouldIgnoreBoardKeyboardNavFocusV1(mk("textarea"))).toBe(true);
    expect(shouldIgnoreBoardKeyboardNavFocusV1(mk("select"))).toBe(true);
    expect(shouldIgnoreBoardKeyboardNavFocusV1(mk("button"))).toBe(true);
    expect(shouldIgnoreBoardKeyboardNavFocusV1(mk("span", "slider"))).toBe(true);
    expect(shouldIgnoreBoardKeyboardNavFocusV1(mk("div", undefined, true))).toBe(true);
    expect(shouldIgnoreBoardKeyboardNavFocusV1(mk("div"))).toBe(false);
  });

  it("keyboard navigation disabled when placeholder (same gate as toolbar)", () => {
    expect(
      isBoardKeyboardNavigationEnabledV1({ vmKind: "katago-worker-v1", sgfPlaceholder: true })
    ).toBe(false);
    expect(
      isBoardKeyboardNavigationEnabledV1({ vmKind: "katago-worker-v1", sgfPlaceholder: false })
    ).toBe(true);
  });
});
