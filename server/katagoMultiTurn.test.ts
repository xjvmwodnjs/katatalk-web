import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as analysisEngines from "./worker/analysisEngines";
import { analyzeSgfKatago } from "./worker/analysisEngines";
import { readKatagoMultiTurnMaxFrom } from "./worker/analysisEngines/config";
import { runMultiTurnKatagoRawV1 } from "./worker/analysisEngines/katagoMultiTurnRun";
import { buildAnalysisPlanV1FromParsed, selectCandidatesForMultiTurnAnalysis, sliceMovesBeforeTurnIndex } from "./analysisPlan";
import * as creditService from "./creditService";
import type { AnalysisJobDbRow } from "./creditService";
import { runKatagoAnalysisDbPipeline } from "./worker/katagoAnalysisDbPipeline";
import { parseMinimalSgfForSmoke } from "./worker/analysisEngines/katagoSgfQuery";
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

describe("readKatagoMultiTurnMaxFrom", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("defaults to 6 when unset", () => {
    delete process.env.KATAGO_MULTI_TURN_MAX;
    expect(readKatagoMultiTurnMaxFrom(process.env)).toBe(6);
  });

  it("respects KATAGO_MULTI_TURN_MAX including 0", () => {
    process.env.KATAGO_MULTI_TURN_MAX = "4";
    expect(readKatagoMultiTurnMaxFrom(process.env)).toBe(4);
    process.env.KATAGO_MULTI_TURN_MAX = "0";
    expect(readKatagoMultiTurnMaxFrom(process.env)).toBe(0);
  });
});

function validResponseObject(id: string, playedMove: string): Record<string, unknown> {
  return {
    id,
    rootInfo: { winrate: 0.52, scoreLead: 0.4 },
    moveInfos: [
      { move: "D16", winrate: 0.53 },
      { move: playedMove, winrate: 0.52 },
      { move: "Q3", winrate: 0.51 },
    ],
  };
}

