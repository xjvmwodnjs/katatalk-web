import { describe, expect, it } from "vitest";
import type { TurnAnalysisCandidateMoveSummaryV1, TurnAnalysisEntrySuccessV1 } from "@shared/multiTurnKatagoAnalysisV1";
import { adiBandFromScore, computeAdiV1FromTurnAnalysesAndBsi } from "./adiV1";
import { computeBsiV1FromTurnAnalyses } from "./bsiV1";

function mkCandidates(
  rows: Array<Omit<TurnAnalysisCandidateMoveSummaryV1, "order"> & { order?: number }>
): TurnAnalysisCandidateMoveSummaryV1[] {
  return rows.map((r, i) => ({ ...r, order: r.order ?? i + 1 }));
}

function okTurn(args: {
  turnIndex: number;
  playedMove: string;
  bestMove: string;
  playedRank?: number | null;
  playedInCandidates: boolean;
  candidates: TurnAnalysisCandidateMoveSummaryV1[];
  moveSummary: TurnAnalysisEntrySuccessV1["moveSummary"];
}): TurnAnalysisEntrySuccessV1 {
  return {
    status: "ok",
    turnIndex: args.turnIndex,
    player: "B",
    playedMove: args.playedMove,
    reason: "final_position",
    priority: 1,
    query: { movesBeforeCount: args.turnIndex, boardSize: 19, komi: 6.5 },
    katago: {
      rootInfo: {},
      topMove: null,
      moveInfosCount: args.candidates.length,
      hasWinrate: true,
      hasScoreLead: true,
      hasOwnership: false,
    },
    comparisonReady: {
      playedMoveFoundInCandidates: args.playedInCandidates,
      playedMoveRank: args.playedInCandidates ? (args.playedRank ?? null) : null,
      bestMove: args.bestMove,
    },
    moveSummary: args.moveSummary,
    candidateMoves: args.candidates,
  };
}

