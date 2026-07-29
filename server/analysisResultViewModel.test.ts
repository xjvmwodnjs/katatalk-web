import { describe, expect, it } from "vitest";
import { buildMockAnalysisReport } from "./mockAnalysisResult";
import { buildAnalysisResultViewModel } from "@shared/analysisResultViewModel";
import { isExplanationPlanV2 } from "@shared/explanationPlannerV2";
import type { DeepSearchPlanV1Result } from "@shared/deepSearchPlanV1";
import type { DeepSearchResultsV1Result } from "@shared/deepSearchResultsV1";
import type { AdiV1Result } from "@shared/adiV1";
import type { BsiV1Result } from "@shared/bsiV1";
import type { TurnAnalysisEntryV1 } from "@shared/multiTurnKatagoAnalysisV1";
import type { AnalysisPlanV1 } from "@shared/analysisPlanV1";

const ALLOWED_LABEL_KEYS = new Set([
  "ar_label_review_candidate",
  "ar_label_followup_candidate",
  "ar_label_large_delta",
  "ar_label_played_vs_candidate_gap",
  "ar_label_flow_shift_candidate",
  "ar_label_response_candidate",
  "ar_label_high_adi_candidate",
  "ar_label_high_bsi_candidate",
  "ar_label_deep_search_candidate",
  "ar_label_decisive_scene_candidate",
  "ar_label_product_review_candidate",
]);

function assertAllowedLabelKeys(vm: { keyMoveCandidates: { labelKey: string }[] }) {
  for (const k of vm.keyMoveCandidates) {
    expect(ALLOWED_LABEL_KEYS.has(k.labelKey)).toBe(true);
  }
}

