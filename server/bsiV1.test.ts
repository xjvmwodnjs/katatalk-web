import { describe, expect, it } from "vitest";
import type { TurnAnalysisEntrySuccessV1, TurnAnalysisEntryV1 } from "@shared/multiTurnKatagoAnalysisV1";
import {
  computeBsiV1FromTurnAnalyses,
  confidenceFromMinVisits,
  severityFromBsiScore,
} from "./bsiV1";

function baseOk(overrides: Partial<TurnAnalysisEntrySuccessV1> = {}): TurnAnalysisEntrySuccessV1 {
  return {
    status: "ok",
    turnIndex: 45,
    player: "B",
    playedMove: "Q16",
    reason: "final_position",
    priority: 1,
    query: { movesBeforeCount: 44, boardSize: 19, komi: 6.5 },
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
      playedMoveRank: 3,
      bestMove: "D16",
    },
    moveSummary: {
      best: { move: "D16", scoreLead: 2, winrate: 0.6, visits: 200 },
      played: { move: "Q16", scoreLead: -1.2, winrate: 0.52, visits: 200 },
    },
    ...overrides,
  };
}

describe("severityFromBsiScore", () => {
  it("maps 0–30 / 30–60 / 60–80 / 80–100", () => {
    expect(severityFromBsiScore(0)).toBe("low");
    expect(severityFromBsiScore(29)).toBe("low");
    expect(severityFromBsiScore(30)).toBe("medium");
    expect(severityFromBsiScore(59)).toBe("medium");
    expect(severityFromBsiScore(60)).toBe("high");
    expect(severityFromBsiScore(79)).toBe("high");
    expect(severityFromBsiScore(80)).toBe("critical");
    expect(severityFromBsiScore(100)).toBe("critical");
  });
});

describe("confidenceFromMinVisits", () => {
  it("low visits → low confidence", () => {
    expect(confidenceFromMinVisits(5).confidence).toBe("low");
  });
  it("medium band", () => {
    expect(confidenceFromMinVisits(50).confidence).toBe("medium");
  });
  it("high band", () => {
    expect(confidenceFromMinVisits(200).confidence).toBe("high");
  });
});