describe("computeAdiV1FromTurnAnalysesAndBsi", () => {
  it("visits spread evenly → high visitEntropy", () => {
    const cands = mkCandidates(
      ["D16", "Q16", "D4", "Q4"].map((move, i) => ({
        move,
        pvLength: 2,
        visits: 250,
        winrate: 0.52 + i * 0.001,
        scoreLead: 1,
      }))
    );
    const t = okTurn({
      turnIndex: 10,
      playedMove: "Q16",
      bestMove: "D16",
      playedRank: 2,
      playedInCandidates: true,
      candidates: cands,
      moveSummary: {
        best: { move: "D16", scoreLead: 2, winrate: 0.55, visits: 250 },
        played: { move: "Q16", scoreLead: 0, winrate: 0.52, visits: 250 },
      },
    });
    const bsi = computeBsiV1FromTurnAnalyses([t], { engineMaxVisits: 300, multiTurnMaxVisits: 300 });
    const adi = computeAdiV1FromTurnAnalysesAndBsi([t], bsi);
    const s = adi.signals[0]!;
    expect(s.status).toBe("scored");
    expect(s.components.visitEntropy).toBeGreaterThan(0.9);
  });

  it("top1/top2 visits close → high rankInstability", () => {
    const cands = mkCandidates([
      { move: "D16", visits: 500, winrate: 0.501, pvLength: 1, scoreLead: 1 },
      { move: "Q16", visits: 499, winrate: 0.5, pvLength: 1, scoreLead: 0.9 },
      { move: "D4", visits: 10, winrate: 0.48, pvLength: 1, scoreLead: 0 },
    ]);
    const t = okTurn({
      turnIndex: 11,
      playedMove: "D4",
      bestMove: "D16",
      playedRank: 3,
      playedInCandidates: true,
      candidates: cands,
      moveSummary: {
        best: { move: "D16", scoreLead: 1, winrate: 0.501, visits: 500 },
        played: { move: "D4", scoreLead: 0, winrate: 0.48, visits: 10 },
      },
    });
    const bsi = computeBsiV1FromTurnAnalyses([t], {});
    const adi = computeAdiV1FromTurnAnalysesAndBsi([t], bsi);
    expect(adi.signals[0]!.components.rankInstability).toBeGreaterThan(0.85);
  });

  it("long PV → high tacticalPvRisk", () => {
    const cands = mkCandidates([
      { move: "D16", visits: 300, winrate: 0.55, pvLength: 24, scoreLead: 2 },
      { move: "Q16", visits: 200, winrate: 0.52, pvLength: 2, scoreLead: 0 },
      { move: "D4", visits: 50, winrate: 0.5, pvLength: 1, scoreLead: -0.5 },
    ]);
    const t = okTurn({
      turnIndex: 12,
      playedMove: "Q16",
      bestMove: "D16",
      playedRank: 2,
      playedInCandidates: true,
      candidates: cands,
      moveSummary: {
        best: { move: "D16", scoreLead: 2, winrate: 0.55, visits: 300 },
        played: { move: "Q16", scoreLead: 0, winrate: 0.52, visits: 200 },
      },
    });
    const bsi = computeBsiV1FromTurnAnalyses([t], {});
    const adi = computeAdiV1FromTurnAnalysesAndBsi([t], bsi);
    expect(adi.signals[0]!.components.tacticalPvRisk).toBeCloseTo(1, 5);
  });

  it("high bsiScore increases adi via bsiNorm", () => {
    const cands = mkCandidates([
      { move: "D16", visits: 400, winrate: 0.55, pvLength: 2, scoreLead: 4 },
      { move: "Q16", visits: 200, winrate: 0.4, pvLength: 2, scoreLead: -2 },
      { move: "D4", visits: 50, winrate: 0.45, pvLength: 2, scoreLead: 0 },
    ]);
    const tHigh = okTurn({
      turnIndex: 20,
      playedMove: "Q16",
      bestMove: "D16",
      playedRank: 12,
      playedInCandidates: true,
      candidates: cands,
      moveSummary: {
        best: { move: "D16", scoreLead: 4, winrate: 0.55, visits: 400 },
        played: { move: "Q16", scoreLead: -2, winrate: 0.4, visits: 200 },
      },
    });
    const tLow = {
      ...tHigh,
      turnIndex: 21,
      moveSummary: {
        best: { move: "D16", scoreLead: 0.1, winrate: 0.51, visits: 400 },
        played: { move: "Q16", scoreLead: 0.05, winrate: 0.5, visits: 400 },
      },
      comparisonReady: { ...tHigh.comparisonReady, playedMoveRank: 2 },
    };
    const bsiH = computeBsiV1FromTurnAnalyses([tHigh], {});
    const bsiL = computeBsiV1FromTurnAnalyses([tLow], {});
    const adiH = computeAdiV1FromTurnAnalysesAndBsi([tHigh], bsiH);
    const adiL = computeAdiV1FromTurnAnalysesAndBsi([tLow], bsiL);
    expect((adiH.signals[0]!.adiScore ?? 0) > (adiL.signals[0]!.adiScore ?? 0)).toBe(true);
    expect(adiH.signals[0]!.components.bsiNorm).toBeGreaterThan(adiL.signals[0]!.components.bsiNorm ?? 0);
  });

  it("playedMove not in candidates → partial + high rareUserMoveRisk", () => {
    const cands = mkCandidates([
      { move: "D16", visits: 300, winrate: 0.55, pvLength: 2, scoreLead: 1 },
      { move: "Q4", visits: 200, winrate: 0.52, pvLength: 2, scoreLead: 0 },
    ]);
    const t = okTurn({
      turnIndex: 30,
      playedMove: "Z99",
      bestMove: "D16",
      playedInCandidates: false,
      candidates: cands,
      moveSummary: {
        best: { move: "D16", scoreLead: 1, winrate: 0.55, visits: 300 },
        played: null,
      },
    });
    const bsi = computeBsiV1FromTurnAnalyses([t], {});
    const adi = computeAdiV1FromTurnAnalysesAndBsi([t], bsi);
    const s = adi.signals[0]!;
    expect(s.status).toBe("partial");
    expect(s.components.rareUserMoveRisk).toBeGreaterThan(0.85);
  });

  it("ownershipVolatility null → availableWeightSum excludes 0.15 weight", () => {
    const cands = mkCandidates([
      { move: "D16", visits: 200, winrate: 0.55, pvLength: 3, scoreLead: 1 },
      { move: "Q16", visits: 200, winrate: 0.52, pvLength: 3, scoreLead: 0 },
      { move: "D4", visits: 200, winrate: 0.51, pvLength: 3, scoreLead: -0.5 },
    ]);
    const t = okTurn({
      turnIndex: 40,
      playedMove: "Q16",
      bestMove: "D16",
      playedRank: 2,
      playedInCandidates: true,
      candidates: cands,
      moveSummary: {
        best: { move: "D16", scoreLead: 1, winrate: 0.55, visits: 200 },
        played: { move: "Q16", scoreLead: 0, winrate: 0.52, visits: 200 },
      },
    });
    const bsi = computeBsiV1FromTurnAnalyses([t], {});
    const adi = computeAdiV1FromTurnAnalysesAndBsi([t], bsi);
    expect(adi.signals[0]!.components.ownershipVolatility).toBeNull();
    expect(adi.signals[0]!.components.availableWeightSum).toBeCloseTo(0.85, 5);
  });

  it("adiScore is clamped 0–1", () => {
    const cands = mkCandidates([
      { move: "D16", visits: 500, winrate: 0.5, pvLength: 20, scoreLead: 10 },
      { move: "Q16", visits: 499, winrate: 0.4999, pvLength: 20, scoreLead: 9 },
      { move: "D4", visits: 1, winrate: 0.2, pvLength: 20, scoreLead: -5 },
    ]);
    const t = okTurn({
      turnIndex: 50,
      playedMove: "D4",
      bestMove: "D16",
      playedRank: 3,
      playedInCandidates: true,
      candidates: cands,
      moveSummary: {
        best: { move: "D16", scoreLead: 10, winrate: 0.5, visits: 500 },
        played: { move: "D4", scoreLead: -5, winrate: 0.2, visits: 1 },
      },
    });
    const bsi = computeBsiV1FromTurnAnalyses([t], {});
    const adi = computeAdiV1FromTurnAnalysesAndBsi([t], bsi);
    const s = adi.signals[0]!;
    expect(s.adiScore).toBeDefined();
    expect(s.adiScore!).toBeGreaterThanOrEqual(0);
    expect(s.adiScore!).toBeLessThanOrEqual(1);
  });

  it("high-risk mix can reach very_high band", () => {
    const cands = mkCandidates([
      { move: "D16", visits: 500, winrate: 0.5001, pvLength: 20, scoreLead: 5 },
      { move: "Q16", visits: 499, winrate: 0.5, pvLength: 20, scoreLead: 4 },
      { move: "D4", visits: 498, winrate: 0.4999, pvLength: 20, scoreLead: 3 },
      { move: "Q4", visits: 497, winrate: 0.4998, pvLength: 20, scoreLead: 2 },
    ]);
    const t = okTurn({
      turnIndex: 60,
      playedMove: "Q4",
      bestMove: "D16",
      playedRank: 4,
      playedInCandidates: true,
      candidates: cands,
      moveSummary: {
        best: { move: "D16", scoreLead: 5, winrate: 0.55, visits: 500 },
        played: { move: "Q4", scoreLead: -4, winrate: 0.35, visits: 497 },
      },
    });
    const bsi = computeBsiV1FromTurnAnalyses([t], {});
    const adi = computeAdiV1FromTurnAnalysesAndBsi([t], bsi);
    const s = adi.signals[0]!;
    expect(s.adiBand).toBe("very_high");
    expect(adiBandFromScore(s.adiScore!)).toBe("very_high");
    expect(s.deepSearchCandidate).toBe(true);
  });

  it("insufficient_data: <2 candidates → no adiScore", () => {
    const cands = mkCandidates([{ move: "D16", visits: 100, winrate: 0.55, pvLength: 1, scoreLead: 1 }]);
    const t = okTurn({
      turnIndex: 70,
      playedMove: "D16",
      bestMove: "D16",
      playedRank: 1,
      playedInCandidates: true,
      candidates: cands,
      moveSummary: {
        best: { move: "D16", scoreLead: 1, winrate: 0.55, visits: 100 },
        played: { move: "D16", scoreLead: 1, winrate: 0.55, visits: 100 },
      },
    });
    const bsi = computeBsiV1FromTurnAnalyses([t], {});
    const adi = computeAdiV1FromTurnAnalysesAndBsi([t], bsi);
    expect(adi.insufficientCount).toBe(1);
    expect(adi.signals[0]!.status).toBe("insufficient_data");
    expect(adi.signals[0]!.adiScore).toBeUndefined();
  });

  it("missing candidateMoves on ok turn → insufficient_data", () => {
    const t: TurnAnalysisEntrySuccessV1 = {
      status: "ok",
      turnIndex: 80,
      player: "B",
      playedMove: "Q16",
      reason: "final_position",
      priority: 1,
      query: { movesBeforeCount: 79, boardSize: 19, komi: 6.5 },
      katago: {
        rootInfo: {},
        topMove: null,
        moveInfosCount: 3,
        hasWinrate: true,
        hasScoreLead: true,
        hasOwnership: false,
      },
      comparisonReady: {
        playedMoveFoundInCandidates: true,
        playedMoveRank: 2,
        bestMove: "D16",
      },
      moveSummary: {
        best: { move: "D16", scoreLead: 1, winrate: 0.55, visits: 200 },
        played: { move: "Q16", scoreLead: 0, winrate: 0.52, visits: 200 },
      },
    };
    const bsi = computeBsiV1FromTurnAnalyses([t], {});
    const adi = computeAdiV1FromTurnAnalysesAndBsi([t], bsi);
    expect(adi.signals[0]!.status).toBe("insufficient_data");
  });
});

describe("adiBandFromScore", () => {
  it("maps thresholds", () => {
    expect(adiBandFromScore(0)).toBe("low");
    expect(adiBandFromScore(0.24)).toBe("low");
    expect(adiBandFromScore(0.25)).toBe("medium");
    expect(adiBandFromScore(0.5)).toBe("high");
    expect(adiBandFromScore(0.75)).toBe("very_high");
  });
});