function baseKatagoResult(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    source: "katago-worker-v1",
    isMock: false,
    game_info: {
      black_player: "B",
      white_player: "W",
      date: "2026-01-01",
      total_moves: 50,
      result: { ko: "", en: "", zh: "", ja: "" },
      komi: 6.5,
    },
    sgf_content: "(;FF[4]GM[1]SZ[19]RE[W+R];B[pd];W[dd])",
    analysisPlan: {
      version: "analysis-plan-v1",
      totalMoves: 50,
      boardSize: 19,
      komi: 6.5,
      candidateTurns: [
        { turnIndex: 10, player: "B", move: "Q16", gtpMove: "Q16", reason: "interval_sample", priority: 0.5 },
        { turnIndex: 50, player: "W", move: "pass", gtpMove: "pass", reason: "final_position", priority: 0.1 },
      ],
      strategy: { mode: "light", maxTurns: 20, includeFinalPosition: true, intervalStep: 10, openingTurnCutoff: 30 },
    } satisfies AnalysisPlanV1,
    turnAnalyses: [
      {
        status: "ok",
        turnIndex: 10,
        player: "B",
        playedMove: "Q16",
        reason: "interval_sample",
        priority: 0.5,
        query: { movesBeforeCount: 9, boardSize: 19, komi: 6.5 },
        katago: {
          rootInfo: { winrate: 0.48 },
          topMove: { move: "D16", winrate: 0.52, pv: ["D16", "C14", "F17"] },
          moveInfosCount: 5,
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
          played: { move: "Q16", winrate: 0.48 },
          best: { move: "D16", winrate: 0.52 },
        },
        candidateMoves: [{ move: "D16", order: 1, pvLength: 3, winrate: 0.52 }],
      },
      {
        status: "ok",
        turnIndex: 20,
        player: "W",
        playedMove: "D4",
        reason: "interval_sample",
        priority: 0.4,
        query: { movesBeforeCount: 19, boardSize: 19, komi: 6.5 },
        katago: {
          rootInfo: { winrate: 0.51 },
          topMove: { move: "Q4", pv: ["Q4", "R4"] },
          moveInfosCount: 4,
          hasWinrate: true,
          hasScoreLead: true,
          hasOwnership: false,
        },
        comparisonReady: { playedMoveFoundInCandidates: true, playedMoveRank: 3, bestMove: "Q4" },
        moveSummary: { played: { move: "D4", winrate: 0.51 }, best: { move: "Q4", winrate: 0.55 } },
      },
    ] as TurnAnalysisEntryV1[],
    multiTurnAnalysis: {
      version: "multi-turn-katago-analysis-v1",
      maxTurnsRequested: 6,
      maxTurnsAnalyzed: 6,
      candidateCount: 2,
      attemptedCount: 2,
      completedCount: 2,
      failedCount: 0,
      allFailed: false,
      partialFailure: false,
    },
    bsiV1: {
      version: "bsi-v1",
      computedFrom: "multi-turn-katago-analysis-v1",
      candidateCount: 2,
      scoredCount: 2,
      insufficientCount: 0,
      signals: [
        {
          turnIndex: 10,
          player: "B",
          playedMove: "Q16",
          bestMove: "D16",
          playedMoveRank: 2,
          scoreMetricUsed: "scoreLead",
          scorePerspective: "katago_output",
          winratePerspective: "katago_output",
          interpretationStatus: "provisional",
          bsiScore: 62,
          status: "scored",
          components: { moveInfosCount: 5, candidateReason: "interval_sample" },
        },
        {
          turnIndex: 20,
          player: "W",
          playedMove: "D4",
          bestMove: "Q4",
          playedMoveRank: 3,
          scoreMetricUsed: "scoreLead",
          scorePerspective: "katago_output",
          winratePerspective: "katago_output",
          interpretationStatus: "provisional",
          bsiScore: 40,
          status: "scored",
          components: { moveInfosCount: 4, candidateReason: "interval_sample" },
        },
      ],
    } satisfies BsiV1Result,
    adiV1: {
      version: "adi-v1",
      computedFrom: ["multi-turn-katago-analysis-v1", "bsi-v1"],
      candidateCount: 2,
      scoredCount: 2,
      partialCount: 0,
      insufficientCount: 0,
      signals: [
        {
          turnIndex: 10,
          player: "B",
          playedMove: "Q16",
          bestMove: "D16",
          status: "scored",
          adiScore: 0.71,
          deepSearchCandidate: true,
          components: {
            visitEntropy: 0.5,
            rankInstability: 0.2,
            tacticalPvRisk: 0.1,
            ownershipVolatility: null,
            bsiNorm: 0.6,
            rareUserMoveRisk: 0.1,
            availableWeightSum: 1,
          },
          interpretationStatus: "provisional",
        },
        {
          turnIndex: 20,
          player: "W",
          playedMove: "D4",
          bestMove: "Q4",
          status: "scored",
          adiScore: 0.45,
          deepSearchCandidate: false,
          components: {
            visitEntropy: 0.3,
            rankInstability: 0.1,
            tacticalPvRisk: 0.1,
            ownershipVolatility: null,
            bsiNorm: 0.4,
            rareUserMoveRisk: 0.1,
            availableWeightSum: 1,
          },
          interpretationStatus: "provisional",
        },
        {
          turnIndex: 50,
          player: "W",
          playedMove: "pass",
          bestMove: null,
          status: "scored",
          adiScore: 0.99,
          deepSearchCandidate: true,
          components: {
            visitEntropy: 0.9,
            rankInstability: 0.9,
            tacticalPvRisk: 0.9,
            ownershipVolatility: null,
            bsiNorm: 0.9,
            rareUserMoveRisk: 0.1,
            availableWeightSum: 1,
          },
          interpretationStatus: "provisional",
        },
      ],
    } satisfies AdiV1Result,
    deepSearchPlan: {
      version: "deep-search-plan-v1",
      computedFrom: ["analysis-plan-v1", "multi-turn-katago-analysis-v1", "bsi-v1", "adi-v1"],
      policy: { mode: "standard", maxCandidates: 3, minAdiScore: 0.5, minBsiScore: 30 },
      candidateCount: 1,
      candidates: [
        {
          turnIndex: 10,
          player: "B",
          playedMove: "Q16",
          bestMove: "D16",
          selectionScore: 0.9,
          selectionBand: "high",
          reasons: ["multi_signal"],
          adiScore: 0.71,
          bsiScore: 62,
          priority: 0.5,
          candidateReason: "interval_sample",
          status: "selected",
        },
      ],
      notSelected: [],
    } satisfies DeepSearchPlanV1Result,
    deepSearchResults: {
      version: "deep-search-results-v1",
      computedFrom: ["deep-search-plan-v1"],
      enabled: false,
      policy: { mode: "sequential", maxCandidates: 2, visits: 800, timeoutMs: 180000 },
      candidateCount: 1,
      attemptedCount: 0,
      completedCount: 0,
      failedCount: 0,
      partialFailure: false,
      allFailed: false,
      results: [],
    } satisfies DeepSearchResultsV1Result,
    top_mistakes: [],
    ...over,
  };
}