describe("computeBsiV1FromTurnAnalyses", () => {
  it("scored: scoreBestMinusPlayed / winrateBestMinusPlayed + deprecated aliases match", () => {
    const r = computeBsiV1FromTurnAnalyses([baseOk()]);
    expect(r.version).toBe("bsi-v1");
    expect(r.computedFrom).toBe("multi-turn-katago-analysis-v1");
    expect(r.candidateCount).toBe(1);
    expect(r.scoredCount).toBe(1);
    expect(r.insufficientCount).toBe(0);
    const s = r.signals[0]!;
    expect(s.status).toBe("scored");
    expect(s.bestMove).toBe("D16");
    expect(s.playedMoveRank).toBe(3);
    expect(s.scoreBestMinusPlayed).toBeCloseTo(3.2, 5);
    expect(s.winrateBestMinusPlayed).toBeCloseTo(0.08, 5);
    expect(s.scoreDelta).toBeCloseTo(3.2, 5);
    expect(s.winrateDelta).toBeCloseTo(0.08, 5);
    expect(s.bsiScore).toBeGreaterThanOrEqual(0);
    expect(s.bsiScore).toBeLessThanOrEqual(100);
    expect(s.bsiRaw).toBeDefined();
    expect(s.bsiRaw).toBeLessThanOrEqual(1);
    expect(s.severity).toBeDefined();
    expect(s.bsiBand).toBe(s.severity);
    expect(s.confidence).toBeDefined();
    expect(s.visitConfidence).toBeLessThanOrEqual(1);
    expect(s.scoreMetricUsed).toBe("scoreLead");
    expect(s.components.scoreMetricMixed).toBe(false);
    expect(s.scorePerspective).toBe("katago_output");
    expect(s.winratePerspective).toBe("katago_output");
    expect(s.interpretationStatus).toBe("provisional");
    expect(s.components.moveInfosCount).toBe(3);
    expect(s.components.zComposite).toBeDefined();
  });

  it("strong loss reaches bsiScore >= 80 (critical band reachable)", () => {
    const t = baseOk({
      playedMoveRank: 18,
      moveSummary: {
        best: { move: "D16", scoreLead: 12, winrate: 0.92, visits: 400 },
        played: { move: "Q16", scoreLead: -4, winrate: 0.15, visits: 400 },
      },
    });
    const r = computeBsiV1FromTurnAnalyses([t]);
    const s = r.signals[0]!;
    expect(s.bsiScore).toBeGreaterThanOrEqual(80);
    expect(s.severity).toBe("critical");
    expect(s.bsiBand).toBe("critical");
  });

  it("passes engine / multi max visits into components", () => {
    const r = computeBsiV1FromTurnAnalyses([baseOk()], { engineMaxVisits: 200, multiTurnMaxVisits: 120 });
    expect(r.signals[0]!.components.engineMaxVisits).toBe(200);
    expect(r.signals[0]!.components.multiTurnMaxVisits).toBe(120);
  });

  it("played_move_not_in_candidates does not score but keeps components", () => {
    const t = baseOk({
      comparisonReady: {
        playedMoveFoundInCandidates: false,
        playedMoveRank: null,
        bestMove: "D16",
      },
    });
    const r = computeBsiV1FromTurnAnalyses([t]);
    expect(r.scoredCount).toBe(0);
    expect(r.insufficientCount).toBe(1);
    const s = r.signals[0]!;
    expect(s.status).toBe("played_move_not_in_candidates");
    expect(s.bsiScore).toBeUndefined();
    expect(s.components.moveInfosCount).toBe(3);
    expect(s.scoreMetricUsed).toBe("none");
    expect(s.scorePerspective).toBe("unknown");
  });

  it("scoreMetricUsed scoreMean when only scoreMean on both rows", () => {
    const t = baseOk({
      moveSummary: {
        best: { move: "D16", scoreMean: 1.5, winrate: 0.55, visits: 100 },
        played: { move: "Q16", scoreMean: 0.5, winrate: 0.54, visits: 100 },
      },
    });
    const r = computeBsiV1FromTurnAnalyses([t]);
    expect(r.signals[0]!.status).toBe("scored");
    expect(r.signals[0]!.scoreMetricUsed).toBe("scoreMean");
    expect(r.signals[0]!.components.scoreMetricMixed).toBe(false);
    expect(r.signals[0]!.scoreBestMinusPlayed).toBeCloseTo(1, 5);
  });

  it("score-only path when winrate missing", () => {
    const t = baseOk({
      moveSummary: {
        best: { move: "D16", scoreLead: 1, visits: 80 },
        played: { move: "Q16", scoreLead: 0, visits: 80 },
      },
    });
    const r = computeBsiV1FromTurnAnalyses([t]);
    expect(r.signals[0]!.status).toBe("scored");
    expect(r.signals[0]!.winrateBestMinusPlayed).toBeUndefined();
    expect(r.signals[0]!.winrateDelta).toBeUndefined();
    expect(r.signals[0]!.scoreBestMinusPlayed).toBe(1);
  });

  it("insufficient_data when no score and no winrate pair", () => {
    const t = baseOk({
      moveSummary: {
        best: { move: "D16", visits: 10 },
        played: { move: "Q16", visits: 10 },
      },
    });
    const r = computeBsiV1FromTurnAnalyses([t]);
    expect(r.signals[0]!.status).toBe("insufficient_data");
    expect(r.signals[0]!.bsiScore).toBeUndefined();
    expect(r.signals[0]!.scoreMetricUsed).toBe("none");
  });

  it("insufficient_data when moveSummary missing (legacy row)", () => {
    const full = baseOk();
    const { moveSummary: _omit, ...rest } = full;
    void _omit;
    const t: TurnAnalysisEntrySuccessV1 = { ...rest };
    const r = computeBsiV1FromTurnAnalyses([t]);
    expect(r.signals[0]!.status).toBe("insufficient_data");
  });

  it("skips failed turnAnalyses", () => {
    const failed: TurnAnalysisEntryV1 = {
      status: "failed",
      turnIndex: 1,
      player: "B",
      playedMove: "pd",
      reason: "opening_sample",
      priority: 0,
      query: { movesBeforeCount: 0, boardSize: 19, komi: 6.5 },
      error: "x",
    };
    const r = computeBsiV1FromTurnAnalyses([failed, baseOk({ turnIndex: 2 })]);
    expect(r.candidateCount).toBe(1);
    expect(r.signals).toHaveLength(1);
  });

  it("empty turnAnalyses → zero counts", () => {
    const r = computeBsiV1FromTurnAnalyses([]);
    expect(r.candidateCount).toBe(0);
    expect(r.scoredCount).toBe(0);
    expect(r.insufficientCount).toBe(0);
    expect(r.signals).toHaveLength(0);
  });

  it("does not emit NL or top_mistakes fields", () => {
    const r = computeBsiV1FromTurnAnalyses([baseOk()]);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/패착|악수|mistake/i);
    expect(json).not.toMatch(/top_mistakes/);
  });

  it("mixed scoreLead / scoreMean: no scoreBestMinusPlayed; winrate still scored", () => {
    const t = baseOk({
      moveSummary: {
        best: { move: "D16", scoreLead: 3, winrate: 0.7, visits: 200 },
        played: { move: "Q16", scoreMean: 0.5, winrate: 0.5, visits: 200 },
      },
    });
    const r = computeBsiV1FromTurnAnalyses([t]);
    const s = r.signals[0]!;
    expect(s.status).toBe("scored");
    expect(s.scoreMetricUsed).toBe("none");
    expect(s.scoreBestMinusPlayed).toBeUndefined();
    expect(s.scoreDelta).toBeUndefined();
    expect(s.components.scoreMetricMixed).toBe(true);
    expect(s.components.bestScoreMetric).toBe("scoreLead");
    expect(s.components.playedScoreMetric).toBe("scoreMean");
    expect(s.winrateBestMinusPlayed).toBeCloseTo(0.2, 5);
    expect(s.bsiScore).toBeGreaterThanOrEqual(0);
    expect(s.bsiScore).toBeLessThanOrEqual(100);
  });

  it("mixed scoreMean / scoreLead (reverse): no score delta", () => {
    const t = baseOk({
      moveSummary: {
        best: { move: "D16", scoreMean: 2, winrate: 0.6, visits: 150 },
        played: { move: "Q16", scoreLead: 1, winrate: 0.55, visits: 150 },
      },
    });
    const r = computeBsiV1FromTurnAnalyses([t]);
    const s = r.signals[0]!;
    expect(s.scoreMetricUsed).toBe("none");
    expect(s.scoreBestMinusPlayed).toBeUndefined();
    expect(s.scoreDelta).toBeUndefined();
    expect(s.components.scoreMetricMixed).toBe(true);
    expect(s.winrateBestMinusPlayed).toBeDefined();
  });
});
