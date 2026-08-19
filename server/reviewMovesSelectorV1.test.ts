import { describe, expect, it } from "vitest";
import { buildProductReviewMovesV1 } from "@shared/reviewMovesSelectorV1";
import { isProductReviewMoveV1, type ProductDecisiveMoveV1, type ProductGameResultV1 } from "@shared/analysisProductEventsV1";

const gameResult: ProductGameResultV1 = {
  winnerColor: "B",
  loserColor: "W",
  resultType: "points",
  margin: 2.5,
  rawResult: "B+2.5",
};

const decisiveMove: ProductDecisiveMoveV1 = {
  turnIndex: 10,
  player: "W",
  playedMove: "P10",
  recommendedMove: "R10",
  scoreLoss: 5,
  winrateLoss: null,
  confidence: "medium",
  sourceEventId: "decisive-10",
  evidence: { source: ["turnAnalyses"] },
};

function turn(turnIndex: number, player: "B" | "W", opts: Partial<Record<string, unknown>> = {}) {
  const playedMove = typeof opts.playedMove === "string" ? opts.playedMove : `P${turnIndex}`;
  const bestMove = typeof opts.bestMove === "string" ? opts.bestMove : `R${turnIndex}`;
  return {
    status: "ok",
    turnIndex,
    player,
    playedMove,
    reason: opts.reason ?? "interval_sample",
    priority: 0.5,
    query: { movesBeforeCount: turnIndex - 1, boardSize: 19, komi: 6.5 },
    katago: {
      rootInfo: {},
      topMove: { move: bestMove, pv: [bestMove] },
      moveInfosCount: 4,
      hasWinrate: true,
      hasScoreLead: true,
      hasOwnership: false,
    },
    comparisonReady: { playedMoveFoundInCandidates: true, playedMoveRank: 2, bestMove },
    lossPerspective: {
      version: "per-turn-loss-perspective-v1",
      configuredPerspective: "side_to_move",
      playerToMove: player,
      status: "verified",
    },
    moveSummary: {
      played: { move: playedMove, winrate: opts.playedWinrate ?? 0.45, scoreLead: opts.playedScoreLead ?? 0 },
      best: { move: bestMove, winrate: opts.bestWinrate ?? 0.55, scoreLead: opts.bestScoreLead ?? 1 },
    },
    candidateMoves: [{ move: bestMove, order: 1, pvLength: 1, winrate: opts.bestWinrate ?? 0.55 }],
  } as any;
}

function adi(turnIndex: number, player: "B" | "W", adiScore = 0.8) {
  return {
    version: "adi-v1",
    computedFrom: ["multi-turn-katago-analysis-v1", "bsi-v1"],
    candidateCount: 1,
    scoredCount: 1,
    partialCount: 0,
    insufficientCount: 0,
    signals: [{
      turnIndex,
      player,
      playedMove: `P${turnIndex}`,
      bestMove: `R${turnIndex}`,
      status: "scored",
      adiScore,
      deepSearchCandidate: true,
      components: {
        visitEntropy: 0.4,
        rankInstability: 0.2,
        tacticalPvRisk: 0.2,
        ownershipVolatility: null,
        bsiNorm: 0.4,
        rareUserMoveRisk: 0.2,
        availableWeightSum: 1,
      },
      interpretationStatus: "provisional",
    }],
  } as any;
}

function deepSearch(turnIndex: number, player: "B" | "W") {
  return {
    version: "deep-search-results-v1",
    computedFrom: ["deep-search-plan-v1"],
    enabled: true,
    policy: { mode: "sequential", maxCandidates: 2, visits: 800, timeoutMs: 180000 },
    candidateCount: 1,
    attemptedCount: 1,
    completedCount: 1,
    failedCount: 0,
    partialFailure: false,
    allFailed: false,
    results: [{
      turnIndex,
      player,
      playedMove: `P${turnIndex}`,
      plannedBestMove: `R${turnIndex}`,
      status: "ok",
      query: { movesBeforeCount: turnIndex - 1, boardSize: 19, komi: 6.5, maxVisits: 800 },
      katago: { rootInfo: {}, topMove: { move: `D${turnIndex}` }, moveInfosCount: 4, hasWinrate: true, hasScoreLead: true, hasOwnership: false },
      comparison: { deepBestMove: `D${turnIndex}`, plannedBestMove: `R${turnIndex}`, plannedBestMoveStillTop: false, playedMoveRank: 3 },
    }],
  } as any;
}

