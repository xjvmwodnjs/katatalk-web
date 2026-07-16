import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  KATAGO_CORPUS_COVERAGE_TAGS,
  evaluateKatagoCorpusExpectations,
  loadKatagoCorpusManifest,
  parseKatagoCorpusValidateArgs,
} from "./katagoCorpusManifest";
import { runKatagoProductSmokeSuite } from "./katagoProductSmokeSuite";
import type { NormalizedAnalysisResult } from "./worker/analysisEngines/types";

type Manifest = {
  version: 1;
  id: string;
  minimumEntries: number;
  requiredCoverage: string[];
  entries: Array<{
    id: string;
    sgf: string;
    sha256: string;
    provenance: string;
    anonymized: true;
    expected: {
      productPass: true;
      boardSize: number;
      minMoves: number;
      maxMoves: number;
      minVisits: number;
      minTurnsOk: number;
      maxTurnsFailed: number;
      minBsiSignals: number;
      minAdiSignals: number;
      criticalTurns: number[];
      minCriticalTurnMatches: number;
      maxQualityWarnings: number;
      maxQualityFailures: number;
    };
    reviews?: Array<{
      reviewerId: string;
      reviewedAt: string;
      verdict: string;
      scores: {
        criticalMomentAccuracy: number;
        candidateUsefulness: number;
        educationalUsefulness: number;
      };
    }>;
  }>;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function longGameSgf(): string {
  const moves = Array.from({ length: 100 }, (_, index) => {
    const x = String.fromCharCode(97 + (index % 19));
    const y = String.fromCharCode(97 + (Math.floor(index / 19) % 19));
    return `;${index % 2 === 0 ? "B" : "W"}[${x}${y}]`;
  }).join("");
  return `(;FF[4]GM[1]SZ[19]KM[6.5]C[long-case]${moves})`;
}

function reviews() {
  return ["reviewer-a", "reviewer-b"].map(reviewerId => ({
    reviewerId,
    reviewedAt: "2026-07-14T00:00:00.000Z",
    verdict: "approved",
    scores: {
      criticalMomentAccuracy: 5,
      candidateUsefulness: 4,
      educationalUsefulness: 4,
    },
  }));
}

async function writeManifest(
  root: string,
  manifest: Manifest
): Promise<string> {
  const manifestPath = path.join(root, "manifest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  return manifestPath;
}

async function createValidCorpus(): Promise<{
  root: string;
  manifestPath: string;
  manifest: Manifest;
  sgfs: string[];
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "katago-corpus-manifest-"));
  const gamesDir = path.join(root, "games");
  await mkdir(gamesDir, { recursive: true });
  const sgfs = [
    "(;FF[4]GM[1]SZ[9]KM[6.5]C[case-1];B[aa];W[])",
    "(;FF[4]GM[1]SZ[13]KM[6.5]C[case-2];B[aa];W[bb])",
    "(;FF[4]GM[1]SZ[19]KM[0]HA[2]AB[pd][dp]C[case-3];W[qq];B[dd])",
    longGameSgf(),
    "(;FF[4]GM[1]SZ[19]KM[6.5]C[case-5];B[pd];W[dd])",
    "(;FF[4]GM[1]SZ[19]KM[6.5]C[case-6];B[dp];W[pp])",
    "(;FF[4]GM[1]SZ[19]KM[6.5]C[case-7];B[qq];W[dc])",
    "(;FF[4]GM[1]SZ[19]KM[6.5]C[case-8];B[cf];W[fc])",
    "(;FF[4]GM[1]SZ[19]KM[6.5]C[case-9];B[jj];W[kk])",
    "(;FF[4]GM[1]SZ[19]KM[6.5]C[case-10];B[cc];W[qq])",
  ];
  const entries: Manifest["entries"] = [];
  for (let index = 0; index < sgfs.length; index += 1) {
    const fileName = `case-${String(index + 1)}.sgf`;
    await writeFile(path.join(gamesDir, fileName), `${sgfs[index]}\n`, "utf8");
    const bytes = await readFile(path.join(gamesDir, fileName));
    const boardSize = index === 0 ? 9 : index === 1 ? 13 : 19;
    const moves = index === 3 ? 100 : 2;
    entries.push({
      id: `case-${String(index + 1)}`,
      sgf: `games/${fileName}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      provenance: index < 4 ? "customer-consented" : "internal",
      anonymized: true,
      expected: {
        productPass: true,
        boardSize,
        minMoves: moves,
        maxMoves: moves,
        minVisits: 25,
        minTurnsOk: 1,
        maxTurnsFailed: 0,
        minBsiSignals: 1,
        minAdiSignals: 1,
        criticalTurns: [1],
        minCriticalTurnMatches: 1,
        maxQualityWarnings: 0,
        maxQualityFailures: 0,
      },
      reviews: reviews(),
    });
  }
  const manifest: Manifest = {
    version: 1,
    id: "commercial-corpus-v1",
    minimumEntries: 10,
    requiredCoverage: [...KATAGO_CORPUS_COVERAGE_TAGS],
    entries,
  };
  return {
    root,
    manifestPath: await writeManifest(root, manifest),
    manifest,
    sgfs,
  };
}

function validProductResult(
  overrides: Record<string, unknown> = {}
): NormalizedAnalysisResult {
  return {
    ok: true,
    source: "katago-worker-v1",
    isMock: false,
    engine: {
      name: "katago",
      maxVisits: 25,
      winratePerspective: "black",
    },
    input: { sgfSha256: "b".repeat(64), sgfSizeBytes: 40 },
    katago: {
      rootInfo: { winrate: 0.51, scoreLead: 0.2 },
      moveInfosCount: 1,
      topMove: { move: "Q16", winrate: 0.53 },
      hasWinrate: true,
      hasScoreLead: true,
    },
    game_info: { total_moves: 6 },
    analysisPlan: { version: "analysis-plan-v1", totalMoves: 6 },
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

describe("loadKatagoCorpusManifest", () => {
  it("loads a checksum-pinned, anonymized, fully covered corpus", async () => {
    const corpus = await createValidCorpus();
    const loaded = await loadKatagoCorpusManifest({
      manifestPath: corpus.manifestPath,
      requireHumanReview: true,
    });

    expect(loaded.entries).toHaveLength(10);
    expect(loaded.coverage).toEqual([...KATAGO_CORPUS_COVERAGE_TAGS]);
    expect(loaded.humanReview).toEqual({
      required: true,
      approvedEntries: 10,
      totalEntries: 10,
    });
  });

  it("rejects a manifest with fewer than ten entries", async () => {
    const corpus = await createValidCorpus();
    corpus.manifest.entries = corpus.manifest.entries.slice(0, 9);
    await writeManifest(corpus.root, corpus.manifest);

    await expect(
      loadKatagoCorpusManifest({ manifestPath: corpus.manifestPath })
    ).rejects.toThrow(/entries=9 minimumEntries=10/);
  });

  it("rejects missing commercial coverage declarations", async () => {
    const corpus = await createValidCorpus();
    corpus.manifest.requiredCoverage = corpus.manifest.requiredCoverage.filter(
      tag => tag !== "long-game"
    );
    await writeManifest(corpus.root, corpus.manifest);

    await expect(
      loadKatagoCorpusManifest({ manifestPath: corpus.manifestPath })
    ).rejects.toThrow(/requiredCoverage must include long-game/);
  });

  it("rejects checksum changes", async () => {
    const corpus = await createValidCorpus();
    corpus.manifest.entries[0]!.sha256 = "0".repeat(64);
    await writeManifest(corpus.root, corpus.manifest);

    await expect(
      loadKatagoCorpusManifest({ manifestPath: corpus.manifestPath })
    ).rejects.toThrow(/sha256 mismatch/);
  });

  it("rejects duplicate SGF content", async () => {
    const corpus = await createValidCorpus();
    const duplicate = `${corpus.sgfs[0]}\n`;
    const secondPath = path.join(corpus.root, "games", "case-2.sgf");
    await writeFile(secondPath, duplicate, "utf8");
    corpus.manifest.entries[1]!.sha256 = sha256(duplicate);
    corpus.manifest.entries[1]!.expected.boardSize = 9;
    await writeManifest(corpus.root, corpus.manifest);

    await expect(
      loadKatagoCorpusManifest({ manifestPath: corpus.manifestPath })
    ).rejects.toThrow(/duplicate SGF content/);
  });

  it("rejects identifying SGF properties even with a fresh checksum", async () => {
    const corpus = await createValidCorpus();
    const identifying = "(;FF[4]GM[1]SZ[9]PB[Real Name]C[case-1];B[aa];W[])\n";
    const firstPath = path.join(corpus.root, "games", "case-1.sgf");
    await writeFile(firstPath, identifying, "utf8");
    corpus.manifest.entries[0]!.sha256 = sha256(identifying);
    await writeManifest(corpus.root, corpus.manifest);

    await expect(
      loadKatagoCorpusManifest({ manifestPath: corpus.manifestPath })
    ).rejects.toThrow(/anonymization failed.*PB/);
  });

  it("rejects insufficient human review when the launch gate requires it", async () => {
    const corpus = await createValidCorpus();
    corpus.manifest.entries[0]!.reviews =
      corpus.manifest.entries[0]!.reviews?.slice(0, 1);
    await writeManifest(corpus.root, corpus.manifest);

    await expect(
      loadKatagoCorpusManifest({
        manifestPath: corpus.manifestPath,
        requireHumanReview: true,
      })
    ).rejects.toThrow(/two distinct approved human reviews/);
  });

  it("rejects weak output expectations and inconsistent approvals", async () => {
    const corpus = await createValidCorpus();
    corpus.manifest.entries[0]!.expected.minBsiSignals = 0;
    corpus.manifest.entries[1]!.reviews![0]!.scores.candidateUsefulness = 2;
    await writeManifest(corpus.root, corpus.manifest);

    await expect(
      loadKatagoCorpusManifest({ manifestPath: corpus.manifestPath })
    ).rejects.toThrow(/minBsiSignals|approved reviews require/);
  });

  it("rejects duplicate critical turns and impossible match thresholds", async () => {
    const corpus = await createValidCorpus();
    corpus.manifest.entries[0]!.expected.criticalTurns = [1, 1];
    corpus.manifest.entries[0]!.expected.minCriticalTurnMatches = 2;
    await writeManifest(corpus.root, corpus.manifest);

    await expect(
      loadKatagoCorpusManifest({ manifestPath: corpus.manifestPath })
    ).rejects.toThrow(/criticalTurns must not contain duplicates/);
  });
});

describe("parseKatagoCorpusValidateArgs", () => {
  it("accepts repeated manifests and the human review launch gate", () => {
    expect(
      parseKatagoCorpusValidateArgs([
        "--",
        "--manifest",
        "first.json",
        "--manifest=second.json",
        "--require-human-review",
      ])
    ).toEqual({
      manifestPaths: ["first.json", "second.json"],
      requireHumanReview: true,
      help: false,
    });
  });
});

describe("evaluateKatagoCorpusExpectations", () => {
  it("fails individual output expectations instead of accepting structure alone", () => {
    const result = evaluateKatagoCorpusExpectations({
      expected: {
        productPass: true,
        boardSize: 19,
        minMoves: 1,
        maxMoves: 300,
        minVisits: 200,
        minTurnsOk: 2,
        maxTurnsFailed: 0,
        minBsiSignals: 2,
        minAdiSignals: 1,
        criticalTurns: [1, 2],
        minCriticalTurnMatches: 2,
        maxQualityWarnings: 0,
        maxQualityFailures: 0,
      },
      actual: {
        visits: 25,
        turnsOk: 1,
        turnsFailed: 0,
        bsiSignals: 1,
        adiSignals: 1,
        bsiSignalTurns: [1],
        adiSignalTurns: [1],
        qualityWarnings: 0,
        qualityFailures: 0,
      },
    });

    expect(result.passed).toBe(false);
    expect(
      result.checks.filter(check => !check.passed).map(check => check.name)
    ).toEqual([
      "min_visits",
      "min_turns_ok",
      "min_bsi_signals",
      "min_critical_turn_matches",
    ]);
  });

  it("requires human-designated critical turns in both BSI and ADI signals", () => {
    const result = evaluateKatagoCorpusExpectations({
      expected: {
        productPass: true,
        boardSize: 19,
        minMoves: 1,
        maxMoves: 300,
        minVisits: 25,
        minTurnsOk: 1,
        maxTurnsFailed: 0,
        minBsiSignals: 1,
        minAdiSignals: 1,
        criticalTurns: [10, 18],
        minCriticalTurnMatches: 2,
        maxQualityWarnings: 0,
        maxQualityFailures: 0,
      },
      actual: {
        visits: 25,
        turnsOk: 2,
        turnsFailed: 0,
        bsiSignals: 2,
        adiSignals: 2,
        bsiSignalTurns: [10, 18],
        adiSignalTurns: [10],
        qualityWarnings: 0,
        qualityFailures: 0,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        name: "min_critical_turn_matches",
        actual: 1,
        passed: false,
      })
    );
  });
});

describe("manifest-backed product suite", () => {
  it("includes corpus expectations and human review evidence in the report", async () => {
    const corpus = await createValidCorpus();
    const report = await runKatagoProductSmokeSuite({
      cwd: corpus.root,
      sgfPaths: [],
      corpusManifestPaths: [corpus.manifestPath],
      requireHumanReview: true,
      outDir: path.join(corpus.root, "out"),
      analyzeFn: async () => validProductResult(),
    });

    expect(report.passed).toBe(true);
    expect(report.corpusManifests).toHaveLength(1);
    expect(report.rows).toHaveLength(10);
    expect(report.rows.every(row => row.corpus?.passed === true)).toBe(true);
    expect(report.rows.every(row => row.expectationMet)).toBe(true);
  });

  it("fails the suite when a manifest output expectation is missed", async () => {
    const corpus = await createValidCorpus();
    const report = await runKatagoProductSmokeSuite({
      cwd: corpus.root,
      sgfPaths: [],
      corpusManifestPaths: [corpus.manifestPath],
      outDir: path.join(corpus.root, "out-failed"),
      analyzeFn: async () => validProductResult({ bsiV1: { signals: [] } }),
    });

    expect(report.passed).toBe(false);
    expect(report.totals.expectationFailed).toBe(10);
    expect(report.rows[0]?.corpus?.checks).toContainEqual(
      expect.objectContaining({ name: "min_bsi_signals", passed: false })
    );
  });
});
