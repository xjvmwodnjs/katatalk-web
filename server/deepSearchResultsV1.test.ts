import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEEP_SEARCH_PLAN_V1_COMPUTED_FROM,
  DEEP_SEARCH_PLAN_V1_VERSION,
  type DeepSearchPlanCandidateV1,
  type DeepSearchPlanV1Result,
} from "@shared/deepSearchPlanV1";
import {
  computeDeepSearchResultsV1,
  readDeepSearchExecutionEnabledFromEnv,
  readDeepSearchExecutionPolicyFromEnv,
} from "./deepSearchResultsV1";
import { sliceMovesBeforeTurnIndex } from "./analysisPlan";
import { parseMinimalSgfForSmoke } from "./worker/analysisEngines/katagoSgfQuery";
import * as katagoSmokeRun from "./worker/analysisEngines/katagoSmokeRun";
import type { SpawnFn } from "./worker/analysisEngines/katagoSmokeRun";

function buildSgfWithNMoves(n: number, boardSize = 19): string {
  let s = `(;FF[4]GM[1]SZ[${boardSize}]KM[6.5]`;
  for (let i = 0; i < n; i++) {
    const c = i % 2 === 0 ? "B" : "W";
    const col = i % boardSize;
    const row = Math.floor(i / boardSize) % boardSize;
    const lc = String.fromCharCode("a".charCodeAt(0) + col);
    const lr = String.fromCharCode("a".charCodeAt(0) + row);
    s += `;${c}[${lc}${lr}]`;
  }
  return `${s})`;
}

function minimalPlan(candidates: DeepSearchPlanCandidateV1[]): DeepSearchPlanV1Result {
  return {
    version: DEEP_SEARCH_PLAN_V1_VERSION,
    computedFrom: DEEP_SEARCH_PLAN_V1_COMPUTED_FROM,
    policy: { mode: "standard", maxCandidates: 3, minAdiScore: 0.5, minBsiScore: 30 },
    candidateCount: candidates.length,
    candidates,
    notSelected: [],
  };
}

function cand(turnIndex: number, bestMove: string | null): DeepSearchPlanCandidateV1 {
  return {
    turnIndex,
    player: "B",
    playedMove: "Q16",
    bestMove,
    selectionScore: 0.8,
    selectionBand: "high",
    reasons: ["test"],
    adiScore: 0.8,
    priority: 1,
    candidateReason: "interval_sample",
    status: "selected",
  };
}

function validResponseObject(id: string, topMove: string, playedMove: string): Record<string, unknown> {
  return {
    id,
    rootInfo: { winrate: 0.52, scoreLead: 0.4 },
    moveInfos: [
      { move: topMove, winrate: 0.53 },
      { move: playedMove, winrate: 0.52 },
      { move: "Q3", winrate: 0.51 },
    ],
  };
}

describe("readDeepSearchExecutionPolicyFromEnv", () => {
  it("clamps maxCandidates to 1..5, default 2 on invalid", () => {
    expect(readDeepSearchExecutionPolicyFromEnv({}).maxCandidates).toBe(2);
    expect(readDeepSearchExecutionPolicyFromEnv({ KATAGO_DEEP_SEARCH_MAX_CANDIDATES: "x" }).maxCandidates).toBe(2);
    expect(readDeepSearchExecutionPolicyFromEnv({ KATAGO_DEEP_SEARCH_MAX_CANDIDATES: "1" }).maxCandidates).toBe(1);
    expect(readDeepSearchExecutionPolicyFromEnv({ KATAGO_DEEP_SEARCH_MAX_CANDIDATES: "9" }).maxCandidates).toBe(5);
  });

  it("clamps visits 100..5000, default 800 on invalid", () => {
    expect(readDeepSearchExecutionPolicyFromEnv({}).visits).toBe(800);
    expect(readDeepSearchExecutionPolicyFromEnv({ KATAGO_DEEP_SEARCH_VISITS: "50" }).visits).toBe(100);
    expect(readDeepSearchExecutionPolicyFromEnv({ KATAGO_DEEP_SEARCH_VISITS: "99999" }).visits).toBe(5000);
  });

  it("clamps timeout 30000..900000, default 180000 on invalid", () => {
    expect(readDeepSearchExecutionPolicyFromEnv({}).timeoutMs).toBe(180_000);
    expect(readDeepSearchExecutionPolicyFromEnv({ KATAGO_DEEP_SEARCH_TIMEOUT_MS: "1000" }).timeoutMs).toBe(30_000);
    expect(readDeepSearchExecutionPolicyFromEnv({ KATAGO_DEEP_SEARCH_TIMEOUT_MS: "2000000" }).timeoutMs).toBe(900_000);
  });
});