function timeline(turnIndex: number, player: "B" | "W") {
  return {
    version: "winrate-timeline-v1",
    enabled: true,
    source: "katago-analyzeTurns",
    policy: { mode: "full-mainline-after-each-move", visits: 100, maxTurns: 20, analyzeTurnsCount: 2, timeoutMs: 1000, analysisPVLen: 6, includeFinal: true },
    totalMoves: 20,
    attemptedCount: 2,
    completedCount: 2,
    failedCount: 0,
    partialFailure: false,
    allFailed: false,
    points: [
      {
        turnIndex: turnIndex - 1,
        turnNumber: turnIndex - 1,
        movesBeforeCount: turnIndex - 1,
        player: player === "B" ? "W" : "B",
        playedMove: `P${turnIndex - 1}`,
        status: "ok",
        rawWinrate: 0.8,
        displayWinrate: 80,
        scoreLead: 5,
        visits: 100,
        currentPlayer: "B",
        perspectiveStatus: "katago_output_only",
      },
      {
        turnIndex,
        turnNumber: turnIndex,
        movesBeforeCount: turnIndex,
        player,
        playedMove: `P${turnIndex}`,
        status: "ok",
        rawWinrate: 0.2,
        displayWinrate: 20,
        scoreLead: -5,
        visits: 100,
        currentPlayer: "W",
        perspectiveStatus: "katago_output_only",
      },
    ],
  } as any;
}

function learningEvent(turnIndex: number, player?: "B" | "W") {
  return {
    id: `learning-${turnIndex}`,
    turnIndex,
    playedMove: `P${turnIndex}`,
    candidateMove: `R${turnIndex}`,
    labelKey: "ar_label_review_candidate",
    eventType: "review_candidate",
    confidence: "medium",
    score: 70,
    signals: { bsiScore: 50, adiScore: 0.5 },
    evidence: { source: ["embedded"], pv: [`R${turnIndex}`] },
    player,
  } as any;
}

