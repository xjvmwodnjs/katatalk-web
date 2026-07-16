import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseKatagoProductSmokeArgs,
  runKatagoProductSmoke,
} from "./katagoProductSmoke";
import type {
  AnalyzeSgfInput,
  NormalizedAnalysisResult,
} from "./worker/analysisEngines/types";

function validProductResult(
  overrides: Record<string, unknown> = {}
): NormalizedAnalysisResult {
  return {
    ok: true,
    source: "katago-worker-v1",
    isMock: false,
    engine: {
      name: "katago",
      maxVisits: 37,
      winratePerspective: "black",
      phaseDurationsMs: {
        totalBeforeQualityGate: 90,
        rootAnalysis: 20,
        rootStage: 22,
        multiTurn: 60,
        signalPlanning: 2,
        deepSearch: 0,
        winrateTimeline: 0,
      },
    },
    input: {
      sgfSha256: "a".repeat(64),
      sgfSizeBytes: 32,
    },
    katago: {
      rootInfo: { winrate: 0.52, scoreLead: 0.4 },
      moveInfosCount: 1,
      topMove: { move: "Q16", winrate: 0.53 },
      hasWinrate: true,
      hasScoreLead: true,
    },
    game_info: {
      total_moves: 2,
    },
    analysisPlan: {
      version: "analysis-plan-v1",
      totalMoves: 2,
    },
    turnAnalyses: [{ status: "ok" }],
    bsiV1: { signals: [{ turnIndex: 1 }] },
    adiV1: { signals: [{ turnIndex: 1 }] },
    deepSearchResults: {
      enabled: false,
      candidateCount: 0,
      attemptedCount: 0,
      completedCount: 0,
      failedCount: 0,
    },
    ...overrides,
  };
}

async function writeTempSgf(): Promise<{ dir: string; sgfPath: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "katago-product-smoke-"));
  const sgfPath = path.join(dir, "game.sgf");
  await writeFile(sgfPath, "(;FF[4]GM[1]SZ[19];B[pd];W[dd])", "utf8");
  return { dir, sgfPath };
}

describe("parseKatagoProductSmokeArgs", () => {
  it("parses flags and sgf path", () => {
    expect(
      parseKatagoProductSmokeArgs([
        "--strict-warnings",
        "--out-dir",
        ".tmp/out",
        "--job-id=smoke-1",
        "--lang",
        "en",
        "--",
        "sample.sgf",
      ])
    ).toEqual({
      sgfPath: "sample.sgf",
      outDir: ".tmp/out",
      jobId: "smoke-1",
      language: "en",
      strictWarnings: true,
      help: false,
    });
  });
});

describe("runKatagoProductSmoke", () => {
  it("runs the product analyzer and writes a quality-gated result", async () => {
    const { dir, sgfPath } = await writeTempSgf();
    let captured: AnalyzeSgfInput | null = null;

    const summary = await runKatagoProductSmoke({
      sgfPath,
      outDir: path.join(dir, "out"),
      env: { KATAGO_MAX_VISITS: "37" } as NodeJS.ProcessEnv,
      analyzeFn: async input => {
        captured = input;
        return validProductResult();
      },
    });

    expect(summary.passed).toBe(true);
    expect(summary.qualityGate.ok).toBe(true);
    expect(summary.qualityGate.warningCount).toBe(0);
    expect(summary.turnAnalyses.okCount).toBe(1);
    expect(summary.bsiSignalCount).toBe(1);
    expect(summary.adiSignalCount).toBe(1);
    expect(summary.phaseDurationsMs).toMatchObject({
      rootAnalysis: 20,
      multiTurn: 60,
      deepSearch: 0,
      winrateTimeline: 0,
    });
    expect(captured?.maxVisits).toBe(37);
    expect(captured?.fileName).toBe("game.sgf");

    const written = JSON.parse(
      await readFile(summary.outputPath, "utf8")
    ) as Record<string, unknown>;
    expect(written.source).toBe("katago-worker-v1");
    expect(written.qualityGate).toEqual(summary.qualityGate);
  });

  it("can fail on quality warnings in strict mode", async () => {
    const { dir, sgfPath } = await writeTempSgf();

    const summary = await runKatagoProductSmoke({
      sgfPath,
      outDir: path.join(dir, "out"),
      strictWarnings: true,
      analyzeFn: async () =>
        validProductResult({
          turnAnalyses: [],
          bsiV1: { signals: [] },
          adiV1: { signals: [] },
        }),
    });

    expect(summary.qualityGate.ok).toBe(true);
    expect(summary.qualityGate.warningCount).toBeGreaterThan(0);
    expect(summary.passed).toBe(false);
  });
});
