import { describe, expect, it } from "vitest";
import { buildMockAnalysisReport } from "./mockAnalysisResult";
import { buildAnalysisResultViewModel } from "@shared/analysisResultViewModel";
import {
  boardStarPointsV1,
  collectBadukBoardGhostMarkersV1,
} from "@shared/badukBoardViewV1";
import {
  getAnalysisResultUiStrings,
  uiTextContainsForbiddenLabel,
} from "@shared/analysisResultI18n";
import { buildSgfPlaybackStateV1, gtpCoordToBoardXY } from "@shared/sgfPlaybackV1";

const minimalSgf19 = "(;FF[4]GM[1]SZ[19];B[pd];W[dp];B[pp])";

describe("badukBoardViewV1 helpers", () => {
  it("gtpCoordToBoardXY maps GTP to engine x,y (I column skipped)", () => {
    expect(gtpCoordToBoardXY("D4", 19)).toEqual({ x: 3, y: 15 });
    expect(gtpCoordToBoardXY("Q16", 19)).toEqual({ x: 15, y: 3 });
    expect(gtpCoordToBoardXY("pass", 19)).toBeNull();
    expect(gtpCoordToBoardXY("I4", 19)).toBeNull();
  });

  it("boardStarPointsV1 returns points for 9/13/19 without throwing", () => {
    expect(boardStarPointsV1(19).length).toBe(9);
    expect(boardStarPointsV1(13).length).toBeGreaterThan(0);
    expect(boardStarPointsV1(9).length).toBeGreaterThan(0);
    expect(() => boardStarPointsV1(5)).not.toThrow();
  });

  it("collectBadukBoardGhostMarkersV1 skips occupied and pass", () => {
    const state = buildSgfPlaybackStateV1({ sgfText: minimalSgf19, selectedTurnIndex: 3 });
    const occupied = state.stones.map((s) => `${s.x},${s.y}`);
    const ghosts = collectBadukBoardGhostMarkersV1({
      boardSize: 19,
      occupiedKeys: occupied,
      selectedTurnIndex: 3,
      candidates: [
        {
          turnIndex: 3,
          player: "B",
          labelKey: "candidate_review",
          playedMove: "pp",
          bestMove: "C6",
          bsiScore: null,
          adiScore: null,
          deepSearchSelected: false,
          deepSearchCompleted: false,
          reasons: [],
        },
      ],
      variationPreview: [
        {
          turnIndex: 3,
          playedMove: "pp",
          bestMove: "C6",
          pv: ["C6", "D4"],
          source: "multi-turn",
        },
      ],
    });
    expect(ghosts.length).toBeGreaterThan(0);
    expect(ghosts.every((g) => !occupied.includes(`${g.x},${g.y}`))).toBe(true);
  });

  it("board UI strings avoid forbidden decisive labels", () => {
    for (const lang of ["ko", "en", "ja", "zh"] as const) {
      const t = getAnalysisResultUiStrings(lang);
      expect(uiTextContainsForbiddenLabel(t.boardGhostLegend, lang)).toBe(false);
      expect(uiTextContainsForbiddenLabel(t.boardGhostPvLegend, lang)).toBe(false);
      expect(uiTextContainsForbiddenLabel(t.boardViewOnlyNote, lang)).toBe(false);
      expect(uiTextContainsForbiddenLabel(t.boardSnapshotHint, lang)).toBe(false);
    }
  });
});

describe("buildAnalysisResultViewModel board renderer integration", () => {
  it("katago with sgf_content yields active sgfPlayback with stones", () => {
    const vm = buildAnalysisResultViewModel(
      { source: "katago-worker-v1", ok: true, sgf_content: minimalSgf19 },
      { selectedTurnIndex: 2 }
    );
    expect(vm.kind).toBe("katago-worker-v1");
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    expect(vm.sgfPlayback.placeholder).toBe(false);
    if (vm.sgfPlayback.placeholder) {
      return;
    }
    expect(vm.sgfPlayback.stones.length).toBe(2);
    expect(vm.sgfPlayback.lastMove?.gtp).toBeTruthy();
  });

  it("selectedTurnIndex changes stone count on board snapshot", () => {
    const payload = { source: "katago-worker-v1", ok: true, sgf_content: minimalSgf19 };
    const vm1 = buildAnalysisResultViewModel(payload, { selectedTurnIndex: 1 });
    const vm3 = buildAnalysisResultViewModel(payload, { selectedTurnIndex: 3 });
    if (vm1.kind !== "katago-worker-v1" || vm3.kind !== "katago-worker-v1") {
      return;
    }
    if (vm1.sgfPlayback.placeholder || vm3.sgfPlayback.placeholder) {
      return;
    }
    expect(vm1.sgfPlayback.stones.length).toBe(1);
    expect(vm3.sgfPlayback.stones.length).toBe(3);
  });

  it("mock-legacy keeps sgfPlayback placeholder", () => {
    const vm = buildAnalysisResultViewModel(buildMockAnalysisReport({ fileName: "x.sgf", language: "ko" }));
    expect(vm.kind).toBe("mock-legacy");
    expect(vm.sgfPlayback.placeholder).toBe(true);
  });

  it("katago without sgf_content keeps placeholder", () => {
    const vm = buildAnalysisResultViewModel({ source: "katago-worker-v1", ok: true });
    expect(vm.kind).toBe("katago-worker-v1");
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    expect(vm.sgfPlayback.placeholder).toBe(true);
  });
});
