import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAnalysisResultViewModel,
  buildWinrateSeriesPreferTimeline,
} from "@shared/analysisResultViewModel";
import {
  buildAnalyzeTurnNumbers,
  buildAnalyzeTurnsAllMoves,
  readWinrateTimelineEnabledFrom,
  readWinrateTimelineVisitsFrom,
} from "./worker/analysisEngines/winrateTimelineConfig";
import {
  buildKatagoAnalyzeTurnsQueryLine,
  runKatagoWinrateTimelineV1,
} from "./worker/analysisEngines/katagoWinrateTimelineRun";
import {
  collectFinalResponsesByTurnNumber,
  isKatagoFinalAnalyzeTurnResponse,
} from "./worker/analysisEngines/katagoAnalyzeTurnsCollector";
import { parseMinimalSgfForSmoke } from "./worker/analysisEngines/katagoSgfQuery";
import type { SpawnFn } from "./worker/analysisEngines/katagoSmokeRun";
import { analyzeSgfKatago } from "./worker/analysisEngines";
import {
  getAnalysisResultUiStrings,
  uiTextContainsForbiddenLabel,
} from "@shared/analysisResultI18n";
import {
  mergeWinrateTimelineProgressEventsV1,
  timelineMetaForTurnNumber,
} from "@shared/winrateTimelineV1";
import {
  appendWinrateTimelineProgressEventV1,
  readWinrateTimelineProgressV1,
  winrateTimelineProgressPathForJobV1,
} from "./winrateTimelineProgressV1";

const MINI_SGF = `(;SZ[19]KM[6.5];B[qd];W[dp];B[pq])`;

function makeTimelineStdout(lines: Record<string, unknown>[]): string {
  return `${lines.map(o => JSON.stringify(o)).join("\n")}\n`;
}

