import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildKatagoProductSmokeSuiteGate,
  buildKatagoProductSmokeSuiteStats,
  collectSgfCorpusTargets,
  CUSTOMER_STYLE_KATAGO_PRODUCT_SMOKE_FIXTURES,
  EXTENDED_KATAGO_PRODUCT_SMOKE_FIXTURES,
  parseKatagoProductSmokeSuiteArgs,
  runKatagoProductSmokeSuite,
  writeDefaultKatagoProductSmokeFixtures,
} from "./katagoProductSmokeSuite";
import type {
  AnalyzeSgfInput,
  NormalizedAnalysisResult,
} from "./worker/analysisEngines/types";
import type { KatagoProductSmokeSuiteRow } from "./katagoProductSmokeSuite";

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
    input: {
      sgfSha256: "b".repeat(64),
      sgfSizeBytes: 40,
    },
    katago: {
      rootInfo: { winrate: 0.51, scoreLead: 0.2 },
      moveInfosCount: 1,
      topMove: { move: "Q16", winrate: 0.53 },
      hasWinrate: true,
      hasScoreLead: true,
    },
    game_info: {
      total_moves: 6,
    },
    analysisPlan: {
      version: "analysis-plan-v1",
      totalMoves: 6,
    },
    turnAnalyses: [{ status: "ok" }, { status: "failed" }],
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

function suiteRow(
  overrides: Partial<KatagoProductSmokeSuiteRow> = {}
): KatagoProductSmokeSuiteRow {
  return {
    name: "row",
    sgfPath: "row.sgf",
    expectedToPass: true,
    expectationMet: true,
    passed: true,
    durationMs: 100,
    queueWaitMs: 10,
    endToEndMs: 110,
    resultFileUrl: "file:///row.json",
    error: null,
    quality: {
      ok: true,
      failureCount: 0,
      warningCount: 0,
      issueCodes: [],
    },
    productReviewCategoryQuality: {
      ok: true,
      failureCount: 0,
      issueCodes: [],
    },
    moves: 10,
    visits: 25,
    turnsOk: 1,
    turnsFailed: 0,
    bsiSignals: 1,
    adiSignals: 1,
    deepSearchEnabled: false,
    deepSearchCompleted: 0,
    phaseDurationsMs: {
      totalBeforeQualityGate: 90,
      rootAnalysis: 20,
      rootStage: 22,
      multiTurn: 60,
      signalPlanning: 2,
      deepSearch: 0,
      winrateTimeline: 0,
    },
    ...overrides,
  };
}

describe("parseKatagoProductSmokeSuiteArgs", () => {
  it("parses flags and multiple SGF paths", () => {
    expect(
      parseKatagoProductSmokeSuiteArgs([
        "--",
        "--default-fixtures",
        "--extended-fixtures",
        "--customer-fixtures",
        "--strict-warnings",
        "--stop-on-failure",
        "--out-dir",
        ".tmp/suite",
        "--corpus-dir",
        ".local/corpus",
        "--corpus-manifest",
        ".local/corpus/manifest.json",
        "--require-human-review",
        "--repeat",
        "3",
        "--concurrency",
        "4",
        "--max-successful-p95-ms",
        "120000",
        "--max-queue-p95-ms=30000",
        "--max-end-to-end-p95-ms",
        "120000",
        "--min-throughput-jobs-per-minute=1",
        "--max-peak-used-delta-mib",
        "4096",
        "--min-free-memory-mib=1024",
        "--max-expected-pass-failure-rate=0.05",
        "--max-quality-warning-rows",
        "0",
        "--max-quality-failure-rows=0",
        "--max-product-review-category-quality-failure-rows",
        "0",
        "--lang=en",
        "a.sgf",
        "b.sgf",
      ])
    ).toEqual({
      sgfPaths: ["a.sgf", "b.sgf"],
      corpusDirs: [".local/corpus"],
      corpusManifestPaths: [".local/corpus/manifest.json"],
      outDir: ".tmp/suite",
      language: "en",
      requireHumanReview: true,
      strictWarnings: true,
      stopOnFailure: true,
      useDefaultFixtures: true,
      useExtendedFixtures: true,
      useCustomerFixtures: true,
      repeat: 3,
      concurrency: 4,
      maxSuccessfulP95Ms: 120000,
      maxQueueP95Ms: 30000,
      maxEndToEndP95Ms: 120000,
      minThroughputJobsPerMinute: 1,
      maxPeakUsedDeltaMiB: 4096,
      minFreeMemoryMiB: 1024,
      maxExpectedPassFailureRate: 0.05,
      maxQualityWarningRows: 0,
      maxQualityFailureRows: 0,
      maxProductReviewCategoryQualityFailureRows: 0,
      help: false,
    });
  });
});

