import { describe, expect, it } from "vitest";
import type { AnalysisPlanV1 } from "@shared/analysisPlanV1";
import type { AdiV1Result, AdiV1Signal } from "@shared/adiV1";
import type { BsiV1Result, BsiV1Signal } from "@shared/bsiV1";
import type { TurnAnalysisEntrySuccessV1, TurnAnalysisEntryV1 } from "@shared/multiTurnKatagoAnalysisV1";
import { computeDeepSearchPlanV1, readDeepSearchPlanPolicyFromEnv, selectionBandFromSelectionScore } from "./deepSearchPlanV1";

function basePlan(turns: AnalysisPlanV1["candidateTurns"]): AnalysisPlanV1 {
  return {
    version: "analysis-plan-v1",
    totalMoves: 100,
    boardSize: 19,
    komi: 6.5,
    candidateTurns: turns,
    strategy: {
      mode: "light",
      maxTurns: 20,
      includeFinalPosition: true,
      intervalStep: 20,
      openingTurnCutoff: 10,
    },
  };
}

function okTurn(turnIndex: number): TurnAnalysisEntrySuccessV1 {
  return {
    status: "ok",
    turnIndex,
    player: "B",
    playedMove: "Q16",
    reason: "interval_sample",
    priority: 1,
    query: { movesBeforeCount: turnIndex - 1, boardSize: 19, komi: 6.5 },
    katago: {
      rootInfo: {},
      topMove: null,
      moveInfosCount: 3,
      hasWinrate: true,
      hasScoreLead: true,
      hasOwnership: false,
    },
    comparisonReady: { playedMoveFoundInCandidates: true, playedMoveRank: 2, bestMove: "D16" },
    moveSummary: {
      best: { move: "D16", scoreLead: 1, winrate: 0.55, visits: 100 },
      played: { move: "Q16", scoreLead: 0, winrate: 0.52, visits: 100 },
    },
    candidateMoves: [
      { move: "D16", order: 1, visits: 100, winrate: 0.55, pvLength: 2 },
      { move: "Q16", order: 2, visits: 100, winrate: 0.52, pvLength: 2 },
    ],
  };
}

function adiSig(
  turnIndex: number,
  args: Partial<AdiV1Signal> & Pick<AdiV1Signal, "adiScore" | "deepSearchCandidate">
): AdiV1Signal {
  return {
    turnIndex,
    player: "B",
    playedMove: "Q16",
    bestMove: "D16",
    status: "scored",
    interpretationStatus: "provisional",
    components: {
      visitEntropy: 0.5,
      rankInstability: 0.5,
      tacticalPvRisk: 0.3,
      ownershipVolatility: null,
      bsiNorm: 0.5,
      rareUserMoveRisk: 0.3,
      availableWeightSum: 0.85,
    },
    ...args,
  } as AdiV1Signal;
}

function bsiSig(turnIndex: number, bsiScore: number): BsiV1Signal {
  return {
    turnIndex,
    player: "B",
    playedMove: "Q16",
    bestMove: "D16",
    playedMoveRank: 2,
    scoreMetricUsed: "scoreLead",
    scorePerspective: "katago_output",
    winratePerspective: "katago_output",
    interpretationStatus: "provisional",
    scoreBestMinusPlayed: 1,
    winrateBestMinusPlayed: 0.03,
    bsiScore,
    severity: "medium",
    bsiBand: "medium",
    confidence: "medium",
    status: "scored",
    components: { moveInfosCount: 3 },
  } as BsiV1Signal;
}

function emptyAdiBsi(): { adi: AdiV1Result; bsi: BsiV1Result } {
  return {
    adi: {
      version: "adi-v1",
      computedFrom: ["multi-turn-katago-analysis-v1", "bsi-v1"],
      candidateCount: 0,
      scoredCount: 0,
      partialCount: 0,
      insufficientCount: 0,
      signals: [],
    },
    bsi: {
      version: "bsi-v1",
      computedFrom: "multi-turn-katago-analysis-v1",
      candidateCount: 0,
      scoredCount: 0,
      insufficientCount: 0,
      signals: [],
    },
  };
}

