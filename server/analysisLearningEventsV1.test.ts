import { describe, expect, it } from "vitest";
import {
  buildAnalysisLearningEventsV1,
  isAnalysisLearningEventsV1,
  normalizeAnalysisLearningEventsV1,
} from "@shared/analysisLearningEventsV1";

const plan = {
  version: "analysis-plan-v1",
  totalMoves: 200,
  boardSize: 19,
  komi: 6.5,
  candidateTurns: [
    { turnIndex: 99, player: "B", move: "pass", gtpMove: "pass", reason: "final_position", priority: 0.1 },
  ],
  strategy: { mode: "light", maxTurns: 20, includeFinalPosition: true, intervalStep: 10, openingTurnCutoff: 30 },
} as any;

function turn(turnIndex: number, playedMove = "Q16", bestMove = "D16") {
  return {
    status: "ok",
    turnIndex,
    player: turnIndex % 2 === 1 ? "B" : "W",
    playedMove,
    reason: turnIndex === 99 ? "final_position" : "interval_sample",
    priority: 0.5,
    query: { movesBeforeCount: turnIndex - 1, boardSize: 19, komi: 6.5 },
    katago: {
      rootInfo: {},
      topMove: { move: bestMove, pv: [bestMove, "C14"] },
      moveInfosCount: 4,
      hasWinrate: true,
      hasScoreLead: true,
      hasOwnership: false,
    },
    comparisonReady: { playedMoveFoundInCandidates: true, playedMoveRank: 2, bestMove },
    lossPerspective: {
      version: "per-turn-loss-perspective-v1",
      configuredPerspective: "side_to_move",
      playerToMove: turnIndex % 2 === 1 ? "B" : "W",
      status: "verified",
    },
    moveSummary: {
      played: { move: playedMove, winrate: 0.45, scoreLead: -1 },
      best: { move: bestMove, winrate: 0.55, scoreLead: 4 },
    },
    candidateMoves: [{ move: bestMove, order: 1, pvLength: 2, winrate: 0.55 }],
  } as any;
}

function bsi(turnIndex: number, bsiScore = 70) {
  return {
    version: "bsi-v1",
    computedFrom: "multi-turn-katago-analysis-v1",
    candidateCount: 1,
    scoredCount: 1,
    insufficientCount: 0,
    signals: [
      {
        turnIndex,
        player: "B",
        playedMove: "Q16",
        bestMove: "D16",
        playedMoveRank: 4,
        scoreMetricUsed: "scoreLead",
        scorePerspective: "player_to_move_assumed",
        winratePerspective: "player_to_move_assumed",
        interpretationStatus: "verified",
        bsiScore,
        status: "scored",
        components: { moveInfosCount: 4 },
      },
    ],
  } as any;
}

function adi(turnIndex: number, adiScore = 0.72) {
  return {
    version: "adi-v1",
    computedFrom: ["multi-turn-katago-analysis-v1", "bsi-v1"],
    candidateCount: 1,
    scoredCount: 1,
    partialCount: 0,
    insufficientCount: 0,
    signals: [
      {
        turnIndex,
        player: "B",
        playedMove: "Q16",
        bestMove: "D16",
        status: "scored",
        adiScore,
        deepSearchCandidate: true,
        components: {
          visitEntropy: 0.4,
          rankInstability: 0.2,
          tacticalPvRisk: 0.3,
          ownershipVolatility: null,
          bsiNorm: 0.4,
          rareUserMoveRisk: 0.1,
          availableWeightSum: 1,
        },
        interpretationStatus: "provisional",
      },
    ],
  } as any;
}

function deepPlan(turnIndex: number) {
  return {
    version: "deep-search-plan-v1",
    computedFrom: ["analysis-plan-v1", "multi-turn-katago-analysis-v1", "bsi-v1", "adi-v1"],
    policy: { mode: "standard", maxCandidates: 3, minAdiScore: 0.5, minBsiScore: 30 },
    candidateCount: 1,
    candidates: [
      {
        turnIndex,
        player: "B",
        playedMove: "Q16",
        bestMove: "D16",
        selectionScore: 0.9,
        selectionBand: "high",
        reasons: ["multi_signal"],
        adiScore: 0.7,
        bsiScore: 60,
        priority: 0.5,
        candidateReason: "interval_sample",
        status: "selected",
      },
    ],
    notSelected: [],
  } as any;
}

