import { describe, expect, it } from "vitest";
import { buildAnalysisResultViewModel } from "@shared/analysisResultViewModel";
import {
  clampRawWinrate01,
  isValidRawWinrateNumber,
  normalizeWinratePerspectiveV1,
  rawWinrate01ToDisplayPercent,
  WINRATE_BLACK_WHITE_CONVERSION_CANDIDATES_V1,
  WINRATE_VERIFIED_PROMOTION_REQUIREMENTS_V1,
} from "@shared/winratePerspectiveV1";
import { WINRATE_AXIS_SYNTHETIC_SAMPLES_V1 } from "./fixtures/winrateAxisSamplesV1";
import {
  getAnalysisResultUiStrings,
  translateWinrateDisplayLabelKey,
  uiTextContainsForbiddenLabel,
} from "@shared/analysisResultI18n";

describe("winratePerspectiveV1", () => {
  it("isValidRawWinrateNumber accepts only finite numbers", () => {
    expect(isValidRawWinrateNumber(0.64)).toBe(true);
    expect(isValidRawWinrateNumber(0)).toBe(true);
    expect(isValidRawWinrateNumber(NaN)).toBe(false);
    expect(isValidRawWinrateNumber(Infinity)).toBe(false);
    expect(isValidRawWinrateNumber(-Infinity)).toBe(false);
    expect(isValidRawWinrateNumber("0.64")).toBe(false);
    expect(isValidRawWinrateNumber(true)).toBe(false);
    expect(isValidRawWinrateNumber(null)).toBe(false);
    expect(isValidRawWinrateNumber(undefined)).toBe(false);
  });

  it("clampRawWinrate01 keeps 0~1 for valid numbers only", () => {
    expect(clampRawWinrate01(0.64)).toBe(0.64);
    expect(clampRawWinrate01(1.5)).toBe(1);
    expect(clampRawWinrate01(-0.2)).toBe(0);
    expect(clampRawWinrate01(0)).toBe(0);
    expect(clampRawWinrate01(1)).toBe(1);
  });

  it("clampRawWinrate01 rejects non-number and non-finite inputs", () => {
    expect(clampRawWinrate01("nope")).toBeNull();
    expect(clampRawWinrate01("0.64")).toBeNull();
    expect(clampRawWinrate01(true)).toBeNull();
    expect(clampRawWinrate01(false)).toBeNull();
    expect(clampRawWinrate01(null)).toBeNull();
    expect(clampRawWinrate01(undefined)).toBeNull();
    expect(clampRawWinrate01(NaN)).toBeNull();
    expect(clampRawWinrate01(Infinity)).toBeNull();
    expect(clampRawWinrate01(-Infinity)).toBeNull();
    expect(clampRawWinrate01({})).toBeNull();
  });

  it("rawWinrate01ToDisplayPercent maps to 0~100", () => {
    expect(rawWinrate01ToDisplayPercent(0.64)).toBe(64);
    expect(rawWinrate01ToDisplayPercent(0)).toBe(0);
    expect(rawWinrate01ToDisplayPercent(1)).toBe(100);
    expect(rawWinrate01ToDisplayPercent(null)).toBeNull();
  });

  it("normalizeWinratePerspectiveV1 uses katago_output_only when raw present", () => {
    const p = normalizeWinratePerspectiveV1({
      rawWinrate: 0.64,
      turnIndex: 45,
      player: "W",
      currentPlayer: "W",
      playerToMove: "B",
    });
    expect(p.normalized.status).toBe("katago_output_only");
    expect(p.normalized.displayWinrate).toBe(64);
    expect(p.normalized.blackWinrate).toBeNull();
    expect(p.normalized.whiteWinrate).toBeNull();
    expect(p.normalized.displayLabelKey).toBe("katagoOutputWinrate");
    expect(p.evidence.turnIndex).toBe(45);
    expect(p.evidence.currentPlayer).toBe("W");
    expect(p.evidence.playerToMove).toBe("B");
  });

  it("normalizeWinratePerspectiveV1 is unverified for invalid raw types", () => {
    for (const raw of [null, undefined, "0.5", true, NaN, Infinity] as const) {
      const p = normalizeWinratePerspectiveV1({ rawWinrate: raw, turnIndex: 1 });
      expect(p.normalized.status).toBe("unverified");
      expect(p.normalized.displayWinrate).toBeNull();
      expect(p.rawWinrate).toBeNull();
      expect(p.normalized.blackWinrate).toBeNull();
      expect(p.normalized.whiteWinrate).toBeNull();
    }
  });

  it("normalizeWinratePerspectiveV1 never emits verified status", () => {
    const valid = normalizeWinratePerspectiveV1({ rawWinrate: 0.5 });
    const invalid = normalizeWinratePerspectiveV1({ rawWinrate: "bad" });
    expect(valid.normalized.status).not.toBe("verified");
    expect(invalid.normalized.status).not.toBe("verified");
  });

  it("missing currentPlayer/playerToMove does not throw", () => {
    expect(() =>
      normalizeWinratePerspectiveV1({ rawWinrate: 0.5, turnIndex: 2 })
    ).not.toThrow();
    const p = normalizeWinratePerspectiveV1({ rawWinrate: 0.5, turnIndex: 2 });
    expect(p.evidence.currentPlayer).toBeNull();
    expect(p.evidence.playerToMove).toBeNull();
  });

  it("WINRATE_VERIFIED_PROMOTION_REQUIREMENTS_V1 is documented and non-empty", () => {
    expect(WINRATE_VERIFIED_PROMOTION_REQUIREMENTS_V1.length).toBeGreaterThan(3);
    expect(WINRATE_VERIFIED_PROMOTION_REQUIREMENTS_V1.join(" ")).toMatch(/verified/i);
    expect(WINRATE_VERIFIED_PROMOTION_REQUIREMENTS_V1.join(" ")).toMatch(/rootInfo/i);
  });

  it("WINRATE_BLACK_WHITE_CONVERSION_CANDIDATES_V1 lists formula options only", () => {
    expect(WINRATE_BLACK_WHITE_CONVERSION_CANDIDATES_V1.length).toBeGreaterThanOrEqual(3);
    expect(WINRATE_BLACK_WHITE_CONVERSION_CANDIDATES_V1.join(" ")).toMatch(/blackWinrate/i);
  });

  it("shape-only synthetic fixtures (no KataGo axis claim) normalize with null B/W", () => {
    for (const sample of WINRATE_AXIS_SYNTHETIC_SAMPLES_V1) {
      expect(sample.shapeOnly).toBe(true);
      expect(sample.checklistSlot).toMatch(/^S[1-5]$/);
      const rootCp = sample.katago.rootInfo.currentPlayer ?? null;
      const p = normalizeWinratePerspectiveV1({
        rawWinrate: sample.playedWinrate,
        turnIndex: sample.turnIndex,
        player: sample.player,
        currentPlayer: rootCp,
        playerToMove: rootCp,
      });
      expect(p.normalized.status).toBe("katago_output_only");
      expect(p.normalized.blackWinrate).toBeNull();
      expect(p.normalized.whiteWinrate).toBeNull();
      expect(p.normalized.status).not.toBe("verified");
      expect(p.evidence.turnIndex).toBe(sample.turnIndex);
      expect(p.evidence.player).toBe(sample.player);
      expect(sample.query.movesBeforeCount).toBe(sample.turnIndex - 1);
    }
  });

  it("translateWinrateDisplayLabelKey resolves katagoOutputWinrate", () => {
    for (const lang of ["ko", "en", "ja", "zh"] as const) {
      const label = translateWinrateDisplayLabelKey("katagoOutputWinrate", lang);
      expect(label.length).toBeGreaterThan(0);
      expect(uiTextContainsForbiddenLabel(label, lang)).toBe(false);
      expect(label).toBe(getAnalysisResultUiStrings(lang).winrateYAxis);
    }
  });

  it("winrate UI strings do not assert black/white fixed winrate", () => {
    for (const lang of ["ko", "en", "ja", "zh"] as const) {
      const t = getAnalysisResultUiStrings(lang);
      expect(uiTextContainsForbiddenLabel(t.winratePerspectiveNote, lang)).toBe(false);
      expect(uiTextContainsForbiddenLabel(t.winrateYAxis, lang)).toBe(false);
      expect(t.winrateYAxis.toLowerCase()).not.toMatch(/black.?winrate|white.?winrate/);
    }
  });
});

describe("buildAnalysisResultViewModel winrate perspective", () => {
  it("attaches perspective on winrateSeries points", () => {
    const vm = buildAnalysisResultViewModel({
      source: "katago-worker-v1",
      ok: true,
      turnAnalyses: [
        {
          status: "ok",
          turnIndex: 10,
          player: "B",
          playedMove: "Q16",
          moveSummary: { played: { move: "Q16", winrate: 0.48 } },
        },
      ],
    });
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    const pt = vm.graph.winrateSeries.find((p) => p.turnIndex === 10);
    expect(pt?.perspective.normalized.blackWinrate).toBeNull();
    expect(pt?.perspective.normalized.whiteWinrate).toBeNull();
    expect(pt?.displayWinrate).toBe(pt?.perspective.normalized.displayWinrate);
    expect(pt?.rawWinrate).toBe(0.48);
    expect(pt?.perspective.normalized.displayLabelKey).toBe("katagoOutputWinrate");
  });
});