describe("computeDeepSearchPlanV1", () => {
  it("higher adiScore tends to rank higher after deepSearchCandidate tie", () => {
    const plan = basePlan([
      { turnIndex: 10, player: "B", move: "Q16", gtpMove: "Q16", reason: "interval_sample", priority: 1 },
      { turnIndex: 20, player: "B", move: "Q16", gtpMove: "Q16", reason: "interval_sample", priority: 1 },
    ]);
    const turns: TurnAnalysisEntryV1[] = [okTurn(10), okTurn(20)];
    const bsi: BsiV1Result = {
      ...emptyAdiBsi().bsi,
      candidateCount: 2,
      scoredCount: 2,
      insufficientCount: 0,
      signals: [bsiSig(10, 60), bsiSig(20, 60)],
    };
    const adi: AdiV1Result = {
      ...emptyAdiBsi().adi,
      candidateCount: 2,
      scoredCount: 2,
      partialCount: 0,
      insufficientCount: 0,
      signals: [
        adiSig(10, { adiScore: 0.72, deepSearchCandidate: true }),
        adiSig(20, { adiScore: 0.9, deepSearchCandidate: true }),
      ],
    };
    const r = computeDeepSearchPlanV1({ analysisPlan: plan, turnAnalyses: turns, bsiV1: bsi, adiV1: adi });
    expect(r.candidates[0]!.turnIndex).toBe(20);
    expect(r.candidates[0]!.adiScore).toBeGreaterThan(r.candidates[1]!.adiScore);
  });

  it("higher bsiScore increases selectionScore when both pass thresholds", () => {
    const plan = basePlan([
      { turnIndex: 5, player: "B", move: "Q16", gtpMove: "Q16", reason: "interval_sample", priority: 1 },
      { turnIndex: 6, player: "B", move: "Q16", gtpMove: "Q16", reason: "interval_sample", priority: 1 },
    ]);
    const turns: TurnAnalysisEntryV1[] = [okTurn(5), okTurn(6)];
    const adi: AdiV1Result = {
      ...emptyAdiBsi().adi,
      candidateCount: 2,
      scoredCount: 2,
      partialCount: 0,
      insufficientCount: 0,
      signals: [
        adiSig(5, { adiScore: 0.75, deepSearchCandidate: true }),
        adiSig(6, { adiScore: 0.75, deepSearchCandidate: true }),
      ],
    };
    const bsi: BsiV1Result = {
      ...emptyAdiBsi().bsi,
      candidateCount: 2,
      scoredCount: 2,
      insufficientCount: 0,
      signals: [bsiSig(5, 40), bsiSig(6, 85)],
    };
    const r = computeDeepSearchPlanV1({ analysisPlan: plan, turnAnalyses: turns, bsiV1: bsi, adiV1: adi });
    const s5 = r.candidates.find((c) => c.turnIndex === 5)!.selectionScore;
    const s6 = r.candidates.find((c) => c.turnIndex === 6)!.selectionScore;
    expect(s6).toBeGreaterThan(s5);
  });

  it("deepSearchCandidate=true sorts before false at same adiScore", () => {
    const plan = basePlan([
      { turnIndex: 1, player: "B", move: "aa", gtpMove: "aa", reason: "opening_sample", priority: 0.5 },
      { turnIndex: 2, player: "W", move: "bb", gtpMove: "bb", reason: "opening_sample", priority: 0.5 },
    ]);
    const turns: TurnAnalysisEntryV1[] = [okTurn(1), okTurn(2)];
    const bsi: BsiV1Result = {
      ...emptyAdiBsi().bsi,
      candidateCount: 2,
      scoredCount: 2,
      insufficientCount: 0,
      signals: [bsiSig(1, 50), bsiSig(2, 50)],
    };
    const adi: AdiV1Result = {
      ...emptyAdiBsi().adi,
      candidateCount: 2,
      scoredCount: 2,
      partialCount: 0,
      insufficientCount: 0,
      signals: [
        adiSig(1, { adiScore: 0.8, deepSearchCandidate: false }),
        adiSig(2, { adiScore: 0.8, deepSearchCandidate: true }),
      ],
    };
    const r = computeDeepSearchPlanV1({ analysisPlan: plan, turnAnalyses: turns, bsiV1: bsi, adiV1: adi });
    expect(r.candidates[0]!.turnIndex).toBe(2);
  });

  it("excludes final_position by default", () => {
    const plan = basePlan([
      { turnIndex: 99, player: "B", move: "Q16", gtpMove: "Q16", reason: "final_position", priority: 10 },
    ]);
    const turns: TurnAnalysisEntryV1[] = [okTurn(99)];
    const bsi: BsiV1Result = {
      ...emptyAdiBsi().bsi,
      candidateCount: 1,
      scoredCount: 1,
      insufficientCount: 0,
      signals: [bsiSig(99, 90)],
    };
    const adi: AdiV1Result = {
      ...emptyAdiBsi().adi,
      candidateCount: 1,
      scoredCount: 1,
      partialCount: 0,
      insufficientCount: 0,
      signals: [adiSig(99, { adiScore: 0.95, deepSearchCandidate: true })],
    };
    const r = computeDeepSearchPlanV1({ analysisPlan: plan, turnAnalyses: turns, bsiV1: bsi, adiV1: adi });
    expect(r.candidates).toHaveLength(0);
    expect(r.notSelected.some((n) => n.reason === "excluded_final_position")).toBe(true);
  });

  it("respects maxCandidates from env", () => {
    const turns: TurnAnalysisEntryV1[] = [];
    const planTurns: AnalysisPlanV1["candidateTurns"] = [];
    const adiSigs: AdiV1Signal[] = [];
    const bsiSigs: BsiV1Signal[] = [];
    for (let i = 0; i < 5; i++) {
      const ti = 10 + i;
      planTurns.push({
        turnIndex: ti,
        player: "B",
        move: "Q16",
        gtpMove: "Q16",
        reason: "interval_sample",
        priority: 1,
      });
      turns.push(okTurn(ti));
      adiSigs.push(adiSig(ti, { adiScore: 0.7 + i * 0.01, deepSearchCandidate: true }));
      bsiSigs.push(bsiSig(ti, 50 + i));
    }
    const plan = basePlan(planTurns);
    const adi: AdiV1Result = {
      ...emptyAdiBsi().adi,
      candidateCount: 5,
      scoredCount: 5,
      partialCount: 0,
      insufficientCount: 0,
      signals: adiSigs,
    };
    const bsi: BsiV1Result = {
      ...emptyAdiBsi().bsi,
      candidateCount: 5,
      scoredCount: 5,
      insufficientCount: 0,
      signals: bsiSigs,
    };
    const env = { DEEP_SEARCH_PLAN_MAX_CANDIDATES: "2" } as NodeJS.ProcessEnv;
    const r = computeDeepSearchPlanV1({ analysisPlan: plan, turnAnalyses: turns, bsiV1: bsi, adiV1: adi, env });
    expect(r.candidates.length).toBe(2);
    expect(r.notSelected.filter((n) => n.reason === "not_top_rank").length).toBeGreaterThanOrEqual(1);
  });

  it("excludes below min adi / bsi when scores present", () => {
    const plan = basePlan([
      { turnIndex: 3, player: "B", move: "Q16", gtpMove: "Q16", reason: "interval_sample", priority: 1 },
      { turnIndex: 4, player: "B", move: "Q16", gtpMove: "Q16", reason: "interval_sample", priority: 1 },
    ]);
    const turns: TurnAnalysisEntryV1[] = [okTurn(3), okTurn(4)];
    const adi: AdiV1Result = {
      ...emptyAdiBsi().adi,
      candidateCount: 2,
      scoredCount: 2,
      partialCount: 0,
      insufficientCount: 0,
      signals: [
        adiSig(3, { adiScore: 0.4, deepSearchCandidate: false }),
        adiSig(4, { adiScore: 0.8, deepSearchCandidate: true }),
      ],
    };
    const bsi: BsiV1Result = {
      ...emptyAdiBsi().bsi,
      candidateCount: 2,
      scoredCount: 2,
      insufficientCount: 0,
      signals: [bsiSig(3, 50), bsiSig(4, 50)],
    };
    const env = {
      DEEP_SEARCH_PLAN_MIN_ADI_SCORE: "0.5",
      DEEP_SEARCH_PLAN_MIN_BSI_SCORE: "30",
    } as NodeJS.ProcessEnv;
    const r = computeDeepSearchPlanV1({ analysisPlan: plan, turnAnalyses: turns, bsiV1: bsi, adiV1: adi, env });
    expect(r.candidates.map((c) => c.turnIndex)).toEqual([4]);
    expect(r.notSelected.some((n) => n.turnIndex === 3 && n.reason === "below_min_adi_score")).toBe(true);
    const bsiLowPlan = basePlan([
      { turnIndex: 3, player: "B", move: "Q16", gtpMove: "Q16", reason: "interval_sample", priority: 1 },
      { turnIndex: 4, player: "B", move: "Q16", gtpMove: "Q16", reason: "interval_sample", priority: 1 },
    ]);
    const bsiLow: BsiV1Result = {
      ...emptyAdiBsi().bsi,
      candidateCount: 2,
      scoredCount: 2,
      insufficientCount: 0,
      signals: [bsiSig(3, 50), bsiSig(4, 20)],
    };
    const r2 = computeDeepSearchPlanV1({
      analysisPlan: bsiLowPlan,
      turnAnalyses: turns,
      bsiV1: bsiLow,
      adiV1: adi,
      env,
    });
    expect(r2.notSelected.some((n) => n.turnIndex === 4 && n.reason === "below_min_bsi_score")).toBe(true);
  });

  it("returns empty candidates when nothing qualifies", () => {
    const { adi, bsi } = emptyAdiBsi();
    const plan = basePlan([]);
    const r = computeDeepSearchPlanV1({ analysisPlan: plan, turnAnalyses: [], bsiV1: bsi, adiV1: adi });
    expect(r.candidates).toEqual([]);
    expect(r.candidateCount).toBe(0);
  });

  it("selectionScore is in 0..1", () => {
    const plan = basePlan([
      { turnIndex: 7, player: "B", move: "Q16", gtpMove: "Q16", reason: "interval_sample", priority: 2 },
    ]);
    const turns: TurnAnalysisEntryV1[] = [okTurn(7)];
    const bsi: BsiV1Result = {
      ...emptyAdiBsi().bsi,
      candidateCount: 1,
      scoredCount: 1,
      insufficientCount: 0,
      signals: [bsiSig(7, 100)],
    };
    const adi: AdiV1Result = {
      ...emptyAdiBsi().adi,
      candidateCount: 1,
      scoredCount: 1,
      partialCount: 0,
      insufficientCount: 0,
      signals: [adiSig(7, { adiScore: 1, deepSearchCandidate: true })],
    };
    const r = computeDeepSearchPlanV1({ analysisPlan: plan, turnAnalyses: turns, bsiV1: bsi, adiV1: adi });
    expect(r.candidates[0]!.selectionScore).toBeGreaterThanOrEqual(0);
    expect(r.candidates[0]!.selectionScore).toBeLessThanOrEqual(1);
  });

  it("dedupes duplicate turnIndex in pool", () => {
    const plan = basePlan([
      { turnIndex: 8, player: "B", move: "Q16", gtpMove: "Q16", reason: "interval_sample", priority: 1 },
    ]);
    const turns: TurnAnalysisEntryV1[] = [okTurn(8)];
    const bsi: BsiV1Result = {
      ...emptyAdiBsi().bsi,
      candidateCount: 1,
      scoredCount: 1,
      insufficientCount: 0,
      signals: [bsiSig(8, 55)],
    };
    const adi: AdiV1Result = {
      ...emptyAdiBsi().adi,
      candidateCount: 2,
      scoredCount: 2,
      partialCount: 0,
      insufficientCount: 0,
      signals: [
        adiSig(8, { adiScore: 0.7, deepSearchCandidate: true }),
        adiSig(8, { adiScore: 0.71, deepSearchCandidate: false }),
      ],
    };
    const r = computeDeepSearchPlanV1({ analysisPlan: plan, turnAnalyses: turns, bsiV1: bsi, adiV1: adi });
    expect(r.candidates.filter((c) => c.turnIndex === 8)).toHaveLength(1);
    expect(r.notSelected.some((n) => n.reason === "duplicate_turn_index")).toBe(true);
  });
});

describe("readDeepSearchPlanPolicyFromEnv", () => {
  it("defaults", () => {
    const p = readDeepSearchPlanPolicyFromEnv({});
    expect(p.maxCandidates).toBe(3);
    expect(p.minAdiScore).toBe(0.5);
    expect(p.minBsiScore).toBe(30);
  });
});

describe("selectionBandFromSelectionScore", () => {
  it("thresholds", () => {
    expect(selectionBandFromSelectionScore(0)).toBe("low");
    expect(selectionBandFromSelectionScore(0.49)).toBe("medium");
    expect(selectionBandFromSelectionScore(0.74)).toBe("high");
    expect(selectionBandFromSelectionScore(0.9)).toBe("very_high");
  });
});
