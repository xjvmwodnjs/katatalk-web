import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertKatagoSmokePathsFromEnv } from "./worker/analysisEngines/katagoCommand";
import {
  buildKatagoSmokeNormalized,
  detectKatagoStdoutFormat,
  extractJsonObjectsFromKatagoStdout,
  pickPrimaryAnalysisObject,
} from "./worker/analysisEngines/katagoRawParser";
import { raceOutputWithTimeout, resolveSgfPathFromArgv, runKatagoSmoke, type SpawnFn } from "./worker/analysisEngines/katagoSmokeRun";
import {
  buildKatagoAnalysisQueryLine,
  buildKatagoAnalysisQueryObject,
  indexToGtpColumn,
  parseMinimalSgfForSmoke,
  sgfLetterToCoordIndex,
  sgfPointToGtp,
} from "./worker/analysisEngines/katagoSgfQuery";
import { sha256HexUtf8, utf8ByteLength } from "./sgfPayload";

describe("assertKatagoSmokePathsFromEnv", () => {
  const saved = { ...process.env };

  afterEach(() => {
    for (const k of ["KATAGO_BINARY_PATH", "KATAGO_CONFIG_PATH", "KATAGO_MODEL_PATH"] as const) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
  });

  it("KATAGO_BINARY_PATH 가 없으면 한국어 메시지", () => {
    delete process.env.KATAGO_BINARY_PATH;
    process.env.KATAGO_CONFIG_PATH = "/x/cfg";
    process.env.KATAGO_MODEL_PATH = "/x/m";
    expect(() => assertKatagoSmokePathsFromEnv(process.env)).toThrow(/KATAGO_BINARY_PATH/);
  });

  it("KATAGO_CONFIG_PATH 가 없으면 한국어 메시지", () => {
    process.env.KATAGO_BINARY_PATH = "/x/katago";
    delete process.env.KATAGO_CONFIG_PATH;
    process.env.KATAGO_MODEL_PATH = "/x/m";
    expect(() => assertKatagoSmokePathsFromEnv(process.env)).toThrow(/KATAGO_CONFIG_PATH/);
  });

  it("KATAGO_MODEL_PATH 가 없으면 한국어 메시지", () => {
    process.env.KATAGO_BINARY_PATH = "/x/katago";
    process.env.KATAGO_CONFIG_PATH = "/x/cfg";
    delete process.env.KATAGO_MODEL_PATH;
    expect(() => assertKatagoSmokePathsFromEnv(process.env)).toThrow(/KATAGO_MODEL_PATH/);
  });
});

describe("katagoRawParser", () => {
  it("단일 JSON 에서 rootInfo·moveInfos 파싱", () => {
    const raw = JSON.stringify({
      rootInfo: { winrate: 0.4, scoreLead: 1.5, ownership: [0.1, 0.2] },
      moveInfos: [{ move: "Q16", winrate: 0.41 }, { move: "D4" }],
    });
    const objs = extractJsonObjectsFromKatagoStdout(raw);
    expect(objs.length).toBe(1);
    const fmt = detectKatagoStdoutFormat(raw, objs);
    expect(fmt).toBe("json");
    const primary = pickPrimaryAnalysisObject(objs);
    expect(primary?.moveInfos).toHaveLength(2);
    const doc = buildKatagoSmokeNormalized({
      sgfSha256: "a".repeat(64),
      sgfSizeBytes: 10,
      rawStdout: raw,
      exitCode: 0,
      commandPreview: "katago analysis …",
    });
    expect(doc.ok).toBe(true);
    expect(doc.katago.moveInfosCount).toBe(2);
    expect(doc.normalized.hasWinrate).toBe(true);
    expect(doc.normalized.hasScoreLead).toBe(true);
    expect(doc.normalized.hasOwnership).toBe(true);
    expect(doc.normalized.sampleMoveInfos).toHaveLength(2);
  });

  it("JSONL 여러 줄에서 마지막 분석 객체를 선택", () => {
    const line1 = JSON.stringify({ id: "1", policy: [] });
    const line2 = JSON.stringify({
      rootInfo: { winrate: 0.5 },
      moveInfos: [{ move: "A1", winrate: 0.51 }],
    });
    const raw = `${line1}\n${line2}\n`;
    const objs = extractJsonObjectsFromKatagoStdout(raw);
    expect(objs.length).toBe(2);
    expect(detectKatagoStdoutFormat(raw, objs)).toBe("jsonl");
    const doc = buildKatagoSmokeNormalized({
      sgfSha256: "b".repeat(64),
      sgfSizeBytes: 2,
      rawStdout: raw,
      exitCode: 0,
      commandPreview: "katago",
    });
    expect(doc.ok).toBe(true);
    expect(doc.katago.rootInfo.winrate).toBe(0.5);
  });

  it("잘못된 출력이면 ok:false", () => {
    const doc = buildKatagoSmokeNormalized({
      sgfSha256: "c".repeat(64),
      sgfSizeBytes: 1,
      rawStdout: "not-json-at-all",
      exitCode: 0,
      commandPreview: "katago",
    });
    expect(doc.ok).toBe(false);
    expect(doc.error).toBeTruthy();
  });

  it("exit 비정상이면 ok:false", () => {
    const raw = JSON.stringify({
      rootInfo: { winrate: 0.1 },
      moveInfos: [{ move: "B1" }],
    });
    const doc = buildKatagoSmokeNormalized({
      sgfSha256: "d".repeat(64),
      sgfSizeBytes: 3,
      rawStdout: raw,
      exitCode: 2,
      commandPreview: "katago",
    });
    expect(doc.ok).toBe(false);
    expect(doc.error).toMatch(/비정상 종료/);
  });
});