describe("runMultiTurnKatagoRawV1 (mock KataGo JSONL by id)", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it("matches multiple stdout JSON lines to query ids (batch)", async () => {
    process.env.KATAGO_BINARY_PATH = "/fake/katago";
    process.env.KATAGO_CONFIG_PATH = "/fake/c.cfg";
    process.env.KATAGO_MODEL_PATH = "/fake/m.gz";
    process.env.KATAGO_MULTI_TURN_MAX = "2";
    process.env.KATAGO_MULTI_TURN_BATCH = "1";

    const sgf = buildSgfWithNMoves(25);
    const parsed = parseMinimalSgfForSmoke(sgf);
    const plan = buildAnalysisPlanV1FromParsed(parsed);
    const sel = selectCandidatesForMultiTurnAnalysis(plan, 2);
    expect(sel.length).toBe(2);

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
            const lines = stdinBuf.split("\n").filter((l) => l.trim().length > 0);
            const responses = lines.map((line) => {
              const q = JSON.parse(line) as { id: string };
              const m = /--turn-(\d+)--/.exec(q.id);
              const turn = m ? Number(m[1]) : 0;
              const played = sliceMovesBeforeTurnIndex(parsed, turn).playedMoveGtp;
              return validResponseObject(q.id, played);
            });
            out.end(`${responses.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
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

    const { turnAnalyses, multiTurnAnalysis } = await runMultiTurnKatagoRawV1({
      parsed,
      plan,
      jobId: "job-mt-1",
      sgfSha256: "a".repeat(64),
      sgfSizeBytes: 100,
      env: process.env,
      spawnFn: mockSpawn,
    });

    expect(multiTurnAnalysis).toMatchObject({
      candidateCount: 2,
      attemptedCount: 2,
      maxTurnsRequested: 2,
      maxTurnsAnalyzed: 2,
      completedCount: 2,
      failedCount: 0,
      allFailed: false,
      partialFailure: false,
    });
    expect(turnAnalyses).toHaveLength(2);
    expect(turnAnalyses.every((t) => t.status === "ok")).toBe(true);
    const t20 = turnAnalyses.find((t) => t.turnIndex === 20);
    expect(t20?.status).toBe("ok");
    if (t20?.status === "ok") {
      expect(t20.query.movesBeforeCount).toBe(19);
      expect(t20.comparisonReady.playedMoveFoundInCandidates).toBe(true);
    }
  });

  it("records failed entries when stdout has no matching id", async () => {
    process.env.KATAGO_BINARY_PATH = "/fake/katago";
    process.env.KATAGO_CONFIG_PATH = "/fake/c.cfg";
    process.env.KATAGO_MODEL_PATH = "/fake/m.gz";
    process.env.KATAGO_MULTI_TURN_MAX = "1";
    process.env.KATAGO_MULTI_TURN_BATCH = "1";

    const sgf = "(;SZ[19];B[pd];W[ee])";
    const parsed = parseMinimalSgfForSmoke(sgf);
    const plan = buildAnalysisPlanV1FromParsed(parsed);

    const mockSpawn: SpawnFn = () => {
      const proc = new EventEmitter() as ChildProcess;
      const stdin = new Writable({
        write(_c, _e, cb) {
          cb();
        },
        final(cb) {
          setImmediate(() => {
            out.end(
              `${JSON.stringify({ id: "wrong-id", rootInfo: { winrate: 0.5, scoreLead: 1 }, moveInfos: [{ move: "A1" }] })}\n`,
              "utf8"
            );
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

    const { turnAnalyses, multiTurnAnalysis } = await runMultiTurnKatagoRawV1({
      parsed,
      plan,
      jobId: "job-mt-2",
      sgfSha256: "b".repeat(64),
      sgfSizeBytes: 50,
      env: process.env,
      spawnFn: mockSpawn,
    });

    expect(turnAnalyses).toHaveLength(1);
    expect(turnAnalyses[0]!.status).toBe("failed");
    expect(multiTurnAnalysis.failedCount).toBe(1);
    expect(multiTurnAnalysis.completedCount).toBe(0);
    expect(multiTurnAnalysis.allFailed).toBe(true);
    expect(multiTurnAnalysis.partialFailure).toBe(false);
    expect(multiTurnAnalysis.unknownResponseIdCount).toBe(1);
  });

  it("batch: one of two expected ids missing → partialFailure", async () => {
    process.env.KATAGO_BINARY_PATH = "/fake/katago";
    process.env.KATAGO_CONFIG_PATH = "/fake/c.cfg";
    process.env.KATAGO_MODEL_PATH = "/fake/m.gz";
    process.env.KATAGO_MULTI_TURN_MAX = "2";
    process.env.KATAGO_MULTI_TURN_BATCH = "1";

    const sgf = buildSgfWithNMoves(25);
    const parsed = parseMinimalSgfForSmoke(sgf);
    const plan = buildAnalysisPlanV1FromParsed(parsed);
    const sel = selectCandidatesForMultiTurnAnalysis(plan, 2);
    expect(sel.length).toBe(2);

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
            const lines = stdinBuf.split("\n").filter((l) => l.trim().length > 0);
            const q0 = JSON.parse(lines[0]!) as { id: string };
            const m = /--turn-(\d+)--/.exec(q0.id);
            const turn = m ? Number(m[1]) : 0;
            const played = sliceMovesBeforeTurnIndex(parsed, turn).playedMoveGtp;
            out.end(`${JSON.stringify(validResponseObject(q0.id, played))}\n`, "utf8");
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

    const { turnAnalyses, multiTurnAnalysis } = await runMultiTurnKatagoRawV1({
      parsed,
      plan,
      jobId: "job-mt-partial",
      sgfSha256: "c".repeat(64),
      sgfSizeBytes: 100,
      env: process.env,
      spawnFn: mockSpawn,
    });

    expect(turnAnalyses.filter((t) => t.status === "ok")).toHaveLength(1);
    expect(turnAnalyses.filter((t) => t.status === "failed")).toHaveLength(1);
    expect(turnAnalyses.some((t) => t.status === "failed" && t.error.includes("KATAGO_MULTI_TURN_MISSING_ID"))).toBe(
      true
    );
    expect(multiTurnAnalysis.partialFailure).toBe(true);
    expect(multiTurnAnalysis.allFailed).toBe(false);
  });

  it("batch: duplicate id in stdout → KATAGO_MULTI_TURN_DUPLICATE_ID for all", async () => {
    process.env.KATAGO_BINARY_PATH = "/fake/katago";
    process.env.KATAGO_CONFIG_PATH = "/fake/c.cfg";
    process.env.KATAGO_MODEL_PATH = "/fake/m.gz";
    process.env.KATAGO_MULTI_TURN_MAX = "2";
    process.env.KATAGO_MULTI_TURN_BATCH = "1";

    const sgf = buildSgfWithNMoves(25);
    const parsed = parseMinimalSgfForSmoke(sgf);
    const plan = buildAnalysisPlanV1FromParsed(parsed);

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
            const lines = stdinBuf.split("\n").filter((l) => l.trim().length > 0);
            const q0 = JSON.parse(lines[0]!) as { id: string };
            const dup = validResponseObject(q0.id, "pd");
            out.end(`${JSON.stringify(dup)}\n${JSON.stringify(dup)}\n`, "utf8");
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

    const { turnAnalyses, multiTurnAnalysis } = await runMultiTurnKatagoRawV1({
      parsed,
      plan,
      jobId: "job-mt-dup",
      sgfSha256: "d".repeat(64),
      sgfSizeBytes: 100,
      env: process.env,
      spawnFn: mockSpawn,
    });

    expect(turnAnalyses.every((t) => t.status === "failed")).toBe(true);
    expect(turnAnalyses.every((t) => t.status === "failed" && t.error.includes("KATAGO_MULTI_TURN_DUPLICATE_ID"))).toBe(
      true
    );
    expect(multiTurnAnalysis.allFailed).toBe(true);
  });

  it("batch: unknown extra id lines are counted, expected ids still match", async () => {
    process.env.KATAGO_BINARY_PATH = "/fake/katago";
    process.env.KATAGO_CONFIG_PATH = "/fake/c.cfg";
    process.env.KATAGO_MODEL_PATH = "/fake/m.gz";
    process.env.KATAGO_MULTI_TURN_MAX = "2";
    process.env.KATAGO_MULTI_TURN_BATCH = "1";

    const sgf = buildSgfWithNMoves(25);
    const parsed = parseMinimalSgfForSmoke(sgf);
    const plan = buildAnalysisPlanV1FromParsed(parsed);

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
            const lines = stdinBuf.split("\n").filter((l) => l.trim().length > 0);
            const responses = lines.map((line) => {
              const q = JSON.parse(line) as { id: string };
              const m = /--turn-(\d+)--/.exec(q.id);
              const turn = m ? Number(m[1]) : 0;
              const played = sliceMovesBeforeTurnIndex(parsed, turn).playedMoveGtp;
              return validResponseObject(q.id, played);
            });
            const extra = {
              id: "katatalk-mt-extra-unknown",
              rootInfo: { winrate: 0.5, scoreLead: 0 },
              moveInfos: [{ move: "A1", winrate: 0.5 }],
            };
            out.end(`${responses.map((r) => JSON.stringify(r)).join("\n")}\n${JSON.stringify(extra)}\n`, "utf8");
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

    const { turnAnalyses, multiTurnAnalysis } = await runMultiTurnKatagoRawV1({
      parsed,
      plan,
      jobId: "job-mt-extra",
      sgfSha256: "e".repeat(64),
      sgfSizeBytes: 100,
      env: process.env,
      spawnFn: mockSpawn,
    });

    expect(turnAnalyses.every((t) => t.status === "ok")).toBe(true);
    expect(multiTurnAnalysis.unknownResponseIdCount).toBe(1);
  });

  it("batch: id-less JSON lines are ignored; expected ids still match", async () => {
    process.env.KATAGO_BINARY_PATH = "/fake/katago";
    process.env.KATAGO_CONFIG_PATH = "/fake/c.cfg";
    process.env.KATAGO_MODEL_PATH = "/fake/m.gz";
    process.env.KATAGO_MULTI_TURN_MAX = "2";
    process.env.KATAGO_MULTI_TURN_BATCH = "1";

    const sgf = buildSgfWithNMoves(25);
    const parsed = parseMinimalSgfForSmoke(sgf);
    const plan = buildAnalysisPlanV1FromParsed(parsed);

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
            const lines = stdinBuf.split("\n").filter((l) => l.trim().length > 0);
            const responses = lines.map((line) => {
              const q = JSON.parse(line) as { id: string };
              const m = /--turn-(\d+)--/.exec(q.id);
              const turn = m ? Number(m[1]) : 0;
              const played = sliceMovesBeforeTurnIndex(parsed, turn).playedMoveGtp;
              return validResponseObject(q.id, played);
            });
            const noId = { rootInfo: { winrate: 0.1, scoreLead: 0 }, moveInfos: [{ move: "B1", winrate: 0.1 }] };
            out.end(`${JSON.stringify(noId)}\n${responses.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
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

    const { turnAnalyses, multiTurnAnalysis } = await runMultiTurnKatagoRawV1({
      parsed,
      plan,
      jobId: "job-mt-noid",
      sgfSha256: "f".repeat(64),
      sgfSizeBytes: 100,
      env: process.env,
      spawnFn: mockSpawn,
    });

    expect(turnAnalyses.every((t) => t.status === "ok")).toBe(true);
    expect(multiTurnAnalysis.completedCount).toBe(2);
  });

  it("sequential: id missing and fallback off → failed", async () => {
    process.env.KATAGO_BINARY_PATH = "/fake/katago";
    process.env.KATAGO_CONFIG_PATH = "/fake/c.cfg";
    process.env.KATAGO_MODEL_PATH = "/fake/m.gz";
    process.env.KATAGO_MULTI_TURN_MAX = "1";
    process.env.KATAGO_MULTI_TURN_BATCH = "0";
    delete process.env.KATAGO_MULTI_TURN_ALLOW_IDLESS_SEQUENTIAL_FALLBACK;

    const sgf = "(;SZ[19];B[pd];W[ee])";
    const parsed = parseMinimalSgfForSmoke(sgf);
    const plan = buildAnalysisPlanV1FromParsed(parsed);

    const mockSpawn: SpawnFn = () => {
      const proc = new EventEmitter() as ChildProcess;
      const stdin = new Writable({
        write(_c, _e, cb) {
          cb();
        },
        final(cb) {
          setImmediate(() => {
            const body = {
              rootInfo: { winrate: 0.5, scoreLead: 1 },
              moveInfos: [{ move: "A1", winrate: 0.51 }],
            };
            out.end(`${JSON.stringify(body)}\n`, "utf8");
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

    const { turnAnalyses } = await runMultiTurnKatagoRawV1({
      parsed,
      plan,
      jobId: "job-seq-strict",
      sgfSha256: "g".repeat(64),
      sgfSizeBytes: 50,
      env: process.env,
      spawnFn: mockSpawn,
    });

    expect(turnAnalyses).toHaveLength(1);
    expect(turnAnalyses[0]!.status).toBe("failed");
    if (turnAnalyses[0]!.status === "failed") {
      expect(turnAnalyses[0].error).toContain("KATAGO_MULTI_TURN_MISSING_ID");
    }
  });

  it("sequential: id missing and fallback on → ok with fallbackUsed", async () => {
    process.env.KATAGO_BINARY_PATH = "/fake/katago";
    process.env.KATAGO_CONFIG_PATH = "/fake/c.cfg";
    process.env.KATAGO_MODEL_PATH = "/fake/m.gz";
    process.env.KATAGO_MULTI_TURN_MAX = "1";
    process.env.KATAGO_MULTI_TURN_BATCH = "0";
    process.env.KATAGO_MULTI_TURN_ALLOW_IDLESS_SEQUENTIAL_FALLBACK = "true";

    const sgf = "(;SZ[19];B[pd];W[ee])";
    const parsed = parseMinimalSgfForSmoke(sgf);
    const plan = buildAnalysisPlanV1FromParsed(parsed);

    const mockSpawn: SpawnFn = () => {
      const proc = new EventEmitter() as ChildProcess;
      const stdin = new Writable({
        write(_c, _e, cb) {
          cb();
        },
        final(cb) {
          setImmediate(() => {
            const body = {
              rootInfo: { winrate: 0.5, scoreLead: 1 },
              moveInfos: [{ move: "A1", winrate: 0.51 }],
            };
            out.end(`${JSON.stringify(body)}\n`, "utf8");
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

    const { turnAnalyses } = await runMultiTurnKatagoRawV1({
      parsed,
      plan,
      jobId: "job-seq-fb",
      sgfSha256: "h".repeat(64),
      sgfSizeBytes: 50,
      env: process.env,
      spawnFn: mockSpawn,
    });

    expect(turnAnalyses).toHaveLength(1);
    expect(turnAnalyses[0]!.status).toBe("ok");
    if (turnAnalyses[0]!.status === "ok") {
      expect(turnAnalyses[0].fallbackUsed).toBe(true);
    }
  });
});

describe("analyzeSgfKatago multi-turn integration (mock spawn)", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it("returns turnAnalyses and does not add BSI/ADI fields", async () => {
    process.env.KATAGO_BINARY_PATH = "/fake/katago";
    process.env.KATAGO_CONFIG_PATH = "/fake/c.cfg";
    process.env.KATAGO_MODEL_PATH = "/fake/m.gz";
    process.env.KATAGO_MULTI_TURN_MAX = "2";
    process.env.KATAGO_MAX_VISITS = "30";

    const sgf = buildSgfWithNMoves(25);
    const parsed = parseMinimalSgfForSmoke(sgf);

    let spawnCalls = 0;
    const mockSpawn: SpawnFn = () => {
      spawnCalls += 1;
      const proc = new EventEmitter() as ChildProcess;
      let stdinBuf = "";
      const stdin = new Writable({
        write(chunk: Buffer | string, _enc, cb) {
          stdinBuf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
          cb();
        },
        final(cb) {
          setImmediate(() => {
            if (spawnCalls === 1) {
              const q = JSON.parse(stdinBuf.trim()) as { id: string };
              out.end(
                `${JSON.stringify({
                  id: q.id,
                  rootInfo: { winrate: 0.48, scoreLead: 0.2 },
                  moveInfos: [{ move: "D16", winrate: 0.49 }],
                })}\n`,
                "utf8"
              );
            } else {
              const lines = stdinBuf.split("\n").filter((l) => l.trim().length > 0);
              const responses = lines.map((line) => {
                const q = JSON.parse(line) as { id: string };
                const m = /--turn-(\d+)--/.exec(q.id);
                const turn = m ? Number(m[1]) : 0;
                const played = sliceMovesBeforeTurnIndex(parsed, turn).playedMoveGtp;
                return validResponseObject(q.id, played);
              });
              out.end(`${responses.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
            }
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

    const result = await analyzeSgfKatago({
      jobId: "job-int-1",
      sgfContent: sgf,
      language: "ko",
      maxVisits: 30,
      fileName: "g.sgf",
      __testSpawnFn: mockSpawn,
    });

    expect(spawnCalls).toBe(2);
    expect(Array.isArray(result.turnAnalyses)).toBe(true);
    expect((result.turnAnalyses as { length: number }).length).toBeLessThanOrEqual(2);
    expect(result.multiTurnAnalysis).toMatchObject({
      version: "multi-turn-katago-analysis-v1",
      candidateCount: 2,
      attemptedCount: 2,
      maxTurnsRequested: 2,
      completedCount: 2,
      failedCount: 0,
      allFailed: false,
      partialFailure: false,
    });
    const algo = result.algorithmStage as { notYetImplemented?: string[] };
    expect(algo.notYetImplemented).toContain("bsi");
    expect(JSON.stringify(result)).not.toMatch(/"llm_commentary"\s*:/i);
  });

  it("still completes when multi batch stdout is invalid (primary ok)", async () => {
    process.env.KATAGO_BINARY_PATH = "/fake/katago";
    process.env.KATAGO_CONFIG_PATH = "/fake/c.cfg";
    process.env.KATAGO_MODEL_PATH = "/fake/m.gz";
    process.env.KATAGO_MULTI_TURN_MAX = "1";

    let spawnCalls = 0;
    const mockSpawn: SpawnFn = () => {
      spawnCalls += 1;
      const proc = new EventEmitter() as ChildProcess;
      const stdin = new Writable({
        write(_c, _e, cb) {
          cb();
        },
        final(cb) {
          setImmediate(() => {
            if (spawnCalls === 1) {
              out.end(
                `${JSON.stringify({
                  id: "x",
                  rootInfo: { winrate: 0.5, scoreLead: 1 },
                  moveInfos: [{ move: "A1" }],
                })}\n`,
                "utf8"
              );
            } else {
              out.end("not-json-at-all\n", "utf8");
            }
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

    const sgf = "(;SZ[19];B[pd];W[ee])";
    const result = await analyzeSgfKatago({
      jobId: "job-int-2",
      sgfContent: sgf,
      language: "ko",
      maxVisits: 10,
      fileName: "g.sgf",
      __testSpawnFn: mockSpawn,
    });

    expect(result.ok).toBe(true);
    expect((result.turnAnalyses as { status: string }[]).every((t) => t.status === "failed")).toBe(true);
    expect(result.multiTurnAnalysis).toMatchObject({
      allFailed: true,
      completedCount: 0,
      failedCount: 1,
      partialFailure: false,
    });
  });
});

describe("runKatagoAnalysisDbPipeline primary failure + refund", () => {
  const saved = { ...process.env };

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...saved };
  });

  it("invokes onJobFailed when analyzeSgfKatago rejects (primary path)", async () => {
    vi.spyOn(creditService, "updateAnalysisJobRow").mockResolvedValue(undefined);
    const analyzeSpy = vi.spyOn(analysisEngines, "analyzeSgfKatago").mockRejectedValue(new Error("KATAGO_PRIMARY_FAIL"));
    const onJobFailed = vi.fn().mockResolvedValue(undefined);

    const row: AnalysisJobDbRow = {
      id: "kg-fail-1",
      user_id: "user_a",
      status: "running",
      file_name: "g.sgf",
      language: "ko",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa01",
      is_mock: false,
      progress: 15,
      result: null,
      error_message: null,
      created_at: "",
      updated_at: "",
      completed_at: null,
      sgf_content: "(;SZ[19];B[pd])",
      sgf_sha256: "x",
      sgf_size_bytes: 10,
    };

    await runKatagoAnalysisDbPipeline({
      jobId: "kg-fail-1",
      row,
      fileName: "g.sgf",
      language: "ko",
      onJobFailed,
    });

    expect(analyzeSpy).toHaveBeenCalled();
    expect(onJobFailed).toHaveBeenCalled();
    const failedUpdate = vi.mocked(creditService.updateAnalysisJobRow).mock.calls.find(
      (c) => (c[1] as { status?: string }).status === "failed"
    );
    expect(failedUpdate).toBeDefined();
  });
});
