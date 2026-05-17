import { describe, expect, it } from "vitest";
import {
  buildProductReviewWorkbenchV1,
  redactWorkbenchTextV1,
  renderProductReviewWorkbenchMarkdownV1,
  unwrapProductReviewWorkbenchInputV1,
} from "../shared/productReviewWorkbenchV1";

function completedResultFixture() {
  return {
    source: "katago-worker-v1",
    meta: { mock: false },
    game_info: { total_moves: 6, result: "W+3.5", komi: 6.5 },
    analysisPlan: {
      totalMoves: 6,
      boardSize: 19,
      komi: 6.5,
      candidateTurns: [
        { turnIndex: 2, player: "B", playedMove: "dd", reason: "score_drop", priority: 90 },
        { turnIndex: 3, player: "W", playedMove: "qq", reason: "shape", priority: 60 },
        { turnIndex: 6, player: "B", playedMove: "pp", reason: "final_position", priority: 20 },
      ],
    },
    learningEventsV1: {
      version: "learning-events-v1",
      events: [
        {
          id: "le-2",
          turnIndex: 2,
          playedMove: "dd",
          candidateMove: "pq",
          labelKey: "ar_label_high_bsi_candidate",
          eventType: "high_bsi_candidate",
          confidence: "high",
          score: 82,
          signals: {
            bsiScore: 88,
            adiScore: 0.42,
            scoreLeadDelta: -6.2,
            deepSearchCompleted: true,
            deepSearchChangedTop: true,
          },
          evidence: { source: ["learningEventsV1", "bsiV1", "deepSearchResults"], pv: ["pq", "dc"], deepSearchPv: ["pq", "dc", "qp"] },
        },
        {
          id: "le-3",
          turnIndex: 3,
          playedMove: "qq",
          candidateMove: "dp",
          labelKey: "ar_label_response_candidate",
          eventType: "response_candidate",
          confidence: "medium",
          score: 55,
          signals: { adiScore: 0.7 },
          evidence: { source: ["learningEventsV1", "adiV1"], pv: ["dp"] },
        },
        {
          id: "le-6",
          turnIndex: 6,
          playedMove: "pp",
          candidateMove: "cf",
          labelKey: "ar_label_review_candidate",
          eventType: "review_candidate",
          confidence: "low",
          score: 20,
          signals: { bsiScore: 20 },
          evidence: { source: ["learningEventsV1"] },
        },
      ],
    },
    turnAnalyses: [
      {
        status: "ok",
        turnIndex: 2,
        player: "B",
        playedMove: "dd",
        reason: "score_drop",
        priority: 90,
        query: { movesBeforeCount: 1, boardSize: 19, komi: 6.5 },
        katago: { rootInfo: {}, topMove: { pv: ["pq", "dc", "qp"] }, moveInfosCount: 3, hasWinrate: true, hasScoreLead: true, hasOwnership: false },
        comparisonReady: { playedMoveFoundInCandidates: true, playedMoveRank: 3, bestMove: "pq" },
        moveSummary: { best: { move: "pq", winrate: 0.62, scoreLead: 2.1 }, played: { move: "dd", winrate: 0.48, scoreLead: -3.9 } },
        candidateMoves: [{ move: "pq", order: 1, pvLength: 3 }],
      },
      {
        status: "ok",
        turnIndex: 3,
        player: "W",
        playedMove: "qq",
        reason: "shape",
        priority: 60,
        query: { movesBeforeCount: 2, boardSize: 19, komi: 6.5 },
        katago: { rootInfo: {}, topMove: { pv: ["dp"] }, moveInfosCount: 2, hasWinrate: true, hasScoreLead: true, hasOwnership: false },
        comparisonReady: { playedMoveFoundInCandidates: true, playedMoveRank: 2, bestMove: "dp" },
        moveSummary: { best: { move: "dp", winrate: 0.57, scoreLead: 1.2 }, played: { move: "qq", winrate: 0.54, scoreLead: 0.6 } },
      },
      {
        status: "failed",
        turnIndex: 6,
        player: "B",
        playedMove: "pp",
        reason: "final_position",
        priority: 20,
        query: { movesBeforeCount: 5, boardSize: 19, komi: 6.5 },
        error: "final_position",
      },
    ],
    bsiV1: {
      version: "bsi-v1",
      signals: [{ turnIndex: 2, player: "B", playedMove: "dd", bestMove: "pq", bsiScore: 88, scoreBestMinusPlayed: 6.0, winrateBestMinusPlayed: 0.14 }],
    },
    adiV1: {
      version: "adi-v1",
      signals: [
        { turnIndex: 2, player: "B", playedMove: "dd", bestMove: "pq", adiScore: 0.42, deepSearchCandidate: true },
        { turnIndex: 3, player: "W", playedMove: "qq", bestMove: "dp", adiScore: 0.7, deepSearchCandidate: false },
      ],
    },
    deepSearchResults: {
      version: "deep-search-results-v1",
      enabled: true,
      completedCount: 1,
      results: [
        {
          turnIndex: 2,
          player: "B",
          playedMove: "dd",
          plannedBestMove: "pq",
          status: "ok",
          comparison: { plannedBestMoveStillTop: false, deepBestMove: "pq" },
          katago: { topMove: { pv: ["pq", "dc", "qp"] } },
        },
      ],
    },
    winrateTimelineV1: {
      version: "winrate-timeline-v1",
      enabled: true,
      completedCount: 2,
      points: [
        { status: "ok", turnIndex: 1, player: "W", playedMove: "pd", rawWinrate: 0.51 },
        { status: "ok", turnIndex: 2, player: "B", playedMove: "dd", rawWinrate: 0.37 },
      ],
    },
    sgf_content: "(;FF[4]GM[1]SZ[19]KM[6.5]RE[W+3.5];B[pd];W[dd])",
    debugPath: "C:\\KataGo\\katago.exe",
    token: "sk_test_abcdefghijklmnopqrstuvwxyz123456",
  };
}

