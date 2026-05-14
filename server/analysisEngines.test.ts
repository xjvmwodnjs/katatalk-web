import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyzeSgfKatago,
  analyzeSgfKatagoStub,
  analyzeSgfMock,
  assertKatagoPathsConfiguredOrThrow,
  getAnalysisEngineName,
} from "./worker/analysisEngines";
import type { SpawnFn } from "./worker/analysisEngines/katagoSmokeRun";
import { runKatagoWorkerAnalysisV1 } from "./worker/analysisEngines/katagoSmokeRun";

function makeMockKatagoSpawn(opts: {
  stdout: string;
  exitCode: number;
  stderr?: string;
  /** stdout 을 닫지 않아 timeout 이 먼저 나게 함; kill 시에만 close */
  hangStdout?: boolean;
}): SpawnFn {
  return (_cmd, args, _o) => {
    expect(args.includes("-sgf")).toBe(false);
    expect(args[0]).toBe("analysis");

    const proc = new EventEmitter() as ChildProcess;
    const out = new PassThrough();
    const err = new PassThrough();

    const stdin = new Writable({
      write(_c, _e, cb) {
        cb();
      },
      final(cb) {
        if (!opts.hangStdout) {
          setImmediate(() => {
            out.end(opts.stdout, "utf8");
            err.end(opts.stderr ?? "", "utf8");
            setImmediate(() => {
              proc.emit("close", opts.exitCode, null);
            });
          });
        }
        cb();
      },
    });

    proc.stdin = stdin;
    proc.stdout = out;
    proc.stderr = err;

    proc.kill = ((signal?: NodeJS.Signals | number) => {
      if (opts.hangStdout && (signal === "SIGTERM" || signal === "SIGKILL")) {
        try {
          out.end(opts.stdout || "", "utf8");
          err.end(opts.stderr ?? "", "utf8");
        } catch {
          /* ignore */
        }
        setImmediate(() => {
          proc.emit("close", opts.exitCode, signal ?? null);
        });
        return true;
      }
      return true;
    }) as ChildProcess["kill"];

    return proc;
  };
}

describe("analysis engines config", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env.ANALYSIS_ENGINE = saved.ANALYSIS_ENGINE;
    process.env.KATAGO_BINARY_PATH = saved.KATAGO_BINARY_PATH;
    process.env.KATAGO_CONFIG_PATH = saved.KATAGO_CONFIG_PATH;
    process.env.KATAGO_MODEL_PATH = saved.KATAGO_MODEL_PATH;
  });

  it("defaults ANALYSIS_ENGINE to mock", () => {
    delete process.env.ANALYSIS_ENGINE;
    expect(getAnalysisEngineName()).toBe("mock");
  });

  it("respects ANALYSIS_ENGINE=katago", () => {
    process.env.ANALYSIS_ENGINE = "katago";
    expect(getAnalysisEngineName()).toBe("katago");
  });

  it("assertKatagoPathsConfiguredOrThrow fails when paths missing", () => {
    process.env.ANALYSIS_ENGINE = "katago";
    delete process.env.KATAGO_BINARY_PATH;
    delete process.env.KATAGO_CONFIG_PATH;
    delete process.env.KATAGO_MODEL_PATH;
    expect(() => assertKatagoPathsConfiguredOrThrow()).toThrow(/KATAGO/);
  });

  it("assertKatagoPathsConfiguredOrThrow passes when paths set", () => {
    process.env.KATAGO_BINARY_PATH = "/bin/katago";
    process.env.KATAGO_CONFIG_PATH = "/cfg.cfg";
    process.env.KATAGO_MODEL_PATH = "/model.bin.gz";
    expect(() => assertKatagoPathsConfiguredOrThrow()).not.toThrow();
  });
});

describe("analyzeSgfMock", () => {
  it("returns mock-shaped result", async () => {
    const r = await analyzeSgfMock({
      jobId: "j1",
      sgfContent: null,
      language: "ko",
      maxVisits: 50,
      fileName: "f.sgf",
    });
    expect((r as { source?: { mock?: boolean } }).source?.mock).toBe(true);
  });
});