function deepResults(turnIndex: number, ok = true) {
  return {
    version: "deep-search-results-v1",
    computedFrom: ["deep-search-plan-v1"],
    enabled: true,
    policy: { mode: "sequential", maxCandidates: 2, visits: 800, timeoutMs: 180000 },
    candidateCount: 1,
    attemptedCount: 1,
    completedCount: ok ? 1 : 0,
    failedCount: ok ? 0 : 1,
    partialFailure: !ok,
    allFailed: !ok,
    results: ok
      ? [
          {
            turnIndex,
            player: "B",
            playedMove: "Q16",
            plannedBestMove: "D16",
            status: "ok",
            query: { movesBeforeCount: turnIndex - 1, boardSize: 19, komi: 6.5, maxVisits: 800 },
            katago: {
              rootInfo: {},
              topMove: { move: "C17", pv: ["C17", "D17"] },
              moveInfosCount: 4,
              hasWinrate: true,
              hasScoreLead: true,
              hasOwnership: false,
            },
            comparison: {
              deepBestMove: "C17",
              plannedBestMove: "D16",
              plannedBestMoveStillTop: false,
              playedMoveRank: 3,
            },
          },
        ]
      : [{ turnIndex, player: "B", playedMove: "Q16", plannedBestMove: "D16", status: "failed", query: {}, error: { code: "x", message: "x" } }],
  } as any;
}

function embeddedEvent(turnIndex: number, score = 50) {
  return {
    id: `embedded-${turnIndex}`,
    turnIndex,
    playedMove: "Q16",
    candidateMove: "D16",
    labelKey: "ar_label_review_candidate",
    eventType: "review_candidate",
    confidence: "medium",
    score,
    signals: { bsiScore: 55, deepSearchSelected: false },
    evidence: { source: ["embedded"] },
  };
}