describe("productReviewWorkbenchV1", () => {
  it("generates a trace report for a valid completed result", () => {
    const report = buildProductReviewWorkbenchV1(completedResultFixture());

    expect(report.status).toBe("ok");
    expect(report.gameSummary.boardSize).toBe(19);
    expect(report.gameSummary.loserColor).toBe("B");
    expect(report.sourceSummary.source).toBe("katago-worker-v1");
    expect(report.learningEventsSummary.some((event) => event.turnIndex === 6 && event.finalPositionExcluded)).toBe(true);
    expect(report.candidatePoolSummary.some((candidate) => candidate.turnIndex === 2 && candidate.deepSearchEvidence)).toBe(true);
  });

  it("includes decisive selected reason and rejected candidate reasons", () => {
    const report = buildProductReviewWorkbenchV1(completedResultFixture());

    expect(report.decisiveMoveTrace.selected?.turnIndex).toBe(2);
    expect(report.decisiveMoveTrace.selectedReason).toContain("positive_score_loss");
    expect(report.decisiveMoveTrace.rejectedCandidates.some((candidate) => candidate.reasons.includes("final_position_excluded"))).toBe(true);
  });

  it("includes review ranking and explanation plan trace", () => {
    const report = buildProductReviewWorkbenchV1(completedResultFixture());

    expect(report.reviewMovesTrace.selected.some((move) => move.turnIndex === 3 && move.rankingScore > 0)).toBe(true);
    expect(report.explanationPlanTrace.some((plan) => plan.targetType === "decisive_move" && plan.referenceLinePvLength > 0)).toBe(true);
    expect(report.uiSummary.every((row) => row.tryPlayImpact === "none")).toBe(true);
  });

  it("safely skips mock or unknown results", () => {
    expect(buildProductReviewWorkbenchV1({ source: "mock", meta: { mock: true } }).status).toBe("unsupported");
    expect(buildProductReviewWorkbenchV1({ source: "katago-worker-v1", meta: { mock: true } }).unsupportedReason).toBe("mock_result_unsupported");
    expect(buildProductReviewWorkbenchV1({ source: "katago-worker-v1", isMock: true }).unsupportedReason).toBe("mock_result_unsupported");
  });

  it("unwraps GET analyze response wrappers", () => {
    const inner = completedResultFixture();
    const wrapper = { status: "completed", data: inner, meta: { requestId: "req-1" } };

    expect(unwrapProductReviewWorkbenchInputV1(wrapper)).toBe(inner);
    expect(buildProductReviewWorkbenchV1(wrapper).status).toBe("ok");
    expect(buildProductReviewWorkbenchV1(inner).status).toBe("ok");
  });

  it("redacts SGF-like payloads, secrets, and path-like strings from rendered output", () => {
    const rendered = renderProductReviewWorkbenchMarkdownV1(buildProductReviewWorkbenchV1(completedResultFixture()));
    const redacted = redactWorkbenchTextV1(
      `${rendered}\n(;FF[4]GM[1];B[pd])\n(;GM[1]SZ[19];B[pd];W[dd])\n(;B[pd];W[dd])\nC:\\KataGo\\katago.exe\nsk_live_abcdefghijklmnopqrstuvwxyz123456`
    );

    expect(redacted).not.toContain("B[pd]");
    expect(redacted).not.toContain("W[dd]");
    expect(redacted).not.toContain("GM[1]");
    expect(redacted).not.toContain("C:\\KataGo\\katago.exe");
    expect(redacted).not.toContain("sk_live_abcdefghijklmnopqrstuvwxyz123456");
    expect(redacted).toContain("[REDACTED_SGF]");
    expect(redacted).toContain("[REDACTED_PATH]");
    expect(redacted).toContain("[REDACTED_SECRET]");
  });

  it("does not emit forbidden labels", () => {
    const rendered = renderProductReviewWorkbenchMarkdownV1(buildProductReviewWorkbenchV1(completedResultFixture()));
    const forbiddenLabels = [
      ["패착", " ", "확정"].join(""),
      ["완착", " ", "확정"].join(""),
      ["악", "수"].join(""),
      ["정", "답"].join(""),
      ["best", " ", "move"].join(""),
      ["blun", "der"].join(""),
    ];
    for (const forbidden of forbiddenLabels) {
      expect(rendered.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