describe("sgfPayload (smoke 연동)", () => {
  it("UTF-8 기준 sha256·byte length", () => {
    const s = "(;FF[4]GM[1]SZ[9];B[pd])";
    expect(utf8ByteLength(s)).toBe(Buffer.byteLength(s, "utf8"));
    expect(sha256HexUtf8(s)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("katagoSgfQuery", () => {
  it("SZ·KM·순차 수 파싱", () => {
    const p = parseMinimalSgfForSmoke("(;FF[4]SZ[19]KM[7.5];B[pd];W[dd])");
    expect(p.boardSize).toBe(19);
    expect(p.komi).toBe(7.5);
    expect(p.moves).toEqual([
      { color: "B", sgfPoint: "pd" },
      { color: "W", sgfPoint: "dd" },
    ]);
  });

  it("SZ 없으면 19, KM 없으면 6.5", () => {
    const p = parseMinimalSgfForSmoke("(;FF[4];B[aa])");
    expect(p.boardSize).toBe(19);
    expect(p.komi).toBe(6.5);
    expect(p.moves).toHaveLength(1);
  });

  it("19x19 필수 GTP 좌표 (SGF i 포함·GTP 열만 I 생략)", () => {
    expect(sgfPointToGtp("aa", 19)).toBe("A19");
    expect(sgfPointToGtp("dd", 19)).toBe("D16");
    expect(sgfPointToGtp("pd", 19)).toBe("Q16");
    expect(sgfPointToGtp("jj", 19)).toBe("K10");
    expect(sgfPointToGtp("ss", 19)).toBe("T1");
  });

  it("SGF 소문자 i 는 19x19 에서 인덱스 8", () => {
    expect(sgfLetterToCoordIndex("i", 19)).toBe(8);
    expect(sgfPointToGtp("ii", 19)).toBe("J11");
  });

  it("tt: 19x19 이하만 pass, 그보다 큰 보드는 좌표", () => {
    expect(sgfPointToGtp("tt", 19)).toBe("pass");
    expect(sgfPointToGtp("tt", 9)).toBe("pass");
    expect(sgfPointToGtp("tt", 21)).toBe("U2");
  });

  it("B[] W[] 빈 좌표는 pass", () => {
    expect(sgfPointToGtp("", 19)).toBe("pass");
    const q = buildKatagoAnalysisQueryObject({
      boardSize: 19,
      komi: 6.5,
      moves: [
        { color: "B", sgfPoint: "" },
        { color: "W", sgfPoint: "dd" },
      ],
      maxVisits: 1,
      id: "t",
    });
    expect(q.moves[0]).toEqual(["B", "pass"]);
    expect(q.moves[1]).toEqual(["W", "D16"]);
  });

  it("GTP 열만 I 생략 (열 8 → J)", () => {
    expect(indexToGtpColumn(8)).toBe("J");
    expect(indexToGtpColumn(7)).toBe("H");
  });

  it("JSON query 에 maxVisits 포함", () => {
    const q = buildKatagoAnalysisQueryObject({
      boardSize: 19,
      komi: 6.5,
      moves: [{ color: "B", sgfPoint: "dd" }],
      maxVisits: 123,
      id: "x",
    });
    expect(q.maxVisits).toBe(123);
    expect(q.moves[0]).toEqual(["B", "D16"]);
    const line = buildKatagoAnalysisQueryLine({
      boardSize: 19,
      komi: 6.5,
      moves: [{ color: "B", sgfPoint: "dd" }],
      maxVisits: 123,
      id: "x",
    });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line.trim())).toEqual(q);
  });
});

describe("raceOutputWithTimeout", () => {
  it("출력이 먼저 끝나면 타이머를 취소해 이후에도 onTimeout 이 실행되지 않는다", async () => {
    vi.useFakeTimers();
    try {
      let killed = false;
      const out = Promise.resolve({ done: true } as const);
      const p = raceOutputWithTimeout(out, 50_000, () => {
        killed = true;
      });
      await p;
      await vi.advanceTimersByTimeAsync(100_000);
      expect(killed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("resolveSgfPathFromArgv", () => {
  it("-- 뒤 경로를 우선", () => {
    expect(resolveSgfPathFromArgv(["--", "./samples/a.sgf"])).toBe("./samples/a.sgf");
  });

  it("마지막 인자를 SGF 로", () => {
    expect(resolveSgfPathFromArgv(["./samples/b.sgf"])).toBe("./samples/b.sgf");
  });
});

describe("runKatagoSmoke (spawn mock)", () => {
  const saved = { ...process.env };

  afterEach(() => {
    for (const k of ["KATAGO_BINARY_PATH", "KATAGO_CONFIG_PATH", "KATAGO_MODEL_PATH"] as const) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
  });

  it("mock spawn: argv 에 -sgf 없음, stdin 에 JSON 한 줄", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "katago-smoke-test-"));
    const sgfPath = path.join(dir, "game.sgf");
    await writeFile(sgfPath, "(;FF[4]GM[1]SZ[19];B[pd];W[dd])", "utf8");

    const stdout = JSON.stringify({
      rootInfo: { winrate: 0.55, scoreLead: 0.3 },
      moveInfos: [{ move: "Q16", order: 0, winrate: 0.56 }],
    });

    let capturedArgs: string[] = [];
    let stdinReceived = "";

    const mockSpawn: SpawnFn = (_cmd, args, _opts) => {
      capturedArgs = [...args];
      expect(args.includes("-sgf")).toBe(false);
      expect(args).toEqual(["analysis", "-config", "/fake/cfg.cfg", "-model", "/fake/model.bin.gz"]);

      const proc = new EventEmitter() as ChildProcess;
      const stdin = new Writable({
        write(chunk: Buffer | string, _enc, cb) {
          stdinReceived += typeof chunk === "string" ? chunk : chunk.toString("utf8");
          cb();
        },
        final(cb) {
          setImmediate(() => {
            out.end(stdout, "utf8");
          });
          cb();
        },
      });
      const out = new PassThrough();
      const err = new PassThrough();
      proc.stdin = stdin;
      proc.stdout = out;
      proc.stderr = err;
      err.end();
      out.on("end", () => {
        setImmediate(() => {
          proc.emit("close", 0, null);
        });
      });
      return proc;
    };

    const outDir = path.join(dir, "out");
    const env = {
      KATAGO_BINARY_PATH: "/fake/katago",
      KATAGO_CONFIG_PATH: "/fake/cfg.cfg",
      KATAGO_MODEL_PATH: "/fake/model.bin.gz",
      KATAGO_MAX_VISITS: "50",
      KATAGO_ANALYSIS_TIMEOUT_MS: "5000",
    };

    const { rawPath, normalizedPath, document } = await runKatagoSmoke({
      sgfPath,
      cwd: dir,
      env,
      outDir,
      spawnFn: mockSpawn,
    });

    expect(document.ok).toBe(true);
    const query = JSON.parse(stdinReceived.trim()) as { maxVisits: number; moves: [string, string][]; id: string };
    expect(query.maxVisits).toBe(50);
    expect(query.moves).toEqual([
      ["B", "Q16"],
      ["W", "D16"],
    ]);
    expect(query.id.startsWith("katatalk-smoke-")).toBe(true);

    const rawRead = await readFile(rawPath, "utf8");
    expect(rawRead).toBe(stdout);
    const norm = JSON.parse(await readFile(normalizedPath, "utf8")) as typeof document;
    expect(norm.input.sgfSha256).toBe(sha256HexUtf8("(;FF[4]GM[1]SZ[19];B[pd];W[dd])"));
    expect(norm.normalized.hasWinrate).toBe(true);
    expect(capturedArgs.join(" ")).not.toMatch(/sgf/);

    await rm(dir, { recursive: true, force: true });
  });
});
