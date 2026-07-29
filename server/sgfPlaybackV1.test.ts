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

  it("keeps playback aligned with accepted signed and zero-padded root SZ", () => {
    const sgf = "(;FF[4]GM[1]SZ[+009]KM[6.5];B[ee])";
    const extracted = extractMainlineBwMoves(sgf);
    const playback = buildSgfPlaybackStateV1({
      sgfText: sgf,
      selectedTurnIndex: null,
    });
    expect(extracted.boardSizeHint).toBe(9);
    expect(playback.boardSize).toBe(9);
  });

  it("does not let a later mainline or variation SZ override the root board", () => {
    const laterMainline = extractMainlineBwMoves(
      "(;FF[4]GM[1]SZ[19];B[pd];SZ[9];W[dd])"
    );
    expect(laterMainline.boardSizeHint).toBe(19);

    const variation = extractMainlineBwMoves(
      "(;FF[4]GM[1]SZ[13];B[gg](;C[parentheses ) ( stay text]SZ[9];W[ee]);W[ff])"
    );
    expect(variation.boardSizeHint).toBe(13);
    expect(variation.moves.map(move => move.sgfPoint)).toEqual(["gg", "ff"]);
  });

  it("extracts B/W when they follow C on the same node", () => {
    const sgf = "(;C[text]B[pd];W[dd])";
    const { moves } = extractMainlineBwMoves(sgf);
    expect(moves).toEqual([
      { color: "B", sgfPoint: "pd" },
      { color: "W", sgfPoint: "dd" },
    ]);
  });

  it("parses root setup stones and still parses B", () => {
    const sgf = "(;FF[4]GM[1]AB[aa];B[bb])";
    const { moves, initialStones, warnings } = extractMainlineBwMoves(sgf);
    expect(initialStones).toEqual([{ color: "B", sgfPoint: "aa" }]);
    expect(warnings.some((w) => w.code === "setup_stones_applied")).toBe(true);
    expect(moves).toEqual([{ color: "B", sgfPoint: "bb" }]);
  });

  it("applies setup stones at selectedTurnIndex 0 and keeps them at turn 1", () => {
    const sgf = "(;FF[4]GM[1]SZ[19]AB[pd][dd]AW[pp]AE[dd];B[qq])";
    const st0 = buildSgfPlaybackStateV1({ sgfText: sgf, selectedTurnIndex: 0 });
    expect(st0.stones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x: 15, y: 3, color: "B", turnIndex: 0 }),
        expect.objectContaining({ x: 15, y: 15, color: "W", turnIndex: 0 }),
      ])
    );
    expect(st0.stones.find((s) => s.x === 3 && s.y === 3)).toBeUndefined();

    const st1 = buildSgfPlaybackStateV1({ sgfText: sgf, selectedTurnIndex: 1 });
    expect(st1.stones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: "B", turnIndex: 0 }),
        expect.objectContaining({ color: "W", turnIndex: 0 }),
        expect.objectContaining({ x: 16, y: 16, color: "B", turnIndex: 1 }),
      ])
    );
  });

  it("uses PL and first-move color instead of assuming Black by move-count parity", () => {
    const handicapSgf = "(;FF[4]GM[1]SZ[19]HA[2]AB[pd][dp];PL[W];W[qq];B[dd])";
    const extracted = extractMainlineBwMoves(handicapSgf);
    expect(extracted.initialPlayerHint).toBe("W");
    expect(extracted.handicapHint).toBe(2);
    expect(extracted.initialPositionIssueCodes).toEqual([]);

    const atStart = buildSgfPlaybackStateV1({
      sgfText: handicapSgf,
      selectedTurnIndex: 0,
    });
    expect(atStart.currentPlayer).toBe("W");

    const afterWhite = buildSgfPlaybackStateV1({
      sgfText: handicapSgf,
      selectedTurnIndex: 1,
    });
    expect(afterWhite.currentPlayer).toBe("B");

    const whiteFirstWithoutPl = buildSgfPlaybackStateV1({
      sgfText: "(;FF[4]GM[1]SZ[19]AB[pd];W[qq];B[dd])",
      selectedTurnIndex: 0,
    });
    expect(whiteFirstWithoutPl.currentPlayer).toBe("W");

    const duplicatePlFallback = buildSgfPlaybackStateV1({
      sgfText: "(;FF[4]GM[1]SZ[19]PL[B]PL[W];W[qq])",
      selectedTurnIndex: 0,
    });
    expect(duplicatePlFallback.currentPlayer).toBe("W");

    const conflictingPlFallback = buildSgfPlaybackStateV1({
      sgfText: "(;FF[4]GM[1]SZ[19]PL[B];W[qq])",
      selectedTurnIndex: 0,
    });
    expect(conflictingPlFallback.currentPlayer).toBe("W");
  });

  it("records unsupported PL after the first move for strict admission", () => {
    const extracted = extractMainlineBwMoves(
      "(;FF[4]GM[1]SZ[19];B[pd];PL[W];W[dp])"
    );
    expect(extracted.initialPositionIssueCodes).toContain(
      "player_to_play_after_move_unsupported"
    );
  });

  it("uses the later setup color on AB/AW conflict and warns", () => {
    const sgf = "(;FF[4]GM[1]SZ[19]AB[aa]AW[aa];B[bb])";
    const st = buildSgfPlaybackStateV1({ sgfText: sgf, selectedTurnIndex: 0 });
    expect(st.stones).toEqual([expect.objectContaining({ x: 0, y: 0, color: "W", turnIndex: 0 })]);
    expect(st.warnings.some((w) => w.code === "setup_stone_conflict")).toBe(true);
  });

  it("warns when FF or GM is missing but continues parsing Go mainline", () => {
    const noFf = extractMainlineBwMoves("(;GM[1]SZ[19];B[aa])");
    expect(noFf.moves).toHaveLength(1);
    expect(noFf.warnings.some((w) => w.code === "missing_ff_assumed_v4")).toBe(true);

    const noGm = extractMainlineBwMoves("(;FF[4]SZ[19];B[aa])");
    expect(noGm.moves).toHaveLength(1);
    expect(noGm.warnings.some((w) => w.code === "missing_gm_assumed_go")).toBe(true);

    const neither = extractMainlineBwMoves("(;SZ[19];B[aa])");
    expect(neither.moves).toHaveLength(1);
    expect(neither.warnings.some((w) => w.code === "missing_ff_assumed_v4")).toBe(true);
    expect(neither.warnings.some((w) => w.code === "missing_gm_assumed_go")).toBe(true);
  });

  it("does not treat setup and metadata-looking text inside escaped comments as properties", () => {
    const sgf = "(;FF[4]GM[1]C[AB[aa\\] AW[bb\\] GM[2\\] FF[3\\] escaped \\] text];B[cc])";
    const { moves, initialStones, warnings } = extractMainlineBwMoves(sgf);
    expect(moves).toEqual([{ color: "B", sgfPoint: "cc" }]);
    expect(initialStones).toEqual([]);
    expect(warnings.some((w) => w.code === "unsupported_game_type")).toBe(false);
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
