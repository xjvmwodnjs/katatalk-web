import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  PersistentKatagoAnalysisSession,
  buildDurationStats,
  parseKatagoPersistentBenchmarkArgs,
  runKatagoPersistentBenchmark,
} from "./worker/analysisEngines/katagoPersistentBenchmark";
import type { SpawnFn } from "./worker/analysisEngines/katagoSmokeRun";

function validResponse(id: string): string {
  return `${JSON.stringify({
    id,
    rootInfo: { winrate: 0.52, scoreLead: 0.4 },
    moveInfos: [{ move: "Q16", winrate: 0.53 }],
  })}\n`;
}

function createMockPersistentSpawn(opts?: { delayMs?: number }): {
  spawnFn: SpawnFn;
  spawnCount: () => number;
} {
  let count = 0;
  const delayMs = opts?.delayMs ?? 0;
  const spawnFn: SpawnFn = () => {
    count += 1;
    const proc = new EventEmitter() as ChildProcess;
    const out = new PassThrough();
    const err = new PassThrough();
    const stdin = new Writable({
      write(chunk: Buffer | string, _enc, cb) {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          const query = JSON.parse(trimmed) as { id: string };
          const writeResponse = () => {
            out.write(validResponse(query.id), "utf8");
          };
          if (delayMs > 0) {
            setTimeout(writeResponse, delayMs);
          } else {
            writeResponse();
          }
        }
        cb();
      },
      final(cb) {
        setImmediate(() => {
          out.end();
          err.end();
          proc.emit("close", 0, null);
        });
        cb();
      },
    });
    proc.stdin = stdin;
    proc.stdout = out;
    proc.stderr = err;
    proc.kill = (() => true) as ChildProcess["kill"];
    return proc;
  };
  return { spawnFn, spawnCount: () => count };
}

describe("parseKatagoPersistentBenchmarkArgs", () => {
  it("parses fixture, corpus, repeat, and persistent-only flags", () => {
    expect(
      parseKatagoPersistentBenchmarkArgs([
        "--default-fixtures",
        "--extended-fixtures",
        "--customer-fixtures",
        "--corpus-dir",
        ".local/corpus",
        "--repeat=3",
        "--persistent-only",
        "--out-dir",
        ".tmp/out",
        "--",
        "a.sgf",
      ])
    ).toEqual({
      sgfPaths: ["a.sgf"],
      corpusDirs: [".local/corpus"],
      outDir: ".tmp/out",
      useDefaultFixtures: true,
      useExtendedFixtures: true,
      useCustomerFixtures: true,
      repeat: 3,
      persistentOnly: true,
      help: false,
    });
  });
});

