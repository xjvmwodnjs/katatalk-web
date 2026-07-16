import { describe, expect, it } from "vitest";
import {
  assertKatagoResultQualityForCompletion,
  evaluateKatagoResultQuality,
} from "./katagoResultQualityGate";

function validResult(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ok: true,
    source: "katago-worker-v1",
    isMock: false,
    engine: {
      name: "katago",
      maxVisits: 200,
      rawFormat: "json",
      winratePerspective: "black",
    },
    input: {
      sgfSha256: "a".repeat(64),
      sgfSizeBytes: 42,
    },
    katago: {
      rootInfo: { winrate: 0.52, scoreLead: 0.4 },
      moveInfosCount: 3,
      topMove: { move: "Q16", winrate: 0.53 },
      hasWinrate: true,
      hasScoreLead: true,
      hasOwnership: false,
    },
    game_info: { total_moves: 2 },
    analysisPlan: {
      version: "analysis-plan-v1",
      totalMoves: 2,
      boardSize: 19,
      komi: 6.5,
      candidateTurns: [],
      strategy: {
        mode: "light",
        maxTurns: 20,
        includeFinalPosition: true,
        intervalStep: 20,
        openingTurnCutoff: 30,
      },
    },
    turnAnalyses: [
      {
        status: "ok",
        turnIndex: 1,
        player: "B",
        playedMove: "Q16",
      },
    ],
    bsiV1: { version: "bsi-v1", signals: [{ turnIndex: 1 }] },
    adiV1: { version: "adi-v1", signals: [{ turnIndex: 1 }] },
    deepSearchResults: {
      version: "deep-search-results-v1",
      enabled: false,
      completedCount: 0,
    },
    ...overrides,
  };
}

describe("katago result quality gate", () => {
  it("passes a product-usable KataGo worker result", () => {
    const report = assertKatagoResultQualityForCompletion(validResult());
    expect(report.ok).toBe(true);
    expect(report.failureCount).toBe(0);
  });

  it("fails missing core KataGo evidence", () => {
    const report = evaluateKatagoResultQuality(
      validResult({
        katago: {
          rootInfo: {},
          moveInfosCount: 0,
          topMove: null,
          hasWinrate: false,
          hasScoreLead: false,
        },
      })
    );
    expect(report.ok).toBe(false);
    expect(report.issues.map(issue => issue.code)).toEqual(
      expect.arrayContaining([
        "KATAGO_ROOT_INFO_MISSING",
        "KATAGO_MOVE_INFOS_MISSING",
        "KATAGO_WINRATE_MISSING",
        "KATAGO_TOP_MOVE_MISSING",
      ])
    );
  });

  it("fails a result that does not record a verified winrate axis", () => {
    const report = evaluateKatagoResultQuality(
      validResult({
        engine: { name: "katago", maxVisits: 200, rawFormat: "json" },
      })
    );
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "KATAGO_WINRATE_PERSPECTIVE_UNVERIFIED",
        severity: "fail",
      })
    );
  });

  it("fails when analysisPlan and game total moves disagree", () => {
    const report = evaluateKatagoResultQuality(
      validResult({
        game_info: { total_moves: 10 },
        analysisPlan: { ...validResult().analysisPlan, totalMoves: 9 },
      })
    );
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ANALYSIS_PLAN_TOTAL_MOVES_MISMATCH",
          details: { gameTotalMoves: 10, planTotalMoves: 9 },
        }),
      ])
    );
  });

  it("warns but does not fail when optional review signals are absent", () => {
    const report = evaluateKatagoResultQuality(
      validResult({
        turnAnalyses: [],
        bsiV1: { version: "bsi-v1", signals: [] },
        adiV1: { version: "adi-v1", signals: [] },
      })
    );
    expect(report.ok).toBe(true);
    expect(report.issues.map(issue => issue.code)).toEqual(
      expect.arrayContaining([
        "NO_TURN_ANALYSIS_OK",
        "NO_BSI_SIGNALS",
        "NO_ADI_SIGNALS",
      ])
    );
  });

  it("throws a compact error code list for completion writes", () => {
    expect(() =>
      assertKatagoResultQualityForCompletion(validResult({ source: "other" }))
    ).toThrow(/KATAGO_RESULT_QUALITY_FAILED: SOURCE_NOT_KATAGO_WORKER_V1/);
  });
});