describe("analyzeSgfKatago (worker v1)", () => {
  const saved = { ...process.env };
  let stdinCaptured = "";

  beforeEach(() => {
    process.env.KATAGO_MULTI_TURN_MAX = "0";
  });

  afterEach(() => {
    process.env.KATAGO_BINARY_PATH = saved.KATAGO_BINARY_PATH;
    process.env.KATAGO_CONFIG_PATH = saved.KATAGO_CONFIG_PATH;
    process.env.KATAGO_MODEL_PATH = saved.KATAGO_MODEL_PATH;
    process.env.KATAGO_MAX_VISITS = saved.KATAGO_MAX_VISITS;
    process.env.KATAGO_ANALYSIS_TIMEOUT_MS = saved.KATAGO_ANALYSIS_TIMEOUT_MS;
    if (saved.KATAGO_MULTI_TURN_MAX === undefined) {
      delete process.env.KATAGO_MULTI_TURN_MAX;
    } else {
      process.env.KATAGO_MULTI_TURN_MAX = saved.KATAGO_MULTI_TURN_MAX;
    }
    stdinCaptured = "";
  });

  const sgf = "(;FF[4]GM[1]SZ[19];B[pd];W[dd])";

  it("throws KATAGO_ENV_MISSING when paths unset", async () => {
    delete process.env.KATAGO_BINARY_PATH;
    await expect(
      analyzeSgfKatago({
        jobId: "j",
        sgfContent: sgf,
        language: "ko",
        maxVisits: 1,
        fileName: "x.sgf",
      })
    ).rejects.toThrow(/KATAGO_ENV_MISSING/);
  });

  it("mock spawn: stdin JSON query, stdout JSON → result ok + katago-worker-v1", async () => {
    process.env.KATAGO_BINARY_PATH = "/x/katago";
    process.env.KATAGO_CONFIG_PATH = "/x/cfg";
    process.env.KATAGO_MODEL_PATH = "/x/model";
    process.env.KATAGO_MAX_VISITS = "40";
    process.env.KATAGO_ANALYSIS_TIMEOUT_MS = "8000";
    process.env.KATAGO_MULTI_TURN_MAX = "0";

    const stdout = JSON.stringify({
      rootInfo: { winrate: 0.52, scoreLead: 0.4 },
      moveInfos: [{ move: "Q16", winrate: 0.53 }],
    });

    const mockSpawn: SpawnFn = (_cmd, args, _opts) => {
      const proc = new EventEmitter() as ChildProcess;
      const out = new PassThrough();
      const err = new PassThrough();
      const stdin = new Writable({
        write(chunk: Buffer | string, _enc, cb) {
          stdinCaptured += typeof chunk === "string" ? chunk : chunk.toString("utf8");
          cb();
        },
        final(cb) {
          setImmediate(() => {
            out.end(stdout, "utf8");
            err.end();
          });
          cb();
        },
      });
      proc.stdin = stdin;
      proc.stdout = out;
      proc.stderr = err;
      out.on("end", () => {
        setImmediate(() => {
          proc.emit("close", 0, null);
        });
      });
      return proc;
    };

    const r = (await analyzeSgfKatago({
      jobId: "job-99",
      sgfContent: sgf,
      language: "ko",
      maxVisits: 40,
      fileName: "g.sgf",
      __testSpawnFn: mockSpawn,
    })) as Record<string, unknown>;

    expect(r.source).toBe("katago-worker-v1");
    expect(r.ok).toBe(true);
    expect((r.engine as { maxVisits: number }).maxVisits).toBe(40);
    expect(r.top_mistakes).toEqual([]);
    const algo = r.algorithmStage as { notYetImplemented: string[]; implemented?: string[] };
    expect(algo.implemented).toContain("bsi_v1");
    expect(algo.notYetImplemented).not.toContain("bsi");
    expect(algo.implemented).toContain("deep_search_results_v1");
    expect(algo.notYetImplemented).toContain("llm_commentary");
    const ds = r.deepSearchResults as { enabled?: boolean; version?: string } | undefined;
    expect(ds?.version).toBe("deep-search-results-v1");
    expect(ds?.enabled).toBe(false);

    const q = JSON.parse(stdinCaptured.trim()) as { maxVisits: number; moves: [string, string][] };
    expect(q.maxVisits).toBe(40);
    expect(q.moves).toEqual([
      ["B", "Q16"],
      ["W", "D16"],
    ]);

    const kat = r.katago as { hasWinrate: boolean; hasScoreLead: boolean; moveInfosCount: number };
    expect(kat.hasWinrate).toBe(true);
    expect(kat.hasScoreLead).toBe(true);
    expect(kat.moveInfosCount).toBe(1);
  });

  it("scoreMean fallback satisfies score requirement", async () => {
    process.env.KATAGO_BINARY_PATH = "/x/katago";
    process.env.KATAGO_CONFIG_PATH = "/x/cfg";
    process.env.KATAGO_MODEL_PATH = "/x/model";

    const stdout = JSON.stringify({
      rootInfo: { winrate: 0.4, scoreMean: 1.2 },
      moveInfos: [{ move: "A1", winrate: 0.41 }],
    });

    const r = (await analyzeSgfKatago({
      jobId: "j2",
      sgfContent: sgf,
      language: "ko",
      maxVisits: 10,
      fileName: "g.sgf",
      __testSpawnFn: makeMockKatagoSpawn({ stdout, exitCode: 0 }),
    })) as Record<string, unknown>;

    expect(r.source).toBe("katago-worker-v1");
    expect((r.katago as { hasScoreLead: boolean }).hasScoreLead).toBe(true);
  });

  it("KATAGO_OUTPUT_INCOMPLETE when rootInfo empty", async () => {
    process.env.KATAGO_BINARY_PATH = "/x/katago";
    process.env.KATAGO_CONFIG_PATH = "/x/cfg";
    process.env.KATAGO_MODEL_PATH = "/x/model";

    const stdout = JSON.stringify({
      rootInfo: {},
      moveInfos: [{ move: "Q16", winrate: 0.5 }],
    });

    await expect(
      analyzeSgfKatago({
        jobId: "j3",
        sgfContent: sgf,
        language: "ko",
        maxVisits: 10,
        fileName: "g.sgf",
        __testSpawnFn: makeMockKatagoSpawn({ stdout, exitCode: 0 }),
      })
    ).rejects.toThrow(/KATAGO_OUTPUT_INCOMPLETE: rootInfo/);
  });

  it("KATAGO_OUTPUT_INCOMPLETE when moveInfos empty", async () => {
    process.env.KATAGO_BINARY_PATH = "/x/katago";
    process.env.KATAGO_CONFIG_PATH = "/x/cfg";
    process.env.KATAGO_MODEL_PATH = "/x/model";

    const stdout = JSON.stringify({
      rootInfo: { winrate: 0.5, scoreLead: 0.1 },
      moveInfos: [],
    });

    await expect(
      analyzeSgfKatago({
        jobId: "j4",
        sgfContent: sgf,
        language: "ko",
        maxVisits: 10,
        fileName: "g.sgf",
        __testSpawnFn: makeMockKatagoSpawn({ stdout, exitCode: 0 }),
      })
    ).rejects.toThrow(/KATAGO_OUTPUT_INCOMPLETE: moveInfos/);
  });

  it("KATAGO_EXIT_NONZERO on bad exit", async () => {
    process.env.KATAGO_BINARY_PATH = "/x/katago";
    process.env.KATAGO_CONFIG_PATH = "/x/cfg";
    process.env.KATAGO_MODEL_PATH = "/x/model";

    const stdout = JSON.stringify({
      rootInfo: { winrate: 0.5, scoreLead: 0.1 },
      moveInfos: [{ move: "A1", winrate: 0.51 }],
    });

    await expect(
      analyzeSgfKatago({
        jobId: "j5",
        sgfContent: sgf,
        language: "ko",
        maxVisits: 10,
        fileName: "g.sgf",
        __testSpawnFn: makeMockKatagoSpawn({ stdout, exitCode: 2, stderr: "fatal error line" }),
      })
    ).rejects.toThrow(/KATAGO_EXIT_NONZERO/);
  });

  it("KATAGO_OUTPUT_INVALID on garbage stdout", async () => {
    process.env.KATAGO_BINARY_PATH = "/x/katago";
    process.env.KATAGO_CONFIG_PATH = "/x/cfg";
    process.env.KATAGO_MODEL_PATH = "/x/model";

    await expect(
      analyzeSgfKatago({
        jobId: "j6",
        sgfContent: sgf,
        language: "ko",
        maxVisits: 10,
        fileName: "g.sgf",
        __testSpawnFn: makeMockKatagoSpawn({ stdout: "not-json", exitCode: 0 }),
      })
    ).rejects.toThrow(/KATAGO_OUTPUT_INVALID/);
  });

  it("analyzeSgfKatagoStub is alias of analyzeSgfKatago", () => {
    expect(analyzeSgfKatagoStub).toBe(analyzeSgfKatago);
  });
});