function makeKatagoSpawn(stdout: string, exitCode = 0): SpawnFn {
  return (_cmd, args) => {
    expect(args[0]).toBe("analysis");
    const proc = new EventEmitter() as ChildProcess;
    const out = new PassThrough();
    const err = new PassThrough();
    const stdin = new Writable({
      write(_c, _e, cb) {
        cb();
      },
      final(cb) {
        setImmediate(() => {
          out.end(stdout, "utf8");
          err.end("", "utf8");
          setImmediate(() => proc.emit("close", exitCode, null));
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
}

function progressEvent(overrides: {
  turnIndex?: number;
  isDuringSearch?: boolean;
  visits?: number | null;
  winrate?: number | null;
  receivedAt?: string;
}) {
  return {
    jobId: "progress-merge",
    turnIndex: overrides.turnIndex ?? 2,
    isDuringSearch: overrides.isDuringSearch ?? true,
    visits: overrides.visits ?? 10,
    winrate: overrides.winrate ?? 0.4,
    scoreLead: -1,
    currentPlayer: "B" as const,
    receivedAt: overrides.receivedAt ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("winrateTimelineConfig", () => {
  it("enabled=false by default", () => {
    expect(readWinrateTimelineEnabledFrom({})).toBe(false);
  });

  it("reads explicit false and keeps invalid values disabled", () => {
    expect(
      readWinrateTimelineEnabledFrom({
        KATAGO_WINRATE_TIMELINE_ENABLED: "false",
      })
    ).toBe(false);
    expect(
      readWinrateTimelineEnabledFrom({ KATAGO_WINRATE_TIMELINE_ENABLED: "0" })
    ).toBe(false);
    expect(
      readWinrateTimelineEnabledFrom({ KATAGO_WINRATE_TIMELINE_ENABLED: "off" })
    ).toBe(false);
    expect(
      readWinrateTimelineEnabledFrom({
        KATAGO_WINRATE_TIMELINE_ENABLED: "invalid",
      })
    ).toBe(false);
  });

  it("reads explicit true variants", () => {
    expect(
      readWinrateTimelineEnabledFrom({
        KATAGO_WINRATE_TIMELINE_ENABLED: "true",
      })
    ).toBe(true);
    expect(
      readWinrateTimelineEnabledFrom({ KATAGO_WINRATE_TIMELINE_ENABLED: "1" })
    ).toBe(true);
  });

  it("maxVisits defaults to 50", () => {
    expect(readWinrateTimelineVisitsFrom({})).toBe(50);
  });

  it("clamps visits to 1..2000", () => {
    expect(
      readWinrateTimelineVisitsFrom({ KATAGO_WINRATE_TIMELINE_VISITS: "0" })
    ).toBe(50);
    expect(
      readWinrateTimelineVisitsFrom({ KATAGO_WINRATE_TIMELINE_VISITS: "-5" })
    ).toBe(50);
    expect(
      readWinrateTimelineVisitsFrom({ KATAGO_WINRATE_TIMELINE_VISITS: "3000" })
    ).toBe(2000);
    expect(
      readWinrateTimelineVisitsFrom({ KATAGO_WINRATE_TIMELINE_VISITS: "200" })
    ).toBe(200);
    expect(
      readWinrateTimelineVisitsFrom({ KATAGO_WINRATE_TIMELINE_VISITS: "1" })
    ).toBe(1);
  });

  it("buildAnalyzeTurnNumbers covers 0..N", () => {
    expect(buildAnalyzeTurnNumbers(3, 300, true)).toEqual([0, 1, 2, 3]);
  });

  it("buildAnalyzeTurnNumbers handles empty game and maxTurns clamp", () => {
    expect(buildAnalyzeTurnNumbers(0, 300, true)).toEqual([0]);
    expect(buildAnalyzeTurnNumbers(5, 3, false)).toEqual([0, 1, 2, 3]);
  });

  it("buildAnalyzeTurnsAllMoves covers 0..N with maxTurns clamp", () => {
    expect(buildAnalyzeTurnsAllMoves(0, 300)).toEqual([0]);
    expect(buildAnalyzeTurnsAllMoves(3, 300)).toEqual([0, 1, 2, 3]);
    expect(buildAnalyzeTurnsAllMoves(5, 3)).toEqual([0, 1, 2, 3]);
  });
});

describe("isKatagoFinalAnalyzeTurnResponse", () => {
  it("accepts only isDuringSearch === false", () => {
    expect(
      isKatagoFinalAnalyzeTurnResponse({
        turnNumber: 1,
        isDuringSearch: false,
        rootInfo: { winrate: 0.5 },
      })
    ).toBe(true);
    expect(
      isKatagoFinalAnalyzeTurnResponse({
        turnNumber: 1,
        isDuringSearch: true,
        rootInfo: { winrate: 0.5 },
      })
    ).toBe(false);
    expect(
      isKatagoFinalAnalyzeTurnResponse({
        turnNumber: 1,
        rootInfo: { winrate: 0.5 },
      })
    ).toBe(false);
  });
});

describe("katagoAnalyzeTurnsCollector", () => {
  it("ignores isDuringSearch true and missing isDuringSearch", () => {
    const stdout = makeTimelineStdout([
      { turnNumber: 2, rootInfo: { winrate: 0.9 } },
      { turnNumber: 2, isDuringSearch: true, rootInfo: { winrate: 0.1 } },
      { turnNumber: 2, isDuringSearch: false, rootInfo: { winrate: 0.64 } },
    ]);
    const map = collectFinalResponsesByTurnNumber(stdout);
    expect(map.get(2)?.rootInfo).toMatchObject({ winrate: 0.64 });
    expect(map.has(2)).toBe(true);
  });

  it("missing turn stays absent for failed point mapping", () => {
    const stdout = makeTimelineStdout([
      { turnNumber: 0, isDuringSearch: false, rootInfo: { winrate: 0.5 } },
    ]);
    const map = collectFinalResponsesByTurnNumber(stdout);
    expect(map.has(1)).toBe(false);
  });

  it("matches by turnNumber and prefers final isDuringSearch false", () => {
    const stdout = makeTimelineStdout([
      { turnNumber: 1, isDuringSearch: true, rootInfo: { winrate: 0.1 } },
      {
        turnNumber: 1,
        isDuringSearch: false,
        rootInfo: {
          winrate: 0.64,
          scoreLead: 0.5,
          visits: 200,
          currentPlayer: "W",
        },
      },
      {
        turnNumber: 0,
        isDuringSearch: false,
        rootInfo: { winrate: 0.5, currentPlayer: "B" },
      },
    ]);
    const map = collectFinalResponsesByTurnNumber(stdout);
    expect(map.get(1)?.rootInfo).toMatchObject({ winrate: 0.64 });
    expect(map.get(0)?.rootInfo).toMatchObject({ winrate: 0.5 });
  });

  it("merges partial progress into final progress by turnNumber", () => {
    const merged = mergeWinrateTimelineProgressEventsV1([
      progressEvent({
        isDuringSearch: true,
        visits: 10,
        receivedAt: "2026-01-01T00:00:00.000Z",
      }),
      progressEvent({
        isDuringSearch: false,
        visits: 50,
        receivedAt: "2026-01-01T00:00:01.000Z",
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      turnIndex: 2,
      isDuringSearch: false,
      visits: 50,
    });
  });

  it("keeps final when a later partial arrives", () => {
    const merged = mergeWinrateTimelineProgressEventsV1([
      progressEvent({
        isDuringSearch: false,
        visits: 50,
        receivedAt: "2026-01-01T00:00:00.000Z",
      }),
      progressEvent({
        isDuringSearch: true,
        visits: 99,
        receivedAt: "2026-01-01T00:00:10.000Z",
      }),
    ]);
    expect(merged[0]).toMatchObject({ isDuringSearch: false, visits: 50 });
  });

  it("uses the latest partial for partial-only events", () => {
    const merged = mergeWinrateTimelineProgressEventsV1([
      progressEvent({
        isDuringSearch: true,
        visits: 10,
        receivedAt: "2026-01-01T00:00:00.000Z",
      }),
      progressEvent({
        isDuringSearch: true,
        visits: 20,
        receivedAt: "2026-01-01T00:00:01.000Z",
      }),
    ]);
    expect(merged[0]).toMatchObject({ isDuringSearch: true, visits: 20 });
  });

  it("uses the latest final for final-only events", () => {
    const merged = mergeWinrateTimelineProgressEventsV1([
      progressEvent({
        isDuringSearch: false,
        visits: 50,
        receivedAt: "2026-01-01T00:00:00.000Z",
      }),
      progressEvent({
        isDuringSearch: false,
        visits: 60,
        receivedAt: "2026-01-01T00:00:01.000Z",
      }),
    ]);
    expect(merged[0]).toMatchObject({ isDuringSearch: false, visits: 60 });
  });

  it("keeps final precedence for out-of-order and invalid receivedAt events", () => {
    const merged = mergeWinrateTimelineProgressEventsV1([
      progressEvent({
        turnIndex: 2,
        isDuringSearch: true,
        visits: 5,
        receivedAt: "not-a-date",
      }),
      progressEvent({
        turnIndex: 1,
        isDuringSearch: true,
        visits: 10,
        receivedAt: "2026-01-01T00:00:02.000Z",
      }),
      progressEvent({
        turnIndex: 1,
        isDuringSearch: false,
        visits: 50,
        receivedAt: "not-a-date",
      }),
      progressEvent({
        turnIndex: 1,
        isDuringSearch: true,
        visits: 99,
        receivedAt: "2026-01-01T00:00:03.000Z",
      }),
    ]);
    expect(merged.map(p => p.turnIndex)).toEqual([1, 2]);
    expect(merged[0]).toMatchObject({
      turnIndex: 1,
      isDuringSearch: false,
      visits: 50,
    });
    expect(merged[1]).toMatchObject({
      turnIndex: 2,
      isDuringSearch: true,
      visits: 5,
    });
  });

  it("merges repeated same-turn events deterministically", () => {
    const events = [
      progressEvent({
        isDuringSearch: true,
        visits: 1,
        receivedAt: "2026-01-01T00:00:00.000Z",
      }),
      progressEvent({
        isDuringSearch: false,
        visits: 3,
        receivedAt: "2026-01-01T00:00:02.000Z",
      }),
      progressEvent({
        isDuringSearch: true,
        visits: 2,
        receivedAt: "2026-01-01T00:00:03.000Z",
      }),
    ];
    expect(mergeWinrateTimelineProgressEventsV1(events)).toEqual(
      mergeWinrateTimelineProgressEventsV1(events)
    );
    expect(mergeWinrateTimelineProgressEventsV1(events)[0]).toMatchObject({
      isDuringSearch: false,
      visits: 3,
    });
  });

  it("orders timeline points by turnIndex after shuffled responses", async () => {
    const stdout = makeTimelineStdout([
      {
        turnNumber: 2,
        isDuringSearch: false,
        rootInfo: { winrate: 0.4, currentPlayer: "B" },
      },
      {
        turnNumber: 0,
        isDuringSearch: false,
        rootInfo: { winrate: 0.5, currentPlayer: "B" },
      },
      {
        turnNumber: 1,
        isDuringSearch: false,
        rootInfo: { winrate: 0.6, currentPlayer: "W" },
      },
    ]);
    const parsed = parseMinimalSgfForSmoke(MINI_SGF);
    const tl = await runKatagoWinrateTimelineV1({
      parsed,
      jobId: "sort",
      env: {
        KATAGO_WINRATE_TIMELINE_ENABLED: "true",
        KATAGO_BINARY_PATH: "/k",
        KATAGO_CONFIG_PATH: "/c",
        KATAGO_MODEL_PATH: "/m",
      },
      spawnFn: makeKatagoSpawn(stdout),
    });
    expect(tl.points.map(p => p.turnIndex)).toEqual([0, 1, 2, 3]);
  });
});

describe("buildKatagoAnalyzeTurnsQueryLine", () => {
  it("includes analyzeTurns 0..totalMoves and maxVisits 200", () => {
    const parsed = parseMinimalSgfForSmoke(MINI_SGF);
    const line = buildKatagoAnalyzeTurnsQueryLine({
      parsed,
      jobId: "j1",
      analyzeTurns: [0, 1, 2, 3],
      maxVisits: 200,
      analysisPVLen: 1,
      reportDuringSearchEverySeconds: 0.5,
    });
    const q = JSON.parse(line.trim()) as Record<string, unknown>;
    expect(q.rules).toBe(parsed.rules);
    expect(q.analyzeTurns).toEqual([0, 1, 2, 3]);
    expect(q.maxVisits).toBe(200);
    expect(q.analysisPVLen).toBe(1);
    expect(q.reportDuringSearchEvery).toBe(0.5);
    expect(q.includeOwnership).toBe(false);
    expect(q.includeMovesOwnership).toBe(false);
    expect(q.includePolicy).toBe(false);
  });

  it("includes initialStones for analyzeTurns queries", () => {
    const parsed = parseMinimalSgfForSmoke(
      "(;FF[4]GM[1]SZ[19]AB[pd]AW[dd];B[qq])"
    );
    const line = buildKatagoAnalyzeTurnsQueryLine({
      parsed,
      jobId: "j-setup",
      analyzeTurns: [0, 1],
      maxVisits: 200,
      analysisPVLen: 1,
      reportDuringSearchEverySeconds: 0.5,
    });
    const q = JSON.parse(line.trim()) as Record<string, unknown>;
    expect(q.initialStones).toEqual([
      ["B", "Q16"],
      ["W", "D16"],
    ]);
    expect(q.moves).toEqual([["B", "R3"]]);
    expect(q.analyzeTurns).toEqual([0, 1]);
  });
});

describe("timelineMetaForTurnNumber", () => {
  it("turnIndex N has movesBeforeCount N", () => {
    const parsed = parseMinimalSgfForSmoke(MINI_SGF);
    const m1 = timelineMetaForTurnNumber(1, parsed.moves, p =>
      p === "qd" ? "Q16" : "D4"
    );
    expect(m1.turnIndex).toBe(1);
    expect(m1.movesBeforeCount).toBe(1);
    expect(m1.player).toBe("B");
  });
});

describe("runKatagoWinrateTimelineV1", () => {
  it("does not run KataGo when disabled", async () => {
    const parsed = parseMinimalSgfForSmoke(MINI_SGF);
    let spawned = false;
    const tl = await runKatagoWinrateTimelineV1({
      parsed,
      jobId: "j",
      env: { KATAGO_WINRATE_TIMELINE_ENABLED: "false" },
      spawnFn: () => {
        spawned = true;
        throw new Error("should not spawn");
      },
    });
    expect(spawned).toBe(false);
    expect(tl.enabled).toBe(false);
    expect(tl.points).toEqual([]);
  });

  it("builds ok and failed points without throwing on partial missing", async () => {
    const parsed = parseMinimalSgfForSmoke(MINI_SGF);
    const stdout = makeTimelineStdout([
      {
        turnNumber: 0,
        isDuringSearch: false,
        rootInfo: {
          winrate: 0.51,
          scoreLead: 0.2,
          visits: 200,
          currentPlayer: "B",
        },
      },
      {
        turnNumber: 2,
        isDuringSearch: false,
        rootInfo: {
          winrate: 0.48,
          scoreLead: -0.1,
          visits: 200,
          currentPlayer: "B",
        },
      },
    ]);
    const tl = await runKatagoWinrateTimelineV1({
      parsed,
      jobId: "j",
      env: {
        KATAGO_WINRATE_TIMELINE_ENABLED: "true",
        KATAGO_WINRATE_TIMELINE_VISITS: "200",
        KATAGO_BINARY_PATH: "/k",
        KATAGO_CONFIG_PATH: "/c",
        KATAGO_MODEL_PATH: "/m",
      },
      spawnFn: makeKatagoSpawn(stdout),
    });
    expect(tl.enabled).toBe(true);
    expect(tl.completedCount).toBeGreaterThan(0);
    expect(tl.failedCount).toBeGreaterThan(0);
    expect(tl.partialFailure).toBe(true);
    const p0 = tl.points.find(p => p.turnIndex === 0);
    expect(p0?.rawWinrate).toBe(0.51);
    expect(p0?.displayWinrate).toBe(51);
    expect(p0?.scoreLead).toBe(0.2);
    expect(
      tl.points.every(
        p =>
          p.perspectiveStatus === "katago_output_only" || p.status === "failed"
      )
    ).toBe(true);
  });

  it("keeps a verified BLACK axis across setup stones, pass, and both players to move", async () => {
    const parsed = parseMinimalSgfForSmoke(
      "(;FF[4]GM[1]SZ[9]KM[0.5]AB[cc][gg];W[ee];B[];W[dd])"
    );
    const stdout = makeTimelineStdout([
      {
        turnNumber: 0,
        isDuringSearch: false,
        rootInfo: { winrate: 0.72, currentPlayer: "W" },
      },
      {
        turnNumber: 1,
        isDuringSearch: false,
        rootInfo: { winrate: 0.68, currentPlayer: "B" },
      },
      {
        turnNumber: 2,
        isDuringSearch: false,
        rootInfo: { winrate: 0.66, currentPlayer: "W" },
      },
      {
        turnNumber: 3,
        isDuringSearch: false,
        rootInfo: { winrate: 0.61, currentPlayer: "B" },
      },
    ]);
    const timeline = await runKatagoWinrateTimelineV1({
      parsed,
      jobId: "setup-pass-axis",
      winratePerspective: "black",
      env: {
        KATAGO_WINRATE_TIMELINE_ENABLED: "true",
        KATAGO_BINARY_PATH: "/k",
        KATAGO_CONFIG_PATH: "/c",
        KATAGO_MODEL_PATH: "/m",
      },
      spawnFn: makeKatagoSpawn(stdout),
    });

    expect(timeline.winratePerspective).toBe("black");
    expect(timeline.failedCount).toBe(0);
    expect(timeline.points.map(point => point.currentPlayer)).toEqual([
      "W",
      "B",
      "W",
      "B",
    ]);
    expect(
      timeline.points.every(
        point =>
          point.perspectiveStatus === "verified" &&
          point.displayWinrate === (point.rawWinrate ?? 0) * 100
      )
    ).toBe(true);
  });

  it("isolates local progress append failures with sanitized warning", async () => {
    const parsed = parseMinimalSgfForSmoke(MINI_SGF);
    const stdout = makeTimelineStdout([
      {
        turnNumber: 0,
        isDuringSearch: true,
        rootInfo: { winrate: 0.5, visits: 5, currentPlayer: "B" },
      },
      {
        turnNumber: 0,
        isDuringSearch: false,
        rootInfo: {
          winrate: 0.51,
          scoreLead: 0.2,
          visits: 50,
          currentPlayer: "B",
        },
      },
    ]);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    await expect(
      runKatagoWinrateTimelineV1({
        parsed,
        jobId: "appendfail",
        env: {
          NODE_ENV: "development",
          KATAGO_WINRATE_TIMELINE_ENABLED: "true",
          KATAGO_WINRATE_TIMELINE_LOCAL_PROGRESS: "true",
          KATAGO_BINARY_PATH: "SENSITIVE_BINARY_PATH_VALUE",
          KATAGO_CONFIG_PATH: "SENSITIVE_CONFIG_PATH_VALUE",
          KATAGO_MODEL_PATH: "SENSITIVE_MODEL_PATH_VALUE",
        },
        spawnFn: makeKatagoSpawn(stdout),
        progressAppendFn: async () => {
          throw new Error(
            "SENSITIVE_TOKEN_VALUE SGF_RAW_FRAGMENT SENSITIVE_BINARY_PATH_VALUE"
          );
        },
      })
    ).resolves.toMatchObject({ enabled: true });
    await new Promise<void>(resolve => setImmediate(resolve));
    const warningText = JSON.stringify(warnSpy.mock.calls);
    expect(warningText).toContain("progress append failed");
    expect(warningText).not.toContain("SENSITIVE_TOKEN_VALUE");
    expect(warningText).not.toContain("SGF_RAW_FRAGMENT");
    expect(warningText).not.toContain("SENSITIVE_BINARY_PATH_VALUE");
    warnSpy.mockRestore();
  });

  it("does not append progress when local progress is disabled", async () => {
    const parsed = parseMinimalSgfForSmoke(MINI_SGF);
    const stdout = makeTimelineStdout([
      {
        turnNumber: 0,
        isDuringSearch: true,
        rootInfo: { winrate: 0.5, visits: 5, currentPlayer: "B" },
      },
      {
        turnNumber: 0,
        isDuringSearch: false,
        rootInfo: {
          winrate: 0.51,
          scoreLead: 0.2,
          visits: 50,
          currentPlayer: "B",
        },
      },
    ]);
    let appendCalls = 0;
    await runKatagoWinrateTimelineV1({
      parsed,
      jobId: "appenddisabled",
      env: {
        NODE_ENV: "development",
        KATAGO_WINRATE_TIMELINE_ENABLED: "true",
        KATAGO_WINRATE_TIMELINE_LOCAL_PROGRESS: "false",
        KATAGO_BINARY_PATH: "/k",
        KATAGO_CONFIG_PATH: "/c",
        KATAGO_MODEL_PATH: "/m",
      },
      spawnFn: makeKatagoSpawn(stdout),
      progressAppendFn: async () => {
        appendCalls += 1;
      },
    });
    expect(appendCalls).toBe(0);
  });
});

describe("winrate timeline local progress transport", () => {
  it("writes safe progress events without SGF, path, or secret values", async () => {
    const jobId = `progresssafe${Date.now()}`;
    await appendWinrateTimelineProgressEventV1({
      jobId,
      turnIndex: 1,
      isDuringSearch: true,
      visits: 12,
      winrate: 0.52,
      scoreLead: 0.4,
      currentPlayer: "W",
      receivedAt: "2026-01-01T00:00:00.000Z",
    });
    const response = await readWinrateTimelineProgressV1(jobId);
    expect(response?.points[0]).toMatchObject({
      turnIndex: 1,
      isDuringSearch: true,
      visits: 12,
    });
    const filePath = winrateTimelineProgressPathForJobV1(jobId);
    expect(filePath).not.toBeNull();
    const raw = await import("node:fs/promises").then(fs =>
      fs.readFile(filePath!, "utf8")
    );
    expect(raw).not.toContain("(;GM[1]");
    expect(raw).not.toContain("PRIVATE_SECRET");
    expect(raw).not.toContain("C:/private");
  });
});

describe("buildWinrateSeriesPreferTimeline", () => {
  it("prefers timeline over sparse turnAnalyses", () => {
    const result = {
      winrateTimelineV1: {
        version: "winrate-timeline-v1",
        enabled: true,
        source: "katago-analyzeTurns",
        policy: {
          mode: "full-mainline-after-each-move",
          visits: 200,
          maxTurns: 300,
          analyzeTurnsCount: 2,
          timeoutMs: 600000,
          analysisPVLen: 1,
          includeFinal: true,
        },
        totalMoves: 1,
        attemptedCount: 2,
        completedCount: 2,
        failedCount: 0,
        partialFailure: false,
        allFailed: false,
        points: [
          {
            turnIndex: 0,
            turnNumber: 0,
            movesBeforeCount: 0,
            player: null,
            playedMove: null,
            status: "ok",
            rawWinrate: 0.5,
            displayWinrate: 50,
            scoreLead: 0,
            visits: 200,
            currentPlayer: "B",
            perspectiveStatus: "katago_output_only",
          },
          {
            turnIndex: 1,
            turnNumber: 1,
            movesBeforeCount: 1,
            player: "B",
            playedMove: "Q16",
            status: "ok",
            rawWinrate: 0.6,
            displayWinrate: 60,
            scoreLead: 1,
            visits: 200,
            currentPlayer: "W",
            perspectiveStatus: "katago_output_only",
          },
        ],
      },
      turnAnalyses: [
        {
          status: "ok",
          turnIndex: 99,
          player: "B",
          playedMove: "X",
          moveSummary: { played: { move: "X", winrate: 0.99 } },
        },
      ],
    };
    const { series, fromTimeline } = buildWinrateSeriesPreferTimeline(
      result,
      result.turnAnalyses as never,
      undefined
    );
    expect(fromTimeline).toBe(true);
    expect(series.map(p => p.turnIndex)).toEqual([0, 1]);
    expect(series[0]?.displayWinrate).toBe(50);
  });

  it("falls back to sparse when timeline missing", () => {
    const result = {
      turnAnalyses: [
        {
          status: "ok",
          turnIndex: 5,
          player: "B",
          playedMove: "Q16",
          moveSummary: { played: { move: "Q16", winrate: 0.48 } },
        },
      ],
    };
    const { series, fromTimeline } = buildWinrateSeriesPreferTimeline(
      result,
      result.turnAnalyses as never,
      undefined
    );
    expect(fromTimeline).toBe(false);
    expect(series.some(p => p.turnIndex === 5)).toBe(true);
  });
});

describe("analyzeSgfKatago timeline isolation", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it("timeline failure does not fail the job", async () => {
    process.env.KATAGO_BINARY_PATH = "/k";
    process.env.KATAGO_CONFIG_PATH = "/c";
    process.env.KATAGO_MODEL_PATH = "/m";
    process.env.KATAGO_REPORT_ANALYSIS_WINRATES_AS_EXPECTED = "BLACK";
    process.env.KATAGO_MULTI_TURN_MAX = "0";
    process.env.KATAGO_WINRATE_TIMELINE_ENABLED = "true";

    const primaryStdout = makeTimelineStdout([
      {
        id: "p",
        rootInfo: { winrate: 0.52, scoreLead: 0.3 },
        moveInfos: [{ move: "Q16", winrate: 0.52, scoreLead: 0.3 }],
      },
    ]);
    let calls = 0;
    const spawnFn: SpawnFn = (_cmd, args) => {
      calls += 1;
      if (calls === 1) {
        return makeKatagoSpawn(primaryStdout)(_cmd, args);
      }
      return makeKatagoSpawn("", 1)(_cmd, args);
    };

    const r = await analyzeSgfKatago({
      jobId: "tl-fail",
      sgfContent: MINI_SGF,
      language: "ko",
      maxVisits: 200,
      fileName: "g.sgf",
      __testSpawnFn: spawnFn,
    });
    expect((r as { ok?: boolean }).ok).toBe(true);
    const tl = (r as { winrateTimelineV1?: { enabled?: boolean } })
      .winrateTimelineV1;
    expect(tl?.enabled).toBe(true);
  });
});

describe("buildAnalysisResultViewModel timeline graph", () => {
  it("uses timeline for graph when present", () => {
    const vm = buildAnalysisResultViewModel({
      source: "katago-worker-v1",
      ok: true,
      game_info: { total_moves: 2 },
      winrateTimelineV1: {
        version: "winrate-timeline-v1",
        enabled: true,
        source: "katago-analyzeTurns",
        policy: {
          mode: "full-mainline-after-each-move",
          visits: 200,
          maxTurns: 300,
          analyzeTurnsCount: 3,
          timeoutMs: 600000,
          analysisPVLen: 1,
          includeFinal: true,
        },
        totalMoves: 2,
        attemptedCount: 3,
        completedCount: 3,
        failedCount: 0,
        partialFailure: false,
        allFailed: false,
        points: [
          {
            turnIndex: 0,
            turnNumber: 0,
            movesBeforeCount: 0,
            player: null,
            playedMove: null,
            status: "ok",
            rawWinrate: 0.5,
            displayWinrate: 50,
            scoreLead: 0,
            visits: 200,
            currentPlayer: "B",
            perspectiveStatus: "katago_output_only",
          },
        ],
      },
    });
    if (vm.kind !== "katago-worker-v1") {
      throw new Error("expected katago vm");
    }
    expect(vm.graph.winrateSeriesFromTimeline).toBe(true);
    expect(vm.graph.winrateSeries[0]?.turnIndex).toBe(0);
  });

  it("winrate UI has no black/white fixed winrate labels", () => {
    for (const lang of ["ko", "en", "ja", "zh"] as const) {
      const t = getAnalysisResultUiStrings(lang);
      expect(
        uiTextContainsForbiddenLabel(t.winrateFullTimelineNote, lang)
      ).toBe(false);
      expect(t.winrateYAxis.toLowerCase()).not.toMatch(
        /black.?winrate|white.?winrate/
      );
    }
  });
});
