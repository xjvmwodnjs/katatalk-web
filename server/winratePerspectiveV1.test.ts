import { describe, expect, it } from "vitest";
import { buildAnalysisResultViewModel } from "@shared/analysisResultViewModel";
import {
  clampRawWinrate01,
  normalizeWinratePerspectiveV1,
  rawWinrate01ToDisplayPercent,
} from "@shared/winratePerspectiveV1";
import { getAnalysisResultUiStrings, uiTextContainsForbiddenLabel } from "@shared/analysisResultI18n";

describe("winratePerspectiveV1", () => {
  it("clampRawWinrate01 keeps 0~1 and rejects invalid", () => {
    expect(clampRawWinrate01(0.64)).toBe(0.64);
    expect(clampRawWinrate01(1.5)).toBe(1);
    expect(clampRawWinrate01(-0.2)).toBe(0);
    expect(clampRawWinrate01("nope")).toBeNull();
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
    expect(p.evidence.turnIndex).toBe(45);
    expect(p.evidence.currentPlayer).toBe("W");
    expect(p.evidence.playerToMove).toBe("B");
  });

  it("normalizeWinratePerspectiveV1 is unverified without raw winrate", () => {
    const p = normalizeWinratePerspectiveV1({
      rawWinrate: null,
      turnIndex: 1,
    });
    expect(p.normalized.status).toBe("unverified");
    expect(p.normalized.displayWinrate).toBeNull();
    expect(p.normalized.blackWinrate).toBeNull();
    expect(p.normalized.whiteWinrate).toBeNull();
  });

  it("missing currentPlayer/playerToMove does not throw", () => {
    expect(() =>
      normalizeWinratePerspectiveV1({ rawWinrate: 0.5, turnIndex: 2 })
    ).not.toThrow();
    const p = normalizeWinratePerspectiveV1({ rawWinrate: 0.5, turnIndex: 2 });
    expect(p.evidence.currentPlayer).toBeNull();
    expect(p.evidence.playerToMove).toBeNull();
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
  });
});