describe("analysis learning events v1", () => {
  it("selects high BSI, high ADI, and Deep Search plan candidates", () => {
    const out = buildAnalysisLearningEventsV1({
      analysisPlan: plan,
      turnAnalyses: [turn(10), turn(20), turn(30)],
      bsi: bsi(10, 72),
      adi: adi(20, 0.76),
      deepSearchPlan: deepPlan(30),
    });
    expect(out.version).toBe("learning-events-v1");
    expect(out.events.map((e) => e.turnIndex)).toEqual(expect.arrayContaining([10, 20, 30]));
    expect(out.events.find((e) => e.turnIndex === 10)?.signals.bsiScore).toBe(72);
    expect(out.events.find((e) => e.turnIndex === 20)?.signals.adiScore).toBe(0.76);
    expect(out.events.find((e) => e.turnIndex === 30)?.signals.deepSearchSelected).toBe(true);
  });

  it("raises score and confidence when Deep Search ok result exists", () => {
    const withoutDeep = buildAnalysisLearningEventsV1({
      analysisPlan: plan,
      turnAnalyses: [turn(40)],
      deepSearchPlan: deepPlan(40),
      deepSearchResults: deepResults(40, false),
    }).events[0]!;
    const withDeep = buildAnalysisLearningEventsV1({
      analysisPlan: plan,
      turnAnalyses: [turn(40)],
      deepSearchPlan: deepPlan(40),
      deepSearchResults: deepResults(40, true),
    }).events[0]!;
    expect(withDeep.score).toBeGreaterThan(withoutDeep.score);
    expect(withDeep.signals.deepSearchCompleted).toBe(true);
    expect(["medium", "high"]).toContain(withDeep.confidence);
    expect(withDeep.evidence.deepSearchPv).toEqual(["C17", "D17"]);
  });

  it("selects large winrateTimeline and scoreLead shifts", () => {
    const out = buildAnalysisLearningEventsV1({
      analysisPlan: plan,
      winrateTimeline: {
        version: "winrate-timeline-v1",
        enabled: true,
        source: "katago-analyzeTurns",
        policy: {} as any,
        totalMoves: 3,
        attemptedCount: 3,
        completedCount: 3,
        failedCount: 0,
        partialFailure: false,
        allFailed: false,
        points: [
          { turnIndex: 1, turnNumber: 1, movesBeforeCount: 1, player: "B", playedMove: "Q16", status: "ok", rawWinrate: 0.5, displayWinrate: 50, scoreLead: 0, visits: 100, currentPlayer: "B", perspectiveStatus: "katago_output_only" },
          { turnIndex: 2, turnNumber: 2, movesBeforeCount: 2, player: "W", playedMove: "D4", status: "ok", rawWinrate: 0.3, displayWinrate: 30, scoreLead: 7, visits: 100, currentPlayer: "W", perspectiveStatus: "katago_output_only" },
        ],
      } as any,
    });
    expect(out.events[0]?.turnIndex).toBe(2);
    expect(out.events[0]?.signals.winrateDelta).toBe(20);
    expect(out.events[0]?.signals.scoreLeadDelta).toBe(7);
  });

  it("excludes final position, dedupes turnIndex, limits to five, and handles empty input", () => {
    const manyTurns = [turn(1), turn(2), turn(3), turn(4), turn(5), turn(6), turn(99)];
    const out = buildAnalysisLearningEventsV1({
      analysisPlan: plan,
      turnAnalyses: manyTurns,
      bsi: {
        ...bsi(1, 80),
        signals: manyTurns.map((t: any) => ({ ...bsi(t.turnIndex, 80).signals[0], turnIndex: t.turnIndex })),
      } as any,
      adi: adi(1, 0.8),
    });
    expect(out.events).toHaveLength(5);
    expect(new Set(out.events.map((e) => e.turnIndex)).size).toBe(out.events.length);
    expect(out.events.every((e) => e.turnIndex !== 99)).toBe(true);
    expect(buildAnalysisLearningEventsV1({}).events).toEqual([]);
  });

  it("rejects malformed embedded events with invalid scalar fields", () => {
    expect(isAnalysisLearningEventsV1({ version: "learning-events-v1", events: [{ ...embeddedEvent(1), score: "50" }] })).toBe(false);
    expect(isAnalysisLearningEventsV1({ version: "learning-events-v1", events: [{ ...embeddedEvent(Number.NaN) }] })).toBe(false);
    expect(isAnalysisLearningEventsV1({ version: "learning-events-v1", events: [{ ...embeddedEvent(Number.POSITIVE_INFINITY) }] })).toBe(false);
    expect(isAnalysisLearningEventsV1({ version: "learning-events-v1", events: [{ ...embeddedEvent(1), turnIndex: "1" }] })).toBe(false);
    expect(isAnalysisLearningEventsV1({ version: "learning-events-v1", events: [{ ...embeddedEvent(50.9) }] })).toBe(false);
    expect(isAnalysisLearningEventsV1({ version: "learning-events-v1", events: [{ ...embeddedEvent(-1) }] })).toBe(false);
    expect(isAnalysisLearningEventsV1({ version: "learning-events-v1", events: [{ ...embeddedEvent(20.1), score: 80 }, { ...embeddedEvent(20.9), score: 70 }] })).toBe(false);
    expect(isAnalysisLearningEventsV1({ version: "learning-events-v1", events: [{ ...embeddedEvent(1), confidence: "certain" }] })).toBe(false);
    expect(isAnalysisLearningEventsV1({
      version: "learning-events-v1",
      events: [{ ...embeddedEvent(1), eventType: "deep_search_candidate", labelKey: "ar_label_review_candidate" }],
    })).toBe(false);
  });

  it("rejects malformed or unsafe embedded evidence sources and keeps valid embedded events", () => {
    expect(isAnalysisLearningEventsV1({ version: "learning-events-v1", events: [{ ...embeddedEvent(1), evidence: { source: "embedded" } }] })).toBe(false);
    expect(isAnalysisLearningEventsV1({ version: "learning-events-v1", events: [{ ...embeddedEvent(1), evidence: { source: ["best move"] } }] })).toBe(false);
    expect(isAnalysisLearningEventsV1({ version: "learning-events-v1", events: [{ ...embeddedEvent(1), evidence: { source: ["blunder"] } }] })).toBe(false);
    const valid = { version: "learning-events-v1", events: [embeddedEvent(1)] };
    expect(isAnalysisLearningEventsV1(valid)).toBe(true);
    expect(isAnalysisLearningEventsV1({
      version: "learning-events-v1",
      events: [
        {
          ...embeddedEvent(2),
          evidence: {
            source: ["turnAnalyses", "deepSearchPlan", "deepSearchResults", "adiV1", "bsiV1", "winrateTimelineV1", "learningEventsV1", "embedded"],
          },
        },
      ],
    })).toBe(true);
  });

  it("normalizes embedded events by score, dedupe, final position exclusion, and max five", () => {
    const raw = {
      version: "learning-events-v1",
      events: [
        embeddedEvent(1, -10),
        embeddedEvent(2, 170),
        embeddedEvent(2, 60),
        embeddedEvent(3, 30),
        embeddedEvent(4, 40),
        embeddedEvent(5, 50),
        embeddedEvent(6, 20),
        embeddedEvent(99, 100),
      ],
    };
    expect(isAnalysisLearningEventsV1(raw)).toBe(true);
    const normalized = normalizeAnalysisLearningEventsV1(raw, { analysisPlan: plan, turnAnalyses: [turn(99)] });
    expect(normalized.events).toHaveLength(5);
    expect(normalized.events.map((e) => e.turnIndex)).toEqual([2, 5, 4, 3, 6]);
    expect(normalized.events[0]?.score).toBe(100);
    expect(normalized.events.every((e) => e.score >= 0 && e.score <= 100)).toBe(true);
    expect(new Set(normalized.events.map((e) => e.turnIndex)).size).toBe(5);
    expect(normalized.events.every((e) => e.turnIndex !== 99)).toBe(true);
  });
});
