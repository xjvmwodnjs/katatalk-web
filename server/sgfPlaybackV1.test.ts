import { describe, expect, it } from "vitest";
import {
  buildSgfPlaybackStateV1,
  extractMainlineBwMoves,
  indexToGtpColumn,
  sgfLetterToCoordIndex,
  sgfPointToGtp,
} from "@shared/sgfPlaybackV1";
import { buildAnalysisResultViewModel } from "@shared/analysisResultViewModel";

describe("sgfPlaybackV1", () => {
  it("parses basic 19x19 mainline", () => {
    const sgf = "(;FF[4]GM[1]SZ[19];B[pd];W[dd];B[pp])";
    const { moves } = extractMainlineBwMoves(sgf);
    expect(moves).toHaveLength(3);
    expect(moves[0]).toEqual({ color: "B", sgfPoint: "pd" });
    const st = buildSgfPlaybackStateV1({ sgfText: sgf, selectedTurnIndex: null });
    expect(st.placeholder).toBe(false);
    expect(st.totalMoves).toBe(3);
    expect(st.stones).toHaveLength(3);
  });

  it("maps SGF aa / dd to 0,0 and 3,3", () => {
    const sgf = "(;SZ[19];B[aa];W[dd])";
    const st = buildSgfPlaybackStateV1({ sgfText: sgf, selectedTurnIndex: 2 });
    const b = st.stones.find((s) => s.color === "B");
    const w = st.stones.find((s) => s.color === "W");
    expect(b).toMatchObject({ x: 0, y: 0, turnIndex: 1 });
    expect(w).toMatchObject({ x: 3, y: 3, turnIndex: 2 });
  });

  it("GTP column skips I", () => {
    expect(indexToGtpColumn(7)).toBe("H");
    expect(indexToGtpColumn(8)).toBe("J");
    expect(sgfPointToGtp("ih", 19)).toBe("J12");
  });

  it("respects selectedTurnIndex for stone count", () => {
    const sgf = "(;SZ[19];B[pd];W[dd];B[pp])";
    const st1 = buildSgfPlaybackStateV1({ sgfText: sgf, selectedTurnIndex: 1 });
    expect(st1.stones).toHaveLength(1);
    const st2 = buildSgfPlaybackStateV1({ sgfText: sgf, selectedTurnIndex: 2 });
    expect(st2.stones).toHaveLength(2);
  });

  it("treats empty B[] / W[] as pass", () => {
    const sgf = "(;SZ[19];B[pd];W[];B[pp])";
    const st = buildSgfPlaybackStateV1({ sgfText: sgf, selectedTurnIndex: null });
    expect(st.stones).toHaveLength(2);
    expect(st.lastMove?.gtp).toBeTruthy();
  });

  it("emits duplicate move warning and does not overwrite", () => {
    const sgf = "(;SZ[19];B[pd];W[pd])";
    const st = buildSgfPlaybackStateV1({ sgfText: sgf, selectedTurnIndex: null });
    expect(st.stones).toHaveLength(1);
    expect(st.warnings.some((w) => w.code === "duplicate_move")).toBe(true);
  });

  it("clamps selectedTurnIndex beyond mainline", () => {
    const sgf = "(;SZ[19];B[aa];W[bb])";
    const st = buildSgfPlaybackStateV1({ sgfText: sgf, selectedTurnIndex: 99 });
    expect(st.selectedTurnIndex).toBe(2);
    expect(st.warnings.some((w) => w.code === "selected_turn_clamped_high")).toBe(true);
  });

  it("mainline only when variation present", () => {
    const sgf = "(;SZ[19];B[pd](;B[aa];W[bb]);W[dd])";
    const { moves } = extractMainlineBwMoves(sgf);
    expect(moves.map((m) => m.sgfPoint)).toEqual(["pd", "dd"]);
  });

  it("ViewModel keeps placeholder when sgf_content missing", () => {
    const vm = buildAnalysisResultViewModel({ source: "katago-worker-v1", ok: true });
    expect(vm.kind).toBe("katago-worker-v1");
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    expect(vm.sgfPlayback.placeholder).toBe(true);
  });

  it("ViewModel includes active sgfPlayback when sgf_content present", () => {
    const sgf = "(;SZ[19];B[pd];W[dd])";
    const vm = buildAnalysisResultViewModel(
      { source: "katago-worker-v1", ok: true, sgf_content: sgf },
      { selectedTurnIndex: 1 }
    );
    expect(vm.kind).toBe("katago-worker-v1");
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    expect(vm.sgfPlayback.placeholder).toBe(false);
    if (vm.sgfPlayback.placeholder) {
      return;
    }
    expect(vm.sgfPlayback.stones).toHaveLength(1);
    expect(vm.sgfPlayback.selectedTurnIndex).toBe(1);
  });

  it("invalid coord letter yields null index", () => {
    expect(sgfLetterToCoordIndex("!", 19)).toBeNull();
  });
});