function embeddedLearningEvent(turnIndex: number, score = 50): Record<string, unknown> {
  return {
    id: `embedded-${turnIndex}`,
    turnIndex,
    playedMove: "Q16",
    candidateMove: "D16",
    labelKey: "ar_label_review_candidate",
    eventType: "review_candidate",
    confidence: "medium",
    score,
    signals: { bsiScore: 55 },
    evidence: { source: ["embedded"] },
  };
}

describe("buildAnalysisResultViewModel", () => {
  it("maps katago-worker-v1 and prefers product review candidates when available", () => {
    const vm = buildAnalysisResultViewModel(baseKatagoResult());
    expect(vm.kind).toBe("katago-worker-v1");
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    expect(vm.summary.deepSearchEnabled).toBe(false);
    expect(vm.keyMoveCandidates.length).toBeGreaterThanOrEqual(1);
    expect(vm.keyMoveCandidates[0]!.turnIndex).toBe(10);
    expect(vm.learningEvents.events.length).toBeGreaterThanOrEqual(1);
    expect(vm.keyMoveCandidates[0]!.productRole).toBe("decisive");
    expect(vm.keyMoveCandidates[0]!.deepSearchSelected).toBe(false);
    expect(vm.keyMoveCandidates[0]!.deepSearchCompleted).toBe(false);
    expect(vm.productReviewV1?.version).toBe("product-review-v1");
    expect(vm.graph.winrateSeries.some((p) => p.turnIndex === 10)).toBe(true);
    expect(vm.graph.winrateSeries.every((p) => p.displayPerspective === "katago_output")).toBe(true);
    assertAllowedLabelKeys(vm);
    const pv = vm.variationPreview.find((v) => v.turnIndex === 10);
    expect(pv?.source).toBe("multi-turn");
    expect(pv?.pv.length).toBeGreaterThan(0);
  });

  it("surfaces KataGo quality gate warnings in the result header warnings", () => {
    const vm = buildAnalysisResultViewModel(baseKatagoResult({
      qualityGate: {
        ok: true,
        failureCount: 0,
        warningCount: 2,
        issues: [
          { severity: "warn", code: "NO_BSI_SIGNALS", message: "No BSI signals were found." },
          { severity: "warn", code: "NO_ADI_SIGNALS", message: "No ADI signals were found." },
        ],
      },
    }));
    expect(vm.kind).toBe("katago-worker-v1");
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    expect(vm.warnings).toEqual(
      expect.arrayContaining([
        { code: "katago_quality_warning", params: { qualityCode: "NO_BSI_SIGNALS" } },
        { code: "katago_quality_warning", params: { qualityCode: "NO_ADI_SIGNALS" } },
      ])
    );
  });

  it("builds deterministic productReviewV1 with game result, decisive move, review moves, and explanation plans", () => {
    const vm = buildAnalysisResultViewModel(baseKatagoResult());
    expect(vm.kind).toBe("katago-worker-v1");
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    expect(vm.productReviewV1).toMatchObject({
      version: "product-review-v1",
      source: "deterministic-product-events-v1",
      gameResult: { winnerColor: "W", loserColor: "B", resultType: "resign" },
    });
    expect(vm.productReviewV1?.decisiveMove?.turnIndex).toBe(10);
    expect(vm.productReviewV1?.reviewMoves.some((move) => move.turnIndex === 10)).toBe(false);
    expect(vm.productReviewV1?.reviewMoves.length).toBeGreaterThan(0);
    expect(vm.productReviewV1?.explanationPlans.length).toBe(
      (vm.productReviewV1?.decisiveMove ? 1 : 0) + (vm.productReviewV1?.reviewMoves.length ?? 0)
    );
    expect(vm.productReviewV1?.explanationPlansV2.length).toBe(vm.productReviewV1?.explanationPlans.length);
    expect(vm.productReviewV1?.explanationPlansV2.every(isExplanationPlanV2)).toBe(true);
    expect(vm.keyMoveCandidates[0]?.productRole).toBe("decisive");
    expect(vm.keyMoveCandidates[0]?.labelKey).toBe("ar_label_decisive_scene_candidate");
  });

  it("keeps decisiveMove null when game result has no loser color", () => {
    const vm = buildAnalysisResultViewModel(baseKatagoResult({
      sgf_content: "(;FF[4]GM[1]SZ[19]RE[0];B[pd];W[dd])",
    }));
    expect(vm.kind).toBe("katago-worker-v1");
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    expect(vm.productReviewV1?.gameResult).toMatchObject({ winnerColor: null, loserColor: null, resultType: "draw" });
    expect(vm.productReviewV1?.decisiveMove).toBeNull();
    expect(vm.productReviewV1?.reviewMoves.length).toBeGreaterThan(0);
  });

  it("preserves winner and loser semantics for generic RE[B+]", () => {
    const vm = buildAnalysisResultViewModel(
      baseKatagoResult({
        sgf_content: "(;FF[4]GM[1]SZ[19]RE[B+];B[pd];W[dd])",
      })
    );
    expect(vm.kind).toBe("katago-worker-v1");
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    expect(vm.productReviewV1?.gameResult).toMatchObject({
      winnerColor: "B",
      loserColor: "W",
      resultType: "win",
      margin: null,
    });
    expect(vm.productReviewV1?.decisiveMove).not.toBeNull();
  });

  it("falls back to learningEvents UI candidates when product review has no product moves", () => {
    const vm = buildAnalysisResultViewModel(baseKatagoResult({
      sgf_content: "(;FF[4]GM[1]SZ[19];B[pd];W[dd])",
      turnAnalyses: [],
      bsiV1: { ...(baseKatagoResult().bsiV1 as BsiV1Result), signals: [] },
      adiV1: { ...(baseKatagoResult().adiV1 as AdiV1Result), signals: [] },
      deepSearchPlan: { ...(baseKatagoResult().deepSearchPlan as DeepSearchPlanV1Result), candidates: [], candidateCount: 0 },
      deepSearchResults: { ...(baseKatagoResult().deepSearchResults as DeepSearchResultsV1Result), results: [] },
      learningEventsV1: {
        version: "learning-events-v1",
        events: [embeddedLearningEvent(10, 80)],
      },
    }));
    expect(vm.kind).toBe("katago-worker-v1");
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    expect(vm.productReviewV1).toBeNull();
    expect(vm.keyMoveCandidates[0]?.learningEvent?.turnIndex).toBe(10);
    expect(vm.keyMoveCandidates[0]?.productRole).toBeUndefined();
  });

  it("excludes final_position turns from keyMoveCandidates", () => {
    const vm = buildAnalysisResultViewModel(baseKatagoResult());
    expect(vm.kind).toBe("katago-worker-v1");
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    expect(vm.keyMoveCandidates.every((k) => k.turnIndex !== 50)).toBe(true);
  });

  it("falls back to ADI-only when plan has no candidates", () => {
    const r = baseKatagoResult({
      deepSearchPlan: {
        ...((baseKatagoResult().deepSearchPlan as object) as DeepSearchPlanV1Result),
        candidates: [],
        candidateCount: 0,
      },
    });
    const vm = buildAnalysisResultViewModel(r);
    expect(vm.kind).toBe("katago-worker-v1");
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    expect(vm.keyMoveCandidates.length).toBeGreaterThan(0);
    expect(vm.keyMoveCandidates[0]!.turnIndex).not.toBe(50);
    assertAllowedLabelKeys(vm);
  });

  it("falls back to BSI when ADI empty", () => {
    const r = baseKatagoResult({
      deepSearchPlan: { ...(baseKatagoResult().deepSearchPlan as DeepSearchPlanV1Result), candidates: [], candidateCount: 0 },
      adiV1: { ...(baseKatagoResult().adiV1 as AdiV1Result), signals: [] },
    });
    const vm = buildAnalysisResultViewModel(r);
    expect(vm.kind).toBe("katago-worker-v1");
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    expect(vm.keyMoveCandidates.length).toBeGreaterThan(0);
    assertAllowedLabelKeys(vm);
  });

  it("uses deep-search PV when deep ok row exists", () => {
    const r = baseKatagoResult({
      deepSearchResults: {
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
        results: [
          {
            turnIndex: 10,
            player: "B",
            playedMove: "Q16",
            plannedBestMove: "D16",
            status: "ok",
            query: { movesBeforeCount: 9, boardSize: 19, komi: 6.5, maxVisits: 800 },
            katago: {
              rootInfo: {},
              topMove: { move: "D16", pv: ["D16", "X1", "X2"] },
              moveInfosCount: 3,
              hasWinrate: true,
              hasScoreLead: true,
              hasOwnership: false,
            },
            comparison: {
              deepBestMove: "D16",
              plannedBestMove: "D16",
              plannedBestMoveStillTop: true,
              playedMoveRank: 2,
            },
          },
        ],
      } satisfies DeepSearchResultsV1Result,
    });
    const vm = buildAnalysisResultViewModel(r);
    expect(vm.kind).toBe("katago-worker-v1");
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    expect(vm.summary.deepSearchEnabled).toBe(true);
    const row = vm.keyMoveCandidates.find((k) => k.turnIndex === 10);
    expect(row?.deepSearchCompleted).toBe(true);
    const pv = vm.variationPreview.find((v) => v.turnIndex === 10);
    expect(pv?.source).toBe("deep-search");
    expect(pv?.pv).toEqual(["D16", "X1", "X2"]);
  });

  it("mock legacy kind does not expose top_mistakes as key moves", () => {
    const mock = buildMockAnalysisReport({ fileName: "x.sgf", language: "ko" });
    const vm = buildAnalysisResultViewModel(mock);
    expect(vm.kind).toBe("mock-legacy");
    expect(vm.keyMoveCandidates).toEqual([]);
    expect(vm.learningEvents.events).toEqual([]);
    expect(vm.variationPreview).toEqual([]);
    expect(vm.graph.winrateSeries).toEqual([]);
  });

  it("unknown payload is safe", () => {
    const vm = buildAnalysisResultViewModel({ source: "other" });
    expect(vm.kind).toBe("unknown");
    expect(vm.keyMoveCandidates).toEqual([]);
    expect(vm.learningEvents.events).toEqual([]);
  });

  it("minimal katago payload does not throw", () => {
    const vm = buildAnalysisResultViewModel({
      source: "katago-worker-v1",
      game_info: { total_moves: 0, black_player: "", white_player: "", date: "", result: { ko: "" }, komi: 0 },
    });
    expect(vm.kind).toBe("katago-worker-v1");
  });

  it("rejects malformed embedded learningEventsV1 and falls back without crashing", () => {
    const vm = buildAnalysisResultViewModel(baseKatagoResult({
      learningEventsV1: {
        version: "learning-events-v1",
        events: [{ ...embeddedLearningEvent(30), score: "90" }],
      },
    }));
    expect(vm.kind).toBe("katago-worker-v1");
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    expect(vm.learningEvents.events.length).toBeGreaterThan(0);
    expect(vm.learningEvents.events.every((e) => typeof e.score === "number")).toBe(true);
    expect(vm.keyMoveCandidates.length).toBeGreaterThan(0);
  });

  it("rejects fractional embedded turnIndex instead of truncating into final or duplicate turns", () => {
    const vm = buildAnalysisResultViewModel(baseKatagoResult({
      learningEventsV1: {
        version: "learning-events-v1",
        events: [
          embeddedLearningEvent(50.9, 100),
          embeddedLearningEvent(20.1, 90),
          embeddedLearningEvent(20.9, 80),
        ],
      },
    }));
    expect(vm.kind).toBe("katago-worker-v1");
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    expect(vm.learningEvents.events.every((e) => Number.isInteger(e.turnIndex))).toBe(true);
    expect(vm.learningEvents.events.every((e) => e.turnIndex !== 50)).toBe(true);
    expect(vm.learningEvents.events.every((e) => e.evidence.source[0] !== "embedded")).toBe(true);
  });

  it("normalizes valid embedded learningEventsV1 before using them", () => {
    const vm = buildAnalysisResultViewModel(baseKatagoResult({
      learningEventsV1: {
        version: "learning-events-v1",
        events: [
          embeddedLearningEvent(10, 20),
          embeddedLearningEvent(20, 90),
          embeddedLearningEvent(20, 80),
          embeddedLearningEvent(30, 70),
          embeddedLearningEvent(40, 60),
          embeddedLearningEvent(50, 100),
          embeddedLearningEvent(11, 50),
          embeddedLearningEvent(12, 40),
        ],
      },
    }));
    expect(vm.kind).toBe("katago-worker-v1");
    if (vm.kind !== "katago-worker-v1") {
      return;
    }
    expect(vm.learningEvents.events).toHaveLength(5);
    expect(vm.learningEvents.events.map((e) => e.turnIndex)).toEqual([20, 30, 40, 11, 12]);
    expect(new Set(vm.learningEvents.events.map((e) => e.turnIndex)).size).toBe(5);
    expect(vm.learningEvents.events.every((e) => e.turnIndex !== 50)).toBe(true);
    expect(vm.learningEvents.events[0]?.evidence.source).toEqual(["embedded"]);
  });
});