describe("readDeepSearchExecutionEnabledFromEnv", () => {
  it("only literal true enables", () => {
    expect(readDeepSearchExecutionEnabledFromEnv({})).toBe(false);
    expect(readDeepSearchExecutionEnabledFromEnv({ KATAGO_DEEP_SEARCH_ENABLED: "false" })).toBe(false);
    expect(readDeepSearchExecutionEnabledFromEnv({ KATAGO_DEEP_SEARCH_ENABLED: "1" })).toBe(false);
    expect(readDeepSearchExecutionEnabledFromEnv({ KATAGO_DEEP_SEARCH_ENABLED: "true" })).toBe(true);
    expect(readDeepSearchExecutionEnabledFromEnv({ KATAGO_DEEP_SEARCH_ENABLED: " TRUE " })).toBe(true);
  });
});

describe("computeDeepSearchResultsV1", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it("does not call KataGo when disabled", async () => {
    const spy = vi.spyOn(katagoSmokeRun, "runKatagoWorkerAnalysisQueryLines");
    const sgf = buildSgfWithNMoves(20);
    const parsed = parseMinimalSgfForSmoke(sgf);
    const plan = minimalPlan([cand(10, "D16")]);
    const r = await computeDeepSearchResultsV1({
      env: { KATAGO_DEEP_SEARCH_ENABLED: "false" },
      jobId: "j1",
      parsed,
      deepSearchPlan: plan,
      sgfSha256: "a".repeat(64),
      sgfSizeBytes: 10,
    });
    expect(r.enabled).toBe(false);
    expect(r.attemptedCount).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("enabled=true runs KataGo once per capped candidate", async () => {
    process.env.KATAGO_BINARY_PATH = "/fake/katago";
    process.env.KATAGO_CONFIG_PATH = "/fake/c.cfg";
    process.env.KATAGO_MODEL_PATH = "/fake/m.gz";
    const env = {
      ...process.env,
      KATAGO_DEEP_SEARCH_ENABLED: "true",
      KATAGO_DEEP_SEARCH_MAX_CANDIDATES: "1",
    };
    const sgf = buildSgfWithNMoves(30);
    const parsed = parseMinimalSgfForSmoke(sgf);
    const turnIndex = 12;
    const sliced = sliceMovesBeforeTurnIndex(parsed, turnIndex);
    const mockSpawn: SpawnFn = () => {
      const proc = new EventEmitter() as ChildProcess;
      let stdinBuf = "";
      const stdin = new Writable({
        write(chunk: Buffer | string, _enc, cb) {
          stdinBuf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
          cb();
        },
        final(cb) {
          setImmediate(() => {
            const line = stdinBuf.split("\n").filter((l) => l.trim())[0]!;
            const q = JSON.parse(line) as { id: string };
            const played = sliced.playedMoveGtp;
            out.end(`${JSON.stringify(validResponseObject(q.id, "D16", played))}\n`, "utf8");
            err.end();
            proc.emit("close", 0, null);
          });
          cb();
        },
      });
      const out = new PassThrough();
      const err = new PassThrough();
      proc.stdin = stdin;
      proc.stdout = out;
      proc.stderr = err;
      return proc;
    };
    const plan = minimalPlan([cand(turnIndex, "D16")]);
    const spy = vi.spyOn(katagoSmokeRun, "runKatagoWorkerAnalysisQueryLines");
    const r = await computeDeepSearchResultsV1({
      env,
      jobId: "j-ds-1",
      parsed,
      deepSearchPlan: plan,
      sgfSha256: "b".repeat(64),
      sgfSizeBytes: 20,
      spawnFn: mockSpawn,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(r.enabled).toBe(true);
    expect(r.results).toHaveLength(1);
    const row = r.results[0]!;
    expect(row.status).toBe("ok");
    if (row.status === "ok") {
      expect(row.query.movesBeforeCount).toBe(turnIndex - 1);
      expect(row.comparison.deepBestMove).toBe("D16");
      expect(row.comparison.plannedBestMove).toBe("D16");
      expect(row.comparison.plannedBestMoveStillTop).toBe(true);
      expect(row.comparison.playedMoveRank).toBe(2);
    }
  });

  it("partial failure: one ok one failed", async () => {
    process.env.KATAGO_BINARY_PATH = "/fake/katago";
    process.env.KATAGO_CONFIG_PATH = "/fake/c.cfg";
    process.env.KATAGO_MODEL_PATH = "/fake/m.gz";
    const env = {
      ...process.env,
      KATAGO_DEEP_SEARCH_ENABLED: "true",
      KATAGO_DEEP_SEARCH_MAX_CANDIDATES: "2",
    };
    const sgf = buildSgfWithNMoves(25);
    const parsed = parseMinimalSgfForSmoke(sgf);
    const mockSpawn: SpawnFn = () => {
      const proc = new EventEmitter() as ChildProcess;
      let stdinBuf = "";
      const stdin = new Writable({
        write(chunk: Buffer | string, _enc, cb) {
          stdinBuf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
          cb();
        },
        final(cb) {
          setImmediate(() => {
            const line = stdinBuf.split("\n").filter((l) => l.trim())[0]!;
            const q = JSON.parse(line) as { id: string };
            const m = /--turn-(\d+)--/.exec(q.id);
            const ti = m ? Number(m[1]) : 0;
            const sl = sliceMovesBeforeTurnIndex(parsed, ti);
            if (ti === 8) {
              out.end("", "utf8");
              err.end();
              proc.emit("close", 1, null);
            } else {
              out.end(`${JSON.stringify(validResponseObject(q.id, "Q3", sl.playedMoveGtp))}\n`, "utf8");
              err.end();
              proc.emit("close", 0, null);
            }
          });
          cb();
        },
      });
      const out = new PassThrough();
      const err = new PassThrough();
      proc.stdin = stdin;
      proc.stdout = out;
      proc.stderr = err;
      return proc;
    };
    const plan = minimalPlan([
      { ...cand(8, "D16"), turnIndex: 8 },
      { ...cand(10, "D16"), turnIndex: 10 },
    ]);
    const r = await computeDeepSearchResultsV1({
      env,
      jobId: "j-partial",
      parsed,
      deepSearchPlan: plan,
      sgfSha256: "c".repeat(64),
      sgfSizeBytes: 30,
      spawnFn: mockSpawn,
    });
    expect(r.partialFailure).toBe(true);
    expect(r.completedCount).toBe(1);
    expect(r.failedCount).toBe(1);
    expect(r.allFailed).toBe(false);
  });

  it("all deep candidates failed: allFailed true, still valid shape", async () => {
    process.env.KATAGO_BINARY_PATH = "/fake/katago";
    process.env.KATAGO_CONFIG_PATH = "/fake/c.cfg";
    process.env.KATAGO_MODEL_PATH = "/fake/m.gz";
    const env = {
      ...process.env,
      KATAGO_DEEP_SEARCH_ENABLED: "true",
      KATAGO_DEEP_SEARCH_MAX_CANDIDATES: "1",
    };
    const sgf = buildSgfWithNMoves(15);
    const parsed = parseMinimalSgfForSmoke(sgf);
    const mockSpawn: SpawnFn = () => {
      const proc = new EventEmitter() as ChildProcess;
      const stdin = new Writable({
        write(_c, _e, cb) {
          cb();
        },
        final(cb) {
          setImmediate(() => {
            out.end("", "utf8");
            err.end();
            proc.emit("close", 1, null);
          });
          cb();
        },
      });
      const out = new PassThrough();
      const err = new PassThrough();
      proc.stdin = stdin;
      proc.stdout = out;
      proc.stderr = err;
      return proc;
    };
    const plan = minimalPlan([cand(5, "D16")]);
    const r = await computeDeepSearchResultsV1({
      env,
      jobId: "j-allfail",
      parsed,
      deepSearchPlan: plan,
      sgfSha256: "d".repeat(64),
      sgfSizeBytes: 40,
      spawnFn: mockSpawn,
    });
    expect(r.allFailed).toBe(true);
    expect(r.completedCount).toBe(0);
    expect(r.failedCount).toBe(1);
  });

  it("result payload has no raw stdout field and no top_mistakes key", async () => {
    process.env.KATAGO_BINARY_PATH = "/fake/katago";
    process.env.KATAGO_CONFIG_PATH = "/fake/c.cfg";
    process.env.KATAGO_MODEL_PATH = "/fake/m.gz";
    const env = {
      ...process.env,
      KATAGO_DEEP_SEARCH_ENABLED: "true",
      KATAGO_DEEP_SEARCH_MAX_CANDIDATES: "1",
    };
    const sgf = buildSgfWithNMoves(12);
    const parsed = parseMinimalSgfForSmoke(sgf);
    const mockSpawn: SpawnFn = () => {
      const proc = new EventEmitter() as ChildProcess;
      let stdinBuf = "";
      const stdin = new Writable({
        write(chunk: Buffer | string, _enc, cb) {
          stdinBuf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
          cb();
        },
        final(cb) {
          setImmediate(() => {
            const line = stdinBuf.split("\n").filter((l) => l.trim())[0]!;
            const q = JSON.parse(line) as { id: string };
            const sl = sliceMovesBeforeTurnIndex(parsed, 6);
            out.end(`${JSON.stringify(validResponseObject(q.id, "A1", sl.playedMoveGtp))}\n`, "utf8");
            err.end();
            proc.emit("close", 0, null);
          });
          cb();
        },
      });
      const out = new PassThrough();
      const err = new PassThrough();
      proc.stdin = stdin;
      proc.stdout = out;
      proc.stderr = err;
      return proc;
    };
    const r = await computeDeepSearchResultsV1({
      env,
      jobId: "j-shape",
      parsed,
      deepSearchPlan: minimalPlan([cand(6, "B2")]),
      sgfSha256: "e".repeat(64),
      sgfSizeBytes: 50,
      spawnFn: mockSpawn,
    });
    const json = JSON.stringify(r);
    expect(json.includes("rawStdout")).toBe(false);
    expect("top_mistakes" in (r as Record<string, unknown>)).toBe(false);
  });
});
