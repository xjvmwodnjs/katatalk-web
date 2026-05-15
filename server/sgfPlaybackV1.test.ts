import { describe, expect, it } from "vitest";
import {
  buildSgfPlaybackStateV1,
  extractMainlineBwMoves,
  gtpCoordToBoardXY,
  indexToGtpColumn,
  readSgfBracketValue,
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

  it("gtpCoordToBoardXY inverts sgfPointToGtp for mainline points", () => {
    expect(gtpCoordToBoardXY("Q16", 19)).toEqual({ x: 15, y: 3 });
    const gtp = sgfPointToGtp("pd", 19);
    expect(gtp).toBeTruthy();
    if (gtp) {
      expect(gtpCoordToBoardXY(gtp, 19)).toEqual({ x: 15, y: 3 });
    }
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

  it("mainline only when variation present and warns", () => {
    const sgf = "(;SZ[19];B[pd](;B[aa];W[bb]);W[dd])";
    const { moves, warnings } = extractMainlineBwMoves(sgf);
    expect(moves.map((m) => m.sgfPoint)).toEqual(["pd", "dd"]);
    const v = warnings.find((w) => w.code === "variation_branch_skipped");
    expect(v?.params?.count).toBe(1);
  });

  it("does not treat ;B[pd] inside comment property as a move", () => {
    const sgf = "(;SZ[19];C[fake;B[pd]here];B[aa];W[bb])";
    const { moves } = extractMainlineBwMoves(sgf);
    expect(moves.map((m) => m.sgfPoint)).toEqual(["aa", "bb"]);
  });

  it("applies SZ after other root properties on same node (boardSizeHint 13)", () => {
    const sgf = "(;FF[4]GM[1]SZ[13];B[aa])";
    const { moves, boardSizeHint } = extractMainlineBwMoves(sgf);
    expect(boardSizeHint).toBe(13);
    expect(moves).toEqual([{ color: "B", sgfPoint: "aa" }]);
  });

  it("extracts B/W when they follow C on the same node", () => {
    const sgf = "(;C[text]B[pd];W[dd])";
    const { moves } = extractMainlineBwMoves(sgf);
    expect(moves).toEqual([
      { color: "B", sgfPoint: "pd" },
      { color: "W", sgfPoint: "dd" },
    ]);
  });

  it("warns setup_markers_ignored when AB is not first property, still parses B", () => {
    const sgf = "(;FF[4]AB[aa];B[bb])";
    const { moves, warnings } = extractMainlineBwMoves(sgf);
    expect(warnings.some((w) => w.code === "setup_markers_ignored")).toBe(true);
    expect(moves).toEqual([{ color: "B", sgfPoint: "bb" }]);
  });

  it("extracts W when it follows N on the same node", () => {
    const sgf = "(;N[name]W[qq])";
    const { moves } = extractMainlineBwMoves(sgf);
    expect(moves).toEqual([{ color: "W", sgfPoint: "qq" }]);
  });

  it("reads escaped closing bracket inside property value", () => {
    const s = "(;SZ[19];C[xx\\]yy];B[cc];W[dd])";
    const open = s.indexOf("C[") + 1;
    const br = readSgfBracketValue(s, open);
    expect(br?.text).toBe("xx]yy");
    const { moves } = extractMainlineBwMoves(s);
    expect(moves.map((m) => m.sgfPoint)).toEqual(["cc", "dd"]);
  });

  it("captures a single surrounded stone (liberty fill)", () => {
    const sgf = "(;SZ[5];W[aa];B[ba];B[ab])";
    const st = buildSgfPlaybackStateV1({ sgfText: sgf, selectedTurnIndex: null });
    expect(st.stones).toHaveLength(2);
    expect(st.stones.every((x) => x.color === "B")).toBe(true);
    expect(st.stones.find((s) => s.x === 0 && s.y === 0)).toBeUndefined();
  });

  it("captures a two-stone connected group", () => {
    const sgf = "(;SZ[5];W[aa];W[ba];B[ab];B[bb];B[ca])";
    const st = buildSgfPlaybackStateV1({ sgfText: sgf, selectedTurnIndex: null });
    expect(st.stones.every((x) => x.color === "B")).toBe(true);
    expect(st.stones.find((s) => s.x === 0 && s.y === 0)).toBeUndefined();
    expect(st.stones.find((s) => s.x === 1 && s.y === 0)).toBeUndefined();
  });

  it("emits suicide_not_fully_handled when group has no liberties after capture phase", () => {
    const sgf = "(;SZ[3];B[ab];B[ba];B[bc];B[cb];W[bb])";
    const st = buildSgfPlaybackStateV1({ sgfText: sgf, selectedTurnIndex: null });
    expect(st.warnings.some((w) => w.code === "suicide_not_fully_handled_v1")).toBe(true);
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