describe("collectSgfCorpusTargets", () => {
  it("recursively collects only SGF files from a private corpus directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "katago-product-suite-"));
    const corpusDir = path.join(dir, ".local", "corpus");
    const nestedDir = path.join(corpusDir, "nested");
    await mkdir(nestedDir, { recursive: true });
    await writeFile(
      path.join(corpusDir, "a.sgf"),
      "(;FF[4]GM[1]SZ[19];B[pd])\n",
      "utf8"
    );
    await writeFile(
      path.join(nestedDir, "b.SGF"),
      "(;FF[4]GM[1]SZ[19];B[dd])\n",
      "utf8"
    );
    await writeFile(path.join(corpusDir, "ignore.txt"), "not sgf\n", "utf8");

    const targets = await collectSgfCorpusTargets({
      cwd: dir,
      corpusDirs: [path.join(".local", "corpus")],
    });

    expect(targets.map(target => target.name)).toEqual([
      ".local/corpus/a.sgf",
      ".local/corpus/nested/b.SGF",
    ]);
    expect(targets.every(target => target.expectedToPass)).toBe(true);
  });
});

describe("buildKatagoProductSmokeSuiteStats", () => {
  it("summarizes successful durations and expected-pass failure rate", () => {
    const stats = buildKatagoProductSmokeSuiteStats([
      suiteRow({ durationMs: 100 }),
      suiteRow({ durationMs: 200 }),
      suiteRow({ durationMs: 300 }),
      suiteRow({ durationMs: 400 }),
      suiteRow({
        expectedToPass: true,
        expectationMet: false,
        passed: false,
        durationMs: null,
        error: "failed",
      }),
      suiteRow({
        expectedToPass: false,
        expectationMet: true,
        passed: false,
        durationMs: null,
        error: "expected malformed",
      }),
      suiteRow({
        quality: {
          ok: true,
          failureCount: 0,
          warningCount: 1,
          issueCodes: ["MULTI_TURN_MISSING"],
        },
      }),
    ]);

    expect(stats.successfulDurationMs).toEqual({
      count: 5,
      min: 100,
      max: 400,
      mean: 220,
      p50: 200,
      p90: 400,
      p95: 400,
    });
    expect(stats.queueWaitMs).toEqual({
      count: 7,
      min: 10,
      max: 10,
      mean: 10,
      p50: 10,
      p90: 10,
      p95: 10,
    });
    expect(stats.endToEndMs).toEqual({
      count: 7,
      min: 110,
      max: 110,
      mean: 110,
      p50: 110,
      p90: 110,
      p95: 110,
    });
    expect(stats.expectedPass).toEqual({
      count: 6,
      failed: 1,
      failureRate: 1 / 6,
    });
    expect(stats.quality).toEqual({
      warningRows: 1,
      failureRows: 0,
    });
    expect(stats.productReviewCategoryQualityFailureRows).toBe(0);
  });
});