describe("runKatagoWorkerAnalysisV1 timeout + SIGKILL fallback", () => {
  const saved = { ...process.env };

  afterEach(() => {
    vi.useRealTimers();
    process.env.KATAGO_BINARY_PATH = saved.KATAGO_BINARY_PATH;
    process.env.KATAGO_CONFIG_PATH = saved.KATAGO_CONFIG_PATH;
    process.env.KATAGO_MODEL_PATH = saved.KATAGO_MODEL_PATH;
    process.env.KATAGO_ANALYSIS_TIMEOUT_MS = saved.KATAGO_ANALYSIS_TIMEOUT_MS;
  });

  it("rejects with KATAGO_TIMEOUT and kill terminates hung process", async () => {
    vi.useFakeTimers();
    process.env.KATAGO_BINARY_PATH = "/x/katago";
    process.env.KATAGO_CONFIG_PATH = "/x/cfg";
    process.env.KATAGO_MODEL_PATH = "/x/model";
    process.env.KATAGO_ANALYSIS_TIMEOUT_MS = "100";

    const sgf = "(;FF[4]GM[1]SZ[19];B[pd])";
    const p = runKatagoWorkerAnalysisV1({
      sgfContent: sgf,
      jobId: "timeout-job",
      env: process.env,
      spawnFn: makeMockKatagoSpawn({
        stdout: JSON.stringify({
          rootInfo: { winrate: 0.5, scoreLead: 0.1 },
          moveInfos: [{ move: "A1", winrate: 0.51 }],
        }),
        exitCode: 0,
        hangStdout: true,
      }),
    });

    const expectation = expect(p).rejects.toThrow(/KATAGO_TIMEOUT/);
    await vi.advanceTimersByTimeAsync(250);
    await expectation;
    await vi.runAllTimersAsync();
  });
});