describe("PersistentKatagoAnalysisSession", () => {
  it("keeps one process open and resolves responses by id", async () => {
    const { spawnFn, spawnCount } = createMockPersistentSpawn();
    const session = new PersistentKatagoAnalysisSession({
      env: {
        KATAGO_BINARY_PATH: "/fake/katago",
        KATAGO_CONFIG_PATH: "/fake/cfg",
        KATAGO_MODEL_PATH: "/fake/model.bin.gz",
      },
      spawnFn,
    });

    const first = await session.analyzeLine({
      queryLine: `${JSON.stringify({ id: "q1" })}\n`,
      expectedId: "q1",
      timeoutMs: 30_000,
    });
    const second = await session.analyzeLine({
      queryLine: `${JSON.stringify({ id: "q2" })}\n`,
      expectedId: "q2",
      timeoutMs: 30_000,
    });
    await session.close();

    expect(spawnCount()).toBe(1);
    expect(first.rawObject.id).toBe("q1");
    expect(second.rawObject.id).toBe("q2");
    expect(first.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports pending queries until their responses arrive", async () => {
    const { spawnFn } = createMockPersistentSpawn({ delayMs: 10 });
    const session = new PersistentKatagoAnalysisSession({
      env: {
        KATAGO_BINARY_PATH: "/fake/katago",
        KATAGO_CONFIG_PATH: "/fake/cfg",
        KATAGO_MODEL_PATH: "/fake/model.bin.gz",
      },
      spawnFn,
    });

    const pending = session.analyzeLine({
      queryLine: `${JSON.stringify({ id: "pending" })}\n`,
      expectedId: "pending",
      timeoutMs: 30_000,
    });
    expect(session.pendingCount).toBe(1);
    await pending;
    expect(session.pendingCount).toBe(0);
    await session.close();
  });

  it("rejects every pending query on child crash and restarts cleanly", async () => {
    let spawnCount = 0;
    let firstProc: ChildProcess | null = null;
    const spawnFn: SpawnFn = () => {
      spawnCount += 1;
      const currentSpawn = spawnCount;
      const proc = new EventEmitter() as ChildProcess;
      const out = new PassThrough();
      const err = new PassThrough();
      const stdin = new Writable({
        write(chunk: Buffer | string, _enc, cb) {
          if (currentSpawn > 1) {
            const text =
              typeof chunk === "string" ? chunk : chunk.toString("utf8");
            const query = JSON.parse(text.trim()) as { id: string };
            setImmediate(() => out.write(validResponse(query.id), "utf8"));
          }
          cb();
        },
        final(cb) {
          setImmediate(() => {
            out.end();
            err.end();
            proc.emit("close", 0, null);
          });
          cb();
        },
      });
      proc.stdin = stdin;
      proc.stdout = out;
      proc.stderr = err;
      proc.kill = (() => true) as ChildProcess["kill"];
      if (currentSpawn === 1) {
        firstProc = proc;
      }
      return proc;
    };
    const session = new PersistentKatagoAnalysisSession({
      env: {
        KATAGO_BINARY_PATH: "/fake/katago",
        KATAGO_CONFIG_PATH: "/fake/cfg",
        KATAGO_MODEL_PATH: "/fake/model.bin.gz",
      },
      spawnFn,
    });

    const first = session.analyzeLine({
      queryLine: `${JSON.stringify({ id: "crash-1" })}\n`,
      expectedId: "crash-1",
      timeoutMs: 30_000,
    });
    const second = session.analyzeLine({
      queryLine: `${JSON.stringify({ id: "crash-2" })}\n`,
      expectedId: "crash-2",
      timeoutMs: 30_000,
    });
    expect(session.pendingCount).toBe(2);
    firstProc!.emit("close", 9, null);

    const crashed = await Promise.allSettled([first, second]);
    expect(crashed.every(result => result.status === "rejected")).toBe(true);
    expect(
      crashed
        .map(result =>
          result.status === "rejected" ? String(result.reason) : ""
        )
        .join(" ")
    ).toContain("crash-1");
    expect(session.pendingCount).toBe(0);
    expect(session.isClosed).toBe(true);

    const recovered = await session.analyzeLine({
      queryLine: `${JSON.stringify({ id: "recovered" })}\n`,
      expectedId: "recovered",
      timeoutMs: 30_000,
    });
    expect(recovered.id).toBe("recovered");
    expect(spawnCount).toBe(2);
    await session.close();
  });
});

describe("runKatagoPersistentBenchmark", () => {
  it("compares spawn baseline with persistent mode and writes reports", async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "katago-persistent-benchmark-")
    );
    const sgfPath = path.join(dir, "game.sgf");
    await writeFile(sgfPath, "(;FF[4]GM[1]SZ[19]KM[6.5];B[pd];W[dd])", "utf8");
    const { spawnFn, spawnCount } = createMockPersistentSpawn();

    const report = await runKatagoPersistentBenchmark({
      sgfPaths: [sgfPath],
      cwd: dir,
      outDir: path.join(dir, "out"),
      repeat: 2,
      env: {
        KATAGO_BINARY_PATH: "/fake/katago",
        KATAGO_CONFIG_PATH: "/fake/cfg",
        KATAGO_MODEL_PATH: "/fake/model.bin.gz",
        KATAGO_MAX_VISITS: "25",
      },
      spawnFn,
    });

    expect(report.passed).toBe(true);
    expect(report.rows).toHaveLength(2);
    expect(report.totals.spawnPassed).toBe(2);
    expect(report.totals.persistentPassed).toBe(2);
    expect(report.stats.persistentDurationMs.count).toBe(2);
    expect(spawnCount()).toBe(3);
    expect(await readFile(report.markdownPath, "utf8")).toContain(
      "KataGo Persistent Benchmark"
    );
  });
});

describe("buildDurationStats", () => {
  it("uses nearest-rank percentiles", () => {
    expect(buildDurationStats([300, 100, 200, 400])).toMatchObject({
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