describe("buildKatagoProductSmokeSuiteGate", () => {
  it("passes when all configured thresholds are met", () => {
    const stats = buildKatagoProductSmokeSuiteStats([
      suiteRow({ durationMs: 100 }),
      suiteRow({ durationMs: 200 }),
      suiteRow({ durationMs: 300 }),
    ]);

    const gate = buildKatagoProductSmokeSuiteGate({
      stats,
      throughputJobsPerMinute: 2,
      memory: {
        sampleCount: 4,
        totalMiB: 8192,
        initialFreeMiB: 4096,
        minimumFreeMiB: 2048,
        peakUsedDeltaMiB: 512,
      },
      thresholds: {
        maxSuccessfulP95Ms: 300,
        maxQueueP95Ms: 10,
        maxEndToEndP95Ms: 110,
        minThroughputJobsPerMinute: 1,
        maxPeakUsedDeltaMiB: 1024,
        minFreeMemoryMiB: 1024,
        maxExpectedPassFailureRate: 0,
        maxQualityWarningRows: 0,
        maxQualityFailureRows: 0,
        maxProductReviewCategoryQualityFailureRows: 0,
      },
    });

    expect(gate.passed).toBe(true);
    expect(gate.checks).toHaveLength(10);
  });

  it("fails when p95 or expected-pass failure rate exceeds thresholds", () => {
    const stats = buildKatagoProductSmokeSuiteStats([
      suiteRow({ durationMs: 100 }),
      suiteRow({ durationMs: 400 }),
      suiteRow({
        expectedToPass: true,
        expectationMet: false,
        passed: false,
        durationMs: null,
        error: "failed",
      }),
    ]);

    const gate = buildKatagoProductSmokeSuiteGate({
      stats,
      throughputJobsPerMinute: 0.5,
      memory: {
        sampleCount: 4,
        totalMiB: 8192,
        initialFreeMiB: 4096,
        minimumFreeMiB: 512,
        peakUsedDeltaMiB: 2048,
      },
      thresholds: {
        maxSuccessfulP95Ms: 300,
        maxQueueP95Ms: 5,
        maxEndToEndP95Ms: 100,
        minThroughputJobsPerMinute: 1,
        maxPeakUsedDeltaMiB: 1024,
        minFreeMemoryMiB: 1024,
        maxExpectedPassFailureRate: 0,
      },
    });

    expect(gate.passed).toBe(false);
    expect(
      gate.checks.find(check => check.name === "max_successful_p95_ms")?.passed
    ).toBe(false);
    expect(
      gate.checks.find(check => check.name === "max_queue_p95_ms")?.passed
    ).toBe(false);
    expect(
      gate.checks.find(check => check.name === "max_end_to_end_p95_ms")?.passed
    ).toBe(false);
    expect(
      gate.checks.find(check => check.name === "min_throughput_jobs_per_minute")
        ?.passed
    ).toBe(false);
    expect(
      gate.checks.find(check => check.name === "max_peak_used_delta_mib")
        ?.passed
    ).toBe(false);
    expect(
      gate.checks.find(check => check.name === "min_free_memory_mib")?.passed
    ).toBe(false);
    expect(
      gate.checks.find(check => check.name === "max_expected_pass_failure_rate")
        ?.passed
    ).toBe(false);
  });
});

describe("writeDefaultKatagoProductSmokeFixtures", () => {
  it("writes ignored synthetic fixtures", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "katago-product-suite-"));
    const fixtures = await writeDefaultKatagoProductSmokeFixtures({ cwd: dir });

    expect(fixtures.length).toBeGreaterThanOrEqual(5);
    expect(fixtures.some(fixture => fixture.expectedToPass === false)).toBe(
      true
    );
    const first = await readFile(fixtures[0]!.path, "utf8");
    expect(first).toContain("(;");
  });

  it("can write extended representative fixtures", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "katago-product-suite-"));
    const fixtures = await writeDefaultKatagoProductSmokeFixtures({
      cwd: dir,
      fixtures: EXTENDED_KATAGO_PRODUCT_SMOKE_FIXTURES,
    });

    expect(fixtures).toHaveLength(3);
    const longFixture = await readFile(fixtures[2]!.path, "utf8");
    expect(longFixture.match(/;[BW]\[/g)?.length).toBe(100);
  });

  it("can write customer-style representative fixtures", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "katago-product-suite-"));
    const fixtures = await writeDefaultKatagoProductSmokeFixtures({
      cwd: dir,
      fixtures: CUSTOMER_STYLE_KATAGO_PRODUCT_SMOKE_FIXTURES,
    });

    expect(fixtures).toHaveLength(4);
    expect(fixtures.every(fixture => fixture.expectedToPass)).toBe(true);
    const passFixture = await readFile(fixtures[0]!.path, "utf8");
    const longFixture = await readFile(fixtures[3]!.path, "utf8");
    expect(passFixture).toContain(";B[];W[]");
    expect(longFixture.match(/;[BW]\[/g)?.length).toBe(160);
  });
});

