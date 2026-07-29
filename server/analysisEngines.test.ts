import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyzeSgfKatago,
  analyzeSgfKatagoStub,
  analyzeSgfMock,
  assertKatagoPathsConfiguredOrThrow,
  closeSharedPersistentRootSessionForTests,
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

function makePersistentKatagoSpawn(
  opts: {
    failFirstQuery?: boolean;
    stderr?: string;
  } = {}
): {
  spawn: SpawnFn;
  getSpawnCount: () => number;
  getQueryCount: () => number;
} {
  let spawnCount = 0;
  let queryCount = 0;

  const spawn: SpawnFn = (_cmd, args, _o) => {
    spawnCount += 1;
    expect(args.includes("-sgf")).toBe(false);
    expect(args[0]).toBe("analysis");

    const proc = new EventEmitter() as ChildProcess;
    const out = new PassThrough();
    const err = new PassThrough();
    let buffer = "";

    function respondToLine(line: string): void {
      if (!line.trim()) {
        return;
      }
      queryCount += 1;
      if (opts.failFirstQuery === true && queryCount === 1) {
        setImmediate(() => {
          proc.emit("error", new Error("mock persistent root failure"));
        });
        return;
      }
      const parsed = JSON.parse(line) as { id?: string };
      const response = {
        id: parsed.id ?? `mock-${String(queryCount)}`,
        rootInfo: { winrate: 0.55, scoreLead: 1.1 },
        moveInfos: [{ move: "Q16", winrate: 0.56 }],
      };
      setImmediate(() => {
        out.write(`${JSON.stringify(response)}\n`, "utf8");
      });
    }

    const stdin = new Writable({
      write(chunk: Buffer | string, _enc, cb) {
        buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        for (;;) {
          const newline = buffer.indexOf("\n");
          if (newline < 0) {
            break;
          }
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          respondToLine(line);
        }
        cb();
      },
      final(cb) {
        if (buffer.trim()) {
          respondToLine(buffer);
          buffer = "";
        }
        setImmediate(() => {
          out.end();
          err.end(opts.stderr ?? "", "utf8");
          proc.emit("close", 0, null);
        });
        cb();
      },
    });

    proc.stdin = stdin;
    proc.stdout = out;
    proc.stderr = err;
    proc.kill = ((signal?: NodeJS.Signals | number) => {
      setImmediate(() => {
        out.end();
        err.end(opts.stderr ?? "", "utf8");
        proc.emit("close", 0, signal ?? null);
      });
      return true;
    }) as ChildProcess["kill"];

    return proc;
  };

  return {
    spawn,
    getSpawnCount: () => spawnCount,
    getQueryCount: () => queryCount,
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
    process.env.KATAGO_REPORT_ANALYSIS_WINRATES_AS_EXPECTED = "BLACK";
    process.env.KATAGO_MULTI_TURN_MAX = "0";
    process.env.KATAGO_DEEP_SEARCH_ENABLED = "false";
    process.env.KATAGO_WINRATE_TIMELINE_ENABLED = "false";
    delete process.env.KATAGO_PERSISTENT_ROOT_ENABLED;
    delete process.env.KATAGO_PERSISTENT_ROOT_STRICT;
    delete process.env.KATAGO_PERSISTENT_ROOT_IDLE_CLOSE_MS;
    delete process.env.KATAGO_PERSISTENT_MULTI_TURN_ENABLED;
    delete process.env.KATAGO_PERSISTENT_MULTI_TURN_STRICT;
  });

  afterEach(async () => {
    await closeSharedPersistentRootSessionForTests();
    process.env.KATAGO_BINARY_PATH = saved.KATAGO_BINARY_PATH;
    process.env.KATAGO_CONFIG_PATH = saved.KATAGO_CONFIG_PATH;
    process.env.KATAGO_MODEL_PATH = saved.KATAGO_MODEL_PATH;
    process.env.KATAGO_MAX_VISITS = saved.KATAGO_MAX_VISITS;
    process.env.KATAGO_ANALYSIS_TIMEOUT_MS = saved.KATAGO_ANALYSIS_TIMEOUT_MS;
    if (saved.KATAGO_REPORT_ANALYSIS_WINRATES_AS_EXPECTED === undefined) {
      delete process.env.KATAGO_REPORT_ANALYSIS_WINRATES_AS_EXPECTED;
    } else {
      process.env.KATAGO_REPORT_ANALYSIS_WINRATES_AS_EXPECTED =
        saved.KATAGO_REPORT_ANALYSIS_WINRATES_AS_EXPECTED;
    }
    if (saved.KATAGO_MULTI_TURN_MAX === undefined) {
      delete process.env.KATAGO_MULTI_TURN_MAX;
    } else {
      process.env.KATAGO_MULTI_TURN_MAX = saved.KATAGO_MULTI_TURN_MAX;
    }
    if (saved.KATAGO_DEEP_SEARCH_ENABLED === undefined) {
      delete process.env.KATAGO_DEEP_SEARCH_ENABLED;
    } else {
      process.env.KATAGO_DEEP_SEARCH_ENABLED = saved.KATAGO_DEEP_SEARCH_ENABLED;
    }
    if (saved.KATAGO_WINRATE_TIMELINE_ENABLED === undefined) {
      delete process.env.KATAGO_WINRATE_TIMELINE_ENABLED;
    } else {
      process.env.KATAGO_WINRATE_TIMELINE_ENABLED =
        saved.KATAGO_WINRATE_TIMELINE_ENABLED;
    }
    if (saved.KATAGO_PERSISTENT_ROOT_ENABLED === undefined) {
      delete process.env.KATAGO_PERSISTENT_ROOT_ENABLED;
    } else {
      process.env.KATAGO_PERSISTENT_ROOT_ENABLED =
        saved.KATAGO_PERSISTENT_ROOT_ENABLED;
    }
    if (saved.KATAGO_PERSISTENT_ROOT_STRICT === undefined) {
      delete process.env.KATAGO_PERSISTENT_ROOT_STRICT;
    } else {
      process.env.KATAGO_PERSISTENT_ROOT_STRICT =
        saved.KATAGO_PERSISTENT_ROOT_STRICT;
    }
    if (saved.KATAGO_PERSISTENT_ROOT_IDLE_CLOSE_MS === undefined) {
      delete process.env.KATAGO_PERSISTENT_ROOT_IDLE_CLOSE_MS;
    } else {
      process.env.KATAGO_PERSISTENT_ROOT_IDLE_CLOSE_MS =
        saved.KATAGO_PERSISTENT_ROOT_IDLE_CLOSE_MS;
    }
    if (saved.KATAGO_PERSISTENT_MULTI_TURN_ENABLED === undefined) {
      delete process.env.KATAGO_PERSISTENT_MULTI_TURN_ENABLED;
    } else {
      process.env.KATAGO_PERSISTENT_MULTI_TURN_ENABLED =
        saved.KATAGO_PERSISTENT_MULTI_TURN_ENABLED;
    }
    if (saved.KATAGO_PERSISTENT_MULTI_TURN_STRICT === undefined) {
      delete process.env.KATAGO_PERSISTENT_MULTI_TURN_STRICT;
    } else {
      process.env.KATAGO_PERSISTENT_MULTI_TURN_STRICT =
        saved.KATAGO_PERSISTENT_MULTI_TURN_STRICT;
    }
    stdinCaptured = "";
  });

  const sgf =
    "(;FF[4]GM[1]SZ[19]PB[Black Root]PW[White Root]DT[2026-07-29]RE[w+resign];B[pd];W[dd])";

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
          stdinCaptured +=
            typeof chunk === "string" ? chunk : chunk.toString("utf8");
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
    expect(r.game_info).toEqual({
      metadata_version: "sgf-game-info-v1",
      black_player: "Black Root",
      white_player: "White Root",
      date: "2026-07-29",
      total_moves: 2,
      result: "W+R",
      result_raw: "w+resign",
      metadata_warnings: [{ field: "RE", code: "noncanonical_format" }],
      komi: 6.5,
    });
    expect(r.engine as Record<string, unknown>).toMatchObject({
      maxVisits: 40,
      winratePerspective: "black",
      winratePerspectiveSource: "expected_only",
    });
    expect(r.katagoRootBlackWinrate).toBe(52);
    expect(r.katagoRootWhiteWinrate).toBe(48);
    const phases = (
      r.engine as {
        phaseDurationsMs?: Record<string, number | null>;
      }
    ).phaseDurationsMs;
    expect(phases).toMatchObject({
      totalBeforeQualityGate: expect.any(Number),
      rootStage: expect.any(Number),
      multiTurn: expect.any(Number),
      signalPlanning: expect.any(Number),
      deepSearch: expect.any(Number),
      winrateTimeline: expect.any(Number),
    });
    expect(r.top_mistakes).toEqual([]);
    const algo = r.algorithmStage as {
      notYetImplemented: string[];
      implemented?: string[];
    };
    expect(algo.implemented).toContain("bsi_v1");
    expect(algo.notYetImplemented).not.toContain("bsi");
    expect(algo.implemented).toContain("deep_search_results_v1");
    expect(algo.notYetImplemented).toContain("llm_commentary");
    const ds = r.deepSearchResults as
      | { enabled?: boolean; version?: string }
      | undefined;
    expect(ds?.version).toBe("deep-search-results-v1");
    expect(ds?.enabled).toBe(false);

    const q = JSON.parse(stdinCaptured.trim()) as {
      maxVisits: number;
      moves: [string, string][];
    };
    expect(q.maxVisits).toBe(40);
    expect(q.moves).toEqual([
      ["B", "Q16"],
      ["W", "D16"],
    ]);

    const kat = r.katago as {
      hasWinrate: boolean;
      hasScoreLead: boolean;
      moveInfosCount: number;
    };
    expect(kat.hasWinrate).toBe(true);
    expect(kat.hasScoreLead).toBe(true);
    expect(kat.moveInfosCount).toBe(1);
  });

  it("reuses one persistent root KataGo process when enabled", async () => {
    process.env.KATAGO_BINARY_PATH = "/x/katago";
    process.env.KATAGO_CONFIG_PATH = "/x/cfg";
    process.env.KATAGO_MODEL_PATH = "/x/model";
    process.env.KATAGO_MAX_VISITS = "40";
    process.env.KATAGO_ANALYSIS_TIMEOUT_MS = "8000";
    process.env.KATAGO_MULTI_TURN_MAX = "0";
    process.env.KATAGO_PERSISTENT_ROOT_ENABLED = "true";

    const mock = makePersistentKatagoSpawn();

    const first = (await analyzeSgfKatago({
      jobId: "persistent-job-1",
      sgfContent: sgf,
      language: "ko",
      maxVisits: 40,
      fileName: "g1.sgf",
      __testSpawnFn: mock.spawn,
    })) as Record<string, unknown>;
    const second = (await analyzeSgfKatago({
      jobId: "persistent-job-2",
      sgfContent: sgf,
      language: "ko",
      maxVisits: 40,
      fileName: "g2.sgf",
      __testSpawnFn: mock.spawn,
    })) as Record<string, unknown>;

    expect(mock.getSpawnCount()).toBe(1);
    expect(mock.getQueryCount()).toBe(2);
    expect(
      (first.engine as { rootAnalysisMode?: string }).rootAnalysisMode
    ).toBe("persistent");
    expect(
      (second.engine as { rootAnalysisMode?: string }).rootAnalysisMode
    ).toBe("persistent");
    expect(
      (first.algorithmStage as { implemented?: string[] }).implemented
    ).toContain("persistent_root_katago_v1");
  });

  it("reuses the root process for persistent multi-turn queries", async () => {
    process.env.KATAGO_BINARY_PATH = "/x/katago";
    process.env.KATAGO_CONFIG_PATH = "/x/cfg";
    process.env.KATAGO_MODEL_PATH = "/x/model";
    process.env.KATAGO_MAX_VISITS = "40";
    process.env.KATAGO_ANALYSIS_TIMEOUT_MS = "8000";
    process.env.KATAGO_MULTI_TURN_MAX = "2";
    process.env.KATAGO_PERSISTENT_ROOT_ENABLED = "true";
    process.env.KATAGO_PERSISTENT_ROOT_STRICT = "true";
    process.env.KATAGO_PERSISTENT_MULTI_TURN_ENABLED = "true";
    process.env.KATAGO_PERSISTENT_MULTI_TURN_STRICT = "true";

    const mock = makePersistentKatagoSpawn();
    const result = (await analyzeSgfKatago({
      jobId: "persistent-root-and-multi-job",
      sgfContent: sgf,
      language: "ko",
      maxVisits: 40,
      fileName: "persistent-all.sgf",
      __testSpawnFn: mock.spawn,
    })) as Record<string, unknown>;

    const multiTurn = result.multiTurnAnalysis as {
      executionMode?: string;
      attemptedCount: number;
      persistentAttemptedCount?: number;
      persistentFailedCount?: number;
      fallbackAttemptedCount?: number;
      completedCount: number;
    };
    expect(mock.getSpawnCount()).toBe(1);
    expect(multiTurn.attemptedCount).toBeGreaterThan(0);
    expect(mock.getQueryCount()).toBe(1 + multiTurn.attemptedCount);
    expect(
      (result.engine as { multiTurnAnalysisMode?: string })
        .multiTurnAnalysisMode
    ).toBe("persistent");
    expect(multiTurn).toMatchObject({
      executionMode: "persistent",
      persistentAttemptedCount: multiTurn.attemptedCount,
      persistentFailedCount: 0,
      fallbackAttemptedCount: 0,
      completedCount: multiTurn.attemptedCount,
    });
    expect(
      (result.algorithmStage as { implemented?: string[] }).implemented
    ).toContain("persistent_multi_turn_katago_v1");
  });

  it("falls back to spawn root when persistent root fails and strict mode is off", async () => {
    process.env.KATAGO_BINARY_PATH = "/x/katago";
    process.env.KATAGO_CONFIG_PATH = "/x/cfg";
    process.env.KATAGO_MODEL_PATH = "/x/model";
    process.env.KATAGO_MAX_VISITS = "40";
    process.env.KATAGO_ANALYSIS_TIMEOUT_MS = "8000";
    process.env.KATAGO_MULTI_TURN_MAX = "0";
    process.env.KATAGO_PERSISTENT_ROOT_ENABLED = "true";

    const mock = makePersistentKatagoSpawn({ failFirstQuery: true });

    const r = (await analyzeSgfKatago({
      jobId: "persistent-fallback-job",
      sgfContent: sgf,
      language: "ko",
      maxVisits: 40,
      fileName: "fallback.sgf",
      __testSpawnFn: mock.spawn,
    })) as Record<string, unknown>;

    const engine = r.engine as {
      rootAnalysisMode?: string;
      rootAnalysisFallbackReason?: string;
    };
    expect(r.ok).toBe(true);
    expect(mock.getSpawnCount()).toBe(2);
    expect(engine.rootAnalysisMode).toBe("persistent_fallback_spawn");
    expect(engine.rootAnalysisFallbackReason).toContain(
      "mock persistent root failure"
    );
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
        __testSpawnFn: makeMockKatagoSpawn({
          stdout,
          exitCode: 2,
          stderr: "fatal error line",
        }),
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
    process.env.KATAGO_ANALYSIS_TIMEOUT_MS = "30000";

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
    await vi.advanceTimersByTimeAsync(30_150);
    await expectation;
    await vi.runAllTimersAsync();
  });
});
