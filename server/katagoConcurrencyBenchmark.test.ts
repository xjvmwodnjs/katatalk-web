import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  KATAGO_CONCURRENCY_PROTOCOL,
  buildConcurrencyDurationStats,
  parseKatagoConcurrencyBenchmarkArgs,
  runKatagoConcurrencyBenchmark,
  runKatagoConcurrencyLevel,
  type KatagoConcurrencyBenchmarkLane,
  type KatagoConcurrencyRunnerResult,
} from "./katagoConcurrencyBenchmark";

const stableMemory = () => ({
  totalBytes: 8 * 1024 * 1024 * 1024,
  freeBytes: 4 * 1024 * 1024 * 1024,
});

function fakeLane(
  id: number,
  opts?: { warningCount?: number; delayMs?: number }
): KatagoConcurrencyBenchmarkLane {
  return {
    id,
    ready: async () => undefined,
    close: async () => undefined,
    analyze: async request => {
      await new Promise(resolve => setTimeout(resolve, opts?.delayMs ?? 5));
      const warningCount = opts?.warningCount ?? 0;
      const result: KatagoConcurrencyRunnerResult = {
        protocol: KATAGO_CONCURRENCY_PROTOCOL,
        type: "result",
        jobId: request.jobId,
        ok: true,
        durationMs: opts?.delayMs ?? 5,
        quality: {
          ok: true,
          failureCount: 0,
          warningCount,
          issueCodes: warningCount > 0 ? ["TEST_WARNING"] : [],
        },
        phaseDurationsMs: {
          totalBeforeQualityGate: opts?.delayMs ?? 5,
          rootAnalysis: 2,
          rootStage: 2,
          multiTurn: 2,
          signalPlanning: 0,
          deepSearch: 0,
          winrateTimeline: 0,
        },
        error: null,
      };
      return result;
    },
  };
}

describe("parseKatagoConcurrencyBenchmarkArgs", () => {
  it("parses levels, SLOs, memory policy, and target", () => {
    expect(
      parseKatagoConcurrencyBenchmarkArgs([
        "--levels=4,1,2,2",
        "--jobs",
        "8",
        "--memory-reserve-mib=2048",
        "--max-queue-p95-ms",
        "45000",
        "--min-throughput-jobs-per-minute=1.5",
        "--force-memory-risk",
        "--out-dir",
        ".tmp/concurrency",
        "--",
        "game.sgf",
      ])
    ).toMatchObject({
      sgfPath: "game.sgf",
      levels: [1, 2, 4],
      jobs: 8,
      memoryReserveMiB: 2048,
      maxQueueP95Ms: 45000,
      minThroughputJobsPerMinute: 1.5,
      forceMemoryRisk: true,
      outDir: ".tmp/concurrency",
    });
  });
});

describe("runKatagoConcurrencyLevel", () => {
  it("dispatches a shared queue across isolated lanes and evaluates SLOs", async () => {
    const level = await runKatagoConcurrencyLevel({
      concurrency: 2,
      jobs: 4,
      sgfContent: "(;FF[4]GM[1]SZ[19];B[pd];W[dd])",
      fileName: "game.sgf",
      language: "ko",
      maxVisits: 25,
      thresholds: {
        maxQueueP95Ms: 1_000,
        maxEngineP95Ms: 1_000,
        maxEndToEndP95Ms: 1_000,
        minThroughputJobsPerMinute: 1,
        memoryReserveMiB: 1_024,
      },
      laneFactory: id => fakeLane(id),
      memorySnapshot: stableMemory,
      memorySampleIntervalMs: 25,
      runId: "test",
    });

    expect(level.status).toBe("completed");
    expect(level.passed).toBe(true);
    expect(level.rows).toHaveLength(4);
    expect(new Set(level.rows.map(row => row.laneId))).toEqual(new Set([1, 2]));
    expect(level.queueWaitMs.count).toBe(4);
    expect(level.throughputJobsPerMinute).toBeGreaterThan(1);
  });

  it("fails strict product quality when a result has a warning", async () => {
    const level = await runKatagoConcurrencyLevel({
      concurrency: 1,
      jobs: 1,
      sgfContent: "(;FF[4]GM[1]SZ[19];B[pd])",
      fileName: "game.sgf",
      language: "ko",
      maxVisits: 25,
      thresholds: {
        maxQueueP95Ms: 1_000,
        maxEngineP95Ms: 1_000,
        maxEndToEndP95Ms: 1_000,
        minThroughputJobsPerMinute: 1,
        memoryReserveMiB: 1_024,
      },
      laneFactory: id => fakeLane(id, { warningCount: 1 }),
      memorySnapshot: stableMemory,
      runId: "quality-test",
    });

    expect(level.passed).toBe(false);
    expect(level.successfulJobs).toBe(0);
    expect(level.rows[0]?.quality.warningCount).toBe(1);
  });
});

describe("runKatagoConcurrencyBenchmark", () => {
  it("writes JSON and Markdown reports and recommends a passing level", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "katago-concurrency-"));
    const report = await runKatagoConcurrencyBenchmark({
      cwd: dir,
      outDir: path.join(dir, "out"),
      levels: [2],
      jobs: 4,
      env: { KATAGO_MAX_VISITS: "25", KATAGO_MULTI_TURN_MAX: "2" },
      laneFactory: id => fakeLane(id),
      memorySnapshot: stableMemory,
      memorySampleIntervalMs: 25,
      maxQueueP95Ms: 1_000,
      maxEngineP95Ms: 1_000,
      maxEndToEndP95Ms: 1_000,
      minThroughputJobsPerMinute: 1,
    });

    expect(report.passed).toBe(true);
    expect(report.recommendedConcurrency).toBe(2);
    expect(report.target.moves).toBe(120);
    expect(await readFile(report.jsonPath, "utf8")).toContain(
      '"recommendedConcurrency": 2'
    );
    expect(await readFile(report.markdownPath, "utf8")).toContain(
      "single-host capacity test"
    );
  });
});

describe("buildConcurrencyDurationStats", () => {
  it("uses nearest-rank percentiles", () => {
    expect(buildConcurrencyDurationStats([300, 100, 200, 400])).toMatchObject({
      count: 4,
      min: 100,
      max: 400,
      mean: 250,
      p50: 200,
      p90: 400,
      p95: 400,
    });
  });
});