describe("runKatagoProductSmokeSuite", () => {
  it("runs default fixtures, records expected malformed failure, and writes benchmark files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "katago-product-suite-"));
    const seen: string[] = [];

    const report = await runKatagoProductSmokeSuite({
      sgfPaths: [],
      cwd: dir,
      outDir: path.join(dir, "out"),
      useDefaultFixtures: true,
      analyzeFn: async (input: AnalyzeSgfInput) => {
        seen.push(input.fileName);
        if (input.fileName.includes("malformed")) {
          throw new Error("SGF_PARSE_FAILED: synthetic malformed fixture");
        }
        return validProductResult();
      },
    });

    expect(report.passed).toBe(true);
    expect(report.totals.count).toBeGreaterThanOrEqual(5);
    expect(report.totals.expectationFailed).toBe(0);
    expect(report.totals.productFailed).toBe(1);
    expect(report.stats.expectedPass.failed).toBe(0);
    expect(report.stats.successfulDurationMs.count).toBeGreaterThan(0);
    expect(report.gate.passed).toBe(true);
    expect(seen.some(fileName => fileName.includes("malformed"))).toBe(true);

    const json = JSON.parse(await readFile(report.jsonPath, "utf8")) as {
      rows: unknown[];
    };
    expect(json.rows.length).toBe(report.rows.length);
    const markdown = await readFile(report.markdownPath, "utf8");
    expect(markdown).toContain("KataGo Product Smoke Suite Benchmark");
    expect(markdown).toContain("Successful duration ms");
    expect(markdown).toContain("Gate passed");
    expect(markdown).toContain("malformed-not-sgf");
  });

  it("marks the suite failed when configured launch gates fail", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "katago-product-suite-"));

    const report = await runKatagoProductSmokeSuite({
      sgfPaths: [],
      cwd: dir,
      outDir: path.join(dir, "out"),
      useExtendedFixtures: true,
      gateThresholds: {
        maxSuccessfulP95Ms: 1,
      },
      analyzeFn: async () => {
        // A synchronous mock can measure as 0-1ms on fast runners and accidentally pass this gate.
        await new Promise(resolve => setTimeout(resolve, 5));
        return validProductResult();
      },
    });

    expect(report.passed).toBe(false);
    expect(report.totals.expectationFailed).toBe(0);
    expect(report.gate.passed).toBe(false);
    expect(report.gate.checks[0]?.name).toBe("max_successful_p95_ms");
  });

  it("marks the suite failed when an expected passing fixture fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "katago-product-suite-"));

    const report = await runKatagoProductSmokeSuite({
      sgfPaths: ["missing.sgf"],
      cwd: dir,
      outDir: path.join(dir, "out"),
      analyzeFn: async () => validProductResult(),
    });

    expect(report.passed).toBe(false);
    expect(report.totals.expectationFailed).toBe(1);
    expect(report.rows[0]?.error).toMatch(/ENOENT/);
  });

  it("repeats each target when repeat is greater than one", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "katago-product-suite-"));

    const report = await runKatagoProductSmokeSuite({
      sgfPaths: [],
      cwd: dir,
      outDir: path.join(dir, "out"),
      useExtendedFixtures: true,
      repeat: 2,
      analyzeFn: async () => validProductResult(),
    });

    expect(report.totals.count).toBe(
      EXTENDED_KATAGO_PRODUCT_SMOKE_FIXTURES.length * 2
    );
    expect(report.rows.map(row => row.name)).toEqual([
      ...EXTENDED_KATAGO_PRODUCT_SMOKE_FIXTURES.map(
        fixture => `${fixture.name}#1`
      ),
      ...EXTENDED_KATAGO_PRODUCT_SMOKE_FIXTURES.map(
        fixture => `${fixture.name}#2`
      ),
    ]);
    expect(report.passed).toBe(true);
  });

  it("runs customer-style representative fixtures", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "katago-product-suite-"));

    const report = await runKatagoProductSmokeSuite({
      sgfPaths: [],
      cwd: dir,
      outDir: path.join(dir, "out"),
      useCustomerFixtures: true,
      analyzeFn: async () => validProductResult(),
    });

    expect(report.passed).toBe(true);
    expect(report.totals.count).toBe(
      CUSTOMER_STYLE_KATAGO_PRODUCT_SMOKE_FIXTURES.length
    );
    expect(report.rows.map(row => row.name)).toContain(
      "customer-style-19x19-long-160-move"
    );
  });

  it("runs targets with bounded concurrency and preserves report order", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "katago-product-suite-"));
    let active = 0;
    let maxActive = 0;
    let memorySample = 0;

    const report = await runKatagoProductSmokeSuite({
      sgfPaths: [],
      cwd: dir,
      outDir: path.join(dir, "out"),
      useCustomerFixtures: true,
      concurrency: 2,
      gateThresholds: {
        maxQueueP95Ms: 1_000,
        maxEndToEndP95Ms: 1_000,
        minThroughputJobsPerMinute: 1,
        maxPeakUsedDeltaMiB: 1_024,
        minFreeMemoryMiB: 2_048,
      },
      memorySampleIntervalMs: 25,
      memorySnapshot: () => {
        const totalBytes = 8 * 1024 * 1024 * 1024;
        const step = Math.min(memorySample, 8);
        memorySample += 1;
        return {
          totalBytes,
          freeBytes: 4 * 1024 * 1024 * 1024 - step * 128 * 1024 * 1024,
        };
      },
      analyzeFn: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 25));
        active -= 1;
        return validProductResult();
      },
    });

    expect(report.passed).toBe(true);
    expect(report.concurrency).toBe(2);
    expect(maxActive).toBe(2);
    expect(report.rows.map(row => row.name)).toEqual(
      CUSTOMER_STYLE_KATAGO_PRODUCT_SMOKE_FIXTURES.map(fixture => fixture.name)
    );
    expect(report.stats.queueWaitMs.max).toBeGreaterThan(0);
    expect(report.stats.endToEndMs.p95).toBeGreaterThanOrEqual(
      report.stats.successfulDurationMs.p95 ?? 0
    );
    expect(report.executionDurationMs).toBeGreaterThan(0);
    expect(report.throughputJobsPerMinute).toBeGreaterThan(1);
    expect(report.memory.sampleCount).toBeGreaterThanOrEqual(2);
    expect(report.memory.initialFreeMiB).toBe(4_096);
    expect(report.memory.minimumFreeMiB).toBeLessThan(4_096);
    expect(report.memory.peakUsedDeltaMiB).toBeGreaterThan(0);
    expect(new Set(report.rows.map(row => row.resultFileUrl)).size).toBe(
      report.rows.length
    );
  });

  it("rejects stop-on-failure with concurrent execution", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "katago-product-suite-"));

    await expect(
      runKatagoProductSmokeSuite({
        sgfPaths: [],
        cwd: dir,
        outDir: path.join(dir, "out"),
        useCustomerFixtures: true,
        concurrency: 2,
        stopOnFailure: true,
        analyzeFn: async () => validProductResult(),
      })
    ).rejects.toThrow(
      "KATAGO_PRODUCT_SMOKE_SUITE_STOP_ON_FAILURE_REQUIRES_CONCURRENCY_1"
    );
  });

  it("runs SGF files collected from corpus directories", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "katago-product-suite-"));
    const corpusDir = path.join(dir, ".local", "corpus");
    await mkdir(corpusDir, { recursive: true });
    await writeFile(
      path.join(corpusDir, "game-a.sgf"),
      "(;FF[4]GM[1]SZ[19];B[pd];W[dd])\n",
      "utf8"
    );
    await writeFile(path.join(corpusDir, "notes.md"), "not a game\n", "utf8");

    const report = await runKatagoProductSmokeSuite({
      sgfPaths: [],
      corpusDirs: [path.join(".local", "corpus")],
      cwd: dir,
      outDir: path.join(dir, "out"),
      analyzeFn: async () => validProductResult(),
    });

    expect(report.passed).toBe(true);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.name).toBe(".local/corpus/game-a.sgf");
  });
});