describe("review moves selector v1", () => {
  it("excludes final_position and decisiveMove turnIndex", () => {
    const out = buildProductReviewMovesV1({
      gameResult,
      decisiveMove,
      totalMoves: 20,
      turnAnalyses: [
        turn(10, "W", { bestScoreLead: 10, playedScoreLead: 0 }),
        turn(18, "B", { bestScoreLead: 2, playedScoreLead: 0 }),
        turn(20, "W", { reason: "final_position", bestScoreLead: 9, playedScoreLead: 0 }),
      ],
    });
    expect(out.map((m) => m.turnIndex)).toEqual([18]);
  });

  it("deduplicates turnIndex across sources", () => {
    const out = buildProductReviewMovesV1({
      gameResult,
      turnAnalyses: [turn(12, "W", { bestScoreLead: 2, playedScoreLead: 0 })],
      learningEvents: { version: "learning-events-v1", events: [learningEvent(12)] } as any,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.turnIndex).toBe(12);
    expect(out[0]?.evidence.source).toEqual(expect.arrayContaining(["learningEventsV1", "turnAnalyses"]));
  });

  it("limits output to max 5 and does not force 3 items", () => {
    const many = buildProductReviewMovesV1({
      gameResult,
      turnAnalyses: [1, 2, 3, 4, 5, 6, 7].map((n) => turn(n, n % 2 === 0 ? "W" : "B", { bestScoreLead: n + 1, playedScoreLead: 0 })),
    });
    expect(many).toHaveLength(5);

    const few = buildProductReviewMovesV1({
      gameResult,
      turnAnalyses: [turn(12, "W", { bestScoreLead: 2, playedScoreLead: 0 })],
    });
    expect(few).toHaveLength(1);
  });

  it("allows ADI-only review candidates", () => {
    const out = buildProductReviewMovesV1({ gameResult, adi: adi(12, "W") });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ turnIndex: 12, category: "learning_candidate" });
    expect(out[0]?.evidence.source).toContain("adiV1");
    expect(out[0]?.scoreLoss).toBeNull();
    expect(out[0]?.winrateLoss).toBeNull();
    expect(out[0]?.evidence.v25?.taxonomy).toBe("learning_candidate");
    expect(out[0]?.evidence.v25?.evidenceTypes).toContain("learning_context");
  });

  it("allows Deep Search-only review candidates", () => {
    const out = buildProductReviewMovesV1({ gameResult, deepSearchResults: deepSearch(14, "B") });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ turnIndex: 14, category: "deep_search_candidate", recommendedMove: "D14" });
  });

  it("allows timeline-only volatility candidates without setting winrateLoss", () => {
    const out = buildProductReviewMovesV1({ gameResult, winrateTimeline: timeline(16, "W") });
    const volatility = out.find((m) => m.turnIndex === 16);
    expect(volatility).toMatchObject({ category: "volatility_candidate", winrateLoss: null });
    expect(volatility?.evidence.source).toContain("winrateTimelineV1");
    expect(volatility?.evidence.v25?.taxonomy).toBe("volatility_candidate");
    expect(volatility?.evidence.v25?.evidenceTypes).toContain("volatility_context");
  });

  it("includes positive scoreLoss and positive winrateLoss candidates", () => {
    const out = buildProductReviewMovesV1({
      gameResult,
      turnAnalyses: [
        turn(12, "W", { bestScoreLead: 4, playedScoreLead: 0, bestWinrate: 0.5, playedWinrate: 0.5 }),
        turn(14, "B", { bestScoreLead: 0, playedScoreLead: 0, bestWinrate: 0.7, playedWinrate: 0.45 }),
      ],
    });
    expect(out.find((m) => m.turnIndex === 12)?.scoreLoss).toBe(4);
    expect(out.find((m) => m.turnIndex === 14)?.winrateLoss).toBeCloseTo(0.25);
  });

  it("keeps both players when diversity is possible", () => {
    const out = buildProductReviewMovesV1({
      gameResult,
      turnAnalyses: [
        turn(12, "W", { bestScoreLead: 9, playedScoreLead: 0 }),
        turn(14, "W", { bestScoreLead: 8, playedScoreLead: 0 }),
        turn(16, "B", { bestScoreLead: 1, playedScoreLead: 0 }),
      ],
      maxMoves: 2,
    });
    expect(new Set(out.map((m) => m.player))).toEqual(new Set(["B", "W"]));
  });

  it("adds v2.5 ranking and evidence breakdown", () => {
    const out = buildProductReviewMovesV1({
      gameResult,
      turnAnalyses: [turn(12, "W", { bestScoreLead: 4, playedScoreLead: 0, bestWinrate: 0.62, playedWinrate: 0.48 })],
      deepSearchResults: deepSearch(12, "W"),
    });
    const selected = out[0];
    expect(selected?.evidence.v25?.rankingScore).toBeGreaterThan(0);
    expect(selected?.evidence.v25?.evidenceTypes).toEqual(expect.arrayContaining(["loss_evidence", "search_evidence", "deep_search_context"]));
    expect(selected?.evidence.v25?.ranking.scoreLoss).toBeGreaterThan(0);
  });

  it("returns ProductReviewMoveV1-safe outputs", () => {
    const out = buildProductReviewMovesV1({
      gameResult,
      turnAnalyses: [turn(12, "W", { bestScoreLead: 2, playedScoreLead: 0 })],
      deepSearchResults: deepSearch(12, "W"),
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every(isProductReviewMoveV1)).toBe(true);
  });

  it("does not expose forbidden assertive terms", () => {
    const out = buildProductReviewMovesV1({
      gameResult,
      turnAnalyses: [turn(12, "W", { bestScoreLead: 2, playedScoreLead: 0 })],
    });
    const forbidden = new RegExp(
      [
        ["완착", " ", "확정"].join(""),
        ["패착", " ", "확정"].join(""),
        ["악", "수"].join(""),
        ["정", "답"].join(""),
        ["best", " ", "move"].join(""),
        ["blun", "der"].join(""),
      ].join("|"),
      "i"
    );
    expect(JSON.stringify(out)).not.toMatch(forbidden);
  });
});
