import { describe, expect, it } from "vitest";
import { buildProductDecisiveMoveV1 } from "@shared/decisiveMoveSelectorV1";
import { isProductDecisiveMoveV1, type ProductGameResultV1 } from "@shared/analysisProductEventsV1";

const blackWin: ProductGameResultV1 = {
  winnerColor: "B",
  loserColor: "W",
  resultType: "points",
  margin: 2.5,
  rawResult: "B+2.5",
};

const drawResult: ProductGameResultV1 = {
  winnerColor: null,
  loserColor: null,
  resultType: "draw",
  margin: null,
  rawResult: "0",
};

function learningEvent(turnIndex: number, opts: Partial<Record<string, unknown>> = {}) {
  return {
    id: `learning-${turnIndex}`,
    turnIndex,
    playedMove: opts.playedMove ?? `P${turnIndex}`,
    candidateMove: opts.candidateMove ?? `R${turnIndex}`,
    labelKey: "ar_label_review_candidate",
    eventType: "review_candidate",
    confidence: "medium",
    score: 50,
    signals: {
      bsiScore: opts.bsiScore ?? null,
      adiScore: opts.adiScore ?? null,
      scoreLeadDelta: opts.scoreLeadDelta ?? null,
      winrateDelta: opts.winrateDelta ?? null,
      deepSearchCompleted: opts.deepSearchCompleted ?? false,
      deepSearchChangedTop: opts.deepSearchChangedTop ?? false,
    },
    evidence: { source: ["embedded"], pv: [`R${turnIndex}`] },
  };
}

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
    moveSummary: {
      played: { move: playedMove, winrate: opts.playedWinrate ?? 0.45, scoreLead: opts.playedScoreLead ?? 0 },
      best: { move: bestMove, winrate: opts.bestWinrate ?? 0.55, scoreLead: opts.bestScoreLead ?? 1 },
    },
    candidateMoves: [{ move: bestMove, order: 1, pvLength: 1, winrate: opts.bestWinrate ?? 0.55 }],
  } as any;
}

function bsi(turnIndex: number, player: "B" | "W", bsiScore: number, scoreLoss?: number, winrateLoss?: number) {
  return {
    version: "bsi-v1",
    computedFrom: "multi-turn-katago-analysis-v1",
    candidateCount: 1,
    scoredCount: 1,
    insufficientCount: 0,
    signals: [{
      turnIndex,
      player,
      playedMove: `P${turnIndex}`,
      bestMove: `R${turnIndex}`,
      playedMoveRank: 3,
      scoreMetricUsed: "scoreLead",
      scorePerspective: "katago_output",
      winratePerspective: "katago_output",
      interpretationStatus: "provisional",
      scoreBestMinusPlayed: scoreLoss,
      winrateBestMinusPlayed: winrateLoss,
      bsiScore,
      status: "scored",
      components: { moveInfosCount: 4 },
    }],
  } as any;
}

function adi(turnIndex: number, player: "B" | "W", adiScore: number) {
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

describe("decisive move selector v1", () => {
  it("returns null when loserColor is absent", () => {
    expect(buildProductDecisiveMoveV1({ gameResult: drawResult })).toBeNull();
    expect(buildProductDecisiveMoveV1({ gameResult: { ...drawResult, resultType: "unknown", rawResult: null } })).toBeNull();
  });

  it("excludes winner moves", () => {
    const result = buildProductDecisiveMoveV1({
      gameResult: blackWin,
      turnAnalyses: [
        turn(10, "B", { bestScoreLead: 20, playedScoreLead: 0 }),
        turn(12, "W", { bestScoreLead: 3, playedScoreLead: 0 }),
      ],
    });
    expect(result?.turnIndex).toBe(12);
    expect(result?.player).toBe("W");
  });

  it("selects the loser move with larger scoreLoss", () => {
    const result = buildProductDecisiveMoveV1({
      gameResult: blackWin,
      turnAnalyses: [
        turn(10, "W", { bestScoreLead: 2, playedScoreLead: 0 }),
        turn(12, "W", { bestScoreLead: 8, playedScoreLead: 0 }),
      ],
    });
    expect(result?.turnIndex).toBe(12);
    expect(result?.scoreLoss).toBe(8);
  });

  it("returns null when the only loser move has zero loss", () => {
    expect(buildProductDecisiveMoveV1({
      gameResult: blackWin,
      turnAnalyses: [
        turn(10, "W", { bestScoreLead: 0, playedScoreLead: 0, bestWinrate: 0.5, playedWinrate: 0.5 }),
      ],
    })).toBeNull();
  });

  it("selects the loser move with larger winrateLoss", () => {
    const result = buildProductDecisiveMoveV1({
      gameResult: blackWin,
      turnAnalyses: [
        turn(10, "W", { bestScoreLead: 0, playedScoreLead: 0, bestWinrate: 0.52, playedWinrate: 0.5 }),
        turn(12, "W", { bestScoreLead: 0, playedScoreLead: 0, bestWinrate: 0.7, playedWinrate: 0.45 }),
      ],
    });
    expect(result?.turnIndex).toBe(12);
    expect(result?.winrateLoss).toBeCloseTo(0.25);
  });

  it("does not select ADI-only loser candidates", () => {
    expect(buildProductDecisiveMoveV1({
      gameResult: blackWin,
      adi: adi(10, "W", 0.95),
    })).toBeNull();
  });

  it("does not select Deep Search-only loser candidates", () => {
    expect(buildProductDecisiveMoveV1({
      gameResult: blackWin,
      deepSearchResults: deepSearch(10, "W"),
    })).toBeNull();
  });

  it("does not select timeline-only candidates or convert raw delta to winrateLoss", () => {
    expect(buildProductDecisiveMoveV1({
      gameResult: blackWin,
      winrateTimeline: timeline(10, "W"),
    })).toBeNull();

    const withLoss = buildProductDecisiveMoveV1({
      gameResult: blackWin,
      turnAnalyses: [turn(10, "W", { bestScoreLead: 3, playedScoreLead: 0, bestWinrate: 0.5, playedWinrate: 0.5 })],
      winrateTimeline: timeline(10, "W"),
    });
    expect(withLoss?.winrateLoss).toBe(0);
    expect(withLoss?.evidence.source).toContain("winrateTimelineV1");
  });

  it("does not use learningEvents winrateDelta as product winrateLoss", () => {
    const result = buildProductDecisiveMoveV1({
      gameResult: blackWin,
      turnAnalyses: [turn(10, "W", { bestScoreLead: 3, playedScoreLead: 0, bestWinrate: 0.5, playedWinrate: 0.5 })],
      learningEvents: { version: "learning-events-v1", events: [learningEvent(10, { winrateDelta: 25 })] } as any,
    });
    expect(result?.winrateLoss).toBe(0);
    expect(result?.evidence.notes?.join(" ")).toContain("winrateDelta is not used");
  });

  it("adds BSI and ADI evidence to the score", () => {
    const result = buildProductDecisiveMoveV1({
      gameResult: blackWin,
      turnAnalyses: [turn(10, "W"), turn(12, "W")],
      bsi: bsi(10, "W", 95),
      adi: adi(10, "W", 0.9),
    });
    expect(result?.turnIndex).toBe(10);
    expect(result?.evidence.source).toEqual(expect.arrayContaining(["bsiV1", "adiV1"]));
  });

  it("uses Deep Search evidence for confidence and source", () => {
    const result = buildProductDecisiveMoveV1({
      gameResult: blackWin,
      turnAnalyses: [turn(10, "W")],
      learningEvents: { version: "learning-events-v1", events: [learningEvent(10, { deepSearchCompleted: true, deepSearchChangedTop: true })] } as any,
      deepSearchResults: deepSearch(10, "W"),
    });
    expect(result?.confidence).not.toBe("low");
    expect(result?.evidence.source).toContain("deepSearchResultsV1");
    expect(result?.recommendedMove).toBe("R10");
  });

  it("excludes final_position candidates", () => {
    const result = buildProductDecisiveMoveV1({
      gameResult: blackWin,
      totalMoves: 20,
      turnAnalyses: [
        turn(18, "W", { bestScoreLead: 2, playedScoreLead: 0 }),
        turn(20, "W", { reason: "final_position", bestScoreLead: 20, playedScoreLead: 0 }),
      ],
    });
    expect(result?.turnIndex).toBe(18);
  });

  it("returns null when no loser candidate remains", () => {
    expect(buildProductDecisiveMoveV1({
      gameResult: blackWin,
      turnAnalyses: [turn(10, "B", { bestScoreLead: 10, playedScoreLead: 0 })],
    })).toBeNull();
  });

  it("uses deterministic tie-breakers", () => {
    const result = buildProductDecisiveMoveV1({
      gameResult: blackWin,
      turnAnalyses: [
        turn(10, "W", { bestScoreLead: 5, playedScoreLead: 0, bestWinrate: 0.55, playedWinrate: 0.45 }),
        turn(12, "W", { bestScoreLead: 5, playedScoreLead: 0, bestWinrate: 0.55, playedWinrate: 0.45 }),
      ],
    });
    expect(result?.turnIndex).toBe(12);
  });

  it("returns a ProductDecisiveMoveV1-safe output", () => {
    const result = buildProductDecisiveMoveV1({
      gameResult: blackWin,
      turnAnalyses: [turn(10, "W", { bestScoreLead: 5, playedScoreLead: 0 })],
    });
    expect(isProductDecisiveMoveV1(result)).toBe(true);
  });

  it("does not expose forbidden assertive terms", () => {
    const result = buildProductDecisiveMoveV1({
      gameResult: blackWin,
      turnAnalyses: [turn(10, "W", { bestScoreLead: 5, playedScoreLead: 0 })],
    });
    expect(JSON.stringify(result)).not.toMatch(/패착 확정|악수|정답|best move|blunder/i);
  });
});
