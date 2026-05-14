import type { AnalysisPlanCandidateTurnV1, AnalysisPlanV1 } from "@shared/analysisPlanV1";
import type {
  MultiTurnKatagoAnalysisMetaV1,
  TurnAnalysisComparisonReadyV1,
  TurnAnalysisEntryFailedV1,
  TurnAnalysisEntrySuccessV1,
  TurnAnalysisEntryV1,
  TurnAnalysisKatagoSliceV1,
} from "@shared/multiTurnKatagoAnalysisV1";
import { MULTI_TURN_KATAGO_ANALYSIS_V1_VERSION } from "@shared/multiTurnKatagoAnalysisV1";
import {
  selectCandidatesForMultiTurnAnalysis,
  sliceMovesBeforeTurnIndex,
} from "../../analysisPlan";
import {
  readKatagoMaxVisitsFrom,
  readKatagoMultiTurnBatchTimeoutMsFrom,
  readKatagoMultiTurnMaxFrom,
  readKatagoMultiTurnMaxVisitsFrom,
  readKatagoMultiTurnQueryTimeoutMsFrom,
} from "./config";
import {
  buildKatagoSmokeNormalized,
  extractJsonObjectsFromKatagoStdout,
  pickPrimaryAnalysisObject,
  validateKatagoWorkerV1Document,
} from "./katagoRawParser";
import { buildKatagoAnalysisQueryLine, type ParsedMinimalSgf } from "./katagoSgfQuery";
import { runKatagoWorkerAnalysisQueryLines, summarizeKatagoStderrForDb, type SpawnFn } from "./katagoSmokeRun";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function indexAnalysisObjectsById(stdout: string): Map<string, Record<string, unknown>> {
  const m = new Map<string, Record<string, unknown>>();
  for (const o of extractJsonObjectsFromKatagoStdout(stdout)) {
    if (isPlainObject(o) && typeof o.id === "string") {
      m.set(o.id, o);
    }
  }
  return m;
}

function buildComparisonReady(playedMove: string, moveInfos: unknown[]): TurnAnalysisComparisonReadyV1 {
  let playedMoveRank: number | null = null;
  for (let i = 0; i < moveInfos.length; i++) {
    const row = moveInfos[i];
    if (!isPlainObject(row)) {
      continue;
    }
    const mv = row.move;
    if (mv === playedMove) {
      playedMoveRank = i + 1;
      break;
    }
  }
  const top0 = moveInfos[0];
  const bestMove = isPlainObject(top0) && typeof top0.move === "string" ? top0.move : null;
  return {
    playedMoveFoundInCandidates: playedMoveRank != null,
    playedMoveRank,
    bestMove,
  };
}

type PreparedTurn = {
  candidate: AnalysisPlanCandidateTurnV1;
  queryId: string;
  queryLine: string;
  query: { movesBeforeCount: number; boardSize: number; komi: number };
  playedMoveGtp: string;
  player: "B" | "W";
};

function prepareTurns(
  parsed: ParsedMinimalSgf,
  candidates: AnalysisPlanCandidateTurnV1[],
  maxVisits: number,
  jobId: string,
  ts: string
): PreparedTurn[] {
  return candidates.map((c, i) => {
    const { movesBefore, movesBeforeCount, playedMoveGtp, player } = sliceMovesBeforeTurnIndex(parsed, c.turnIndex);
    const queryId = `katatalk-mt-${jobId}--turn-${String(c.turnIndex)}--${String(i)}-${ts}`;
    const queryLine = buildKatagoAnalysisQueryLine({
      boardSize: parsed.boardSize,
      komi: parsed.komi,
      moves: movesBefore,
      maxVisits,
      id: queryId,
    });
    return {
      candidate: c,
      queryId,
      queryLine,
      query: { movesBeforeCount, boardSize: parsed.boardSize, komi: parsed.komi },
      playedMoveGtp,
      player,
    };
  });
}

function failedEntry(p: PreparedTurn, error: string): TurnAnalysisEntryFailedV1 {
  return {
    status: "failed",
    turnIndex: p.candidate.turnIndex,
    player: p.player,
    playedMove: p.playedMoveGtp,
    reason: p.candidate.reason,
    priority: p.candidate.priority,
    query: p.query,
    error,
  };
}

function entryForPrepared(
  p: PreparedTurn,
  rawObj: Record<string, unknown> | undefined,
  stderr: string,
  sgfSha256: string,
  sgfSizeBytes: number,
  exitCode: number | null
): TurnAnalysisEntryV1 {
  if (!rawObj) {
    return failedEntry(p, "KATAGO_MULTI_TURN_NO_RESPONSE: stdout 에 해당 id 의 JSON 을 찾지 못했습니다.");
  }
  const line = JSON.stringify(rawObj);
  try {
    const doc = buildKatagoSmokeNormalized({
      sgfSha256,
      sgfSizeBytes,
      rawStdout: `${line}\n`,
      exitCode,
      commandPreview: "katago analysis (multi-turn)",
    });
    validateKatagoWorkerV1Document(doc);
    const moveInfos = Array.isArray(rawObj.moveInfos) ? (rawObj.moveInfos as unknown[]) : [];
    const katago: TurnAnalysisKatagoSliceV1 = {
      rootInfo: doc.katago.rootInfo,
      topMove: doc.katago.topMove,
      moveInfosCount: doc.katago.moveInfosCount,
      hasWinrate: doc.normalized.hasWinrate,
      hasScoreLead: doc.normalized.hasScoreLead,
      hasOwnership: doc.normalized.hasOwnership,
    };
    const success: TurnAnalysisEntrySuccessV1 = {
      status: "ok",
      turnIndex: p.candidate.turnIndex,
      player: p.player,
      playedMove: p.playedMoveGtp,
      reason: p.candidate.reason,
      priority: p.candidate.priority,
      query: p.query,
      katago,
      comparisonReady: buildComparisonReady(p.playedMoveGtp, moveInfos),
    };
    return success;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const tail = summarizeKatagoStderrForDb(stderr);
    return failedEntry(p, tail && !msg.includes(tail.slice(0, 12)) ? `${msg} stderr: ${tail}` : msg);
  }
}

async function executeBatch(
  prepared: PreparedTurn[],
  opts: {
    jobId: string;
    env: NodeJS.ProcessEnv;
    spawnFn?: SpawnFn;
    sgfSha256: string;
    sgfSizeBytes: number;
  }
): Promise<TurnAnalysisEntryV1[]> {
  const stdinPayload = prepared.map((p) => p.queryLine).join("");
  const batchTimeout = readKatagoMultiTurnBatchTimeoutMsFrom(opts.env, prepared.length);
  let stdout = "";
  let stderr = "";
  let code: number | null = 0;
  try {
    const ran = await runKatagoWorkerAnalysisQueryLines({
      stdinPayload,
      jobId: opts.jobId,
      env: opts.env,
      spawnFn: opts.spawnFn,
      timeoutMs: batchTimeout,
    });
    stdout = ran.stdout;
    stderr = ran.stderr;
    code = ran.code;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const tail = summarizeKatagoStderrForDb(stderr);
    return prepared.map((p) => failedEntry(p, `${msg}${tail ? ` ${tail}` : ""}`));
  }
  if (code !== 0 && code !== null) {
    const tail = summarizeKatagoStderrForDb(stderr);
    const msg = `KATAGO_EXIT_NONZERO: exit ${String(code)}${tail ? ` — ${tail}` : ""}`;
    return prepared.map((p) => failedEntry(p, msg));
  }
  const byId = indexAnalysisObjectsById(stdout);
  return prepared.map((p) => entryForPrepared(p, byId.get(p.queryId), stderr, opts.sgfSha256, opts.sgfSizeBytes, code));
}

async function executeSequential(
  prepared: PreparedTurn[],
  opts: {
    jobId: string;
    env: NodeJS.ProcessEnv;
    spawnFn?: SpawnFn;
    sgfSha256: string;
    sgfSizeBytes: number;
  }
): Promise<TurnAnalysisEntryV1[]> {
  const qTimeout = readKatagoMultiTurnQueryTimeoutMsFrom(opts.env);
  const out: TurnAnalysisEntryV1[] = [];
  for (const p of prepared) {
    let stdout = "";
    let stderr = "";
    let code: number | null = 0;
    try {
      const ran = await runKatagoWorkerAnalysisQueryLines({
        stdinPayload: p.queryLine,
        jobId: opts.jobId,
        env: opts.env,
        spawnFn: opts.spawnFn,
        timeoutMs: qTimeout,
      });
      stdout = ran.stdout;
      stderr = ran.stderr;
      code = ran.code;
      if (code !== 0 && code !== null) {
        const tail = summarizeKatagoStderrForDb(stderr);
        out.push(failedEntry(p, `KATAGO_EXIT_NONZERO: exit ${String(code)}${tail ? ` — ${tail}` : ""}`));
        continue;
      }
      const byId = indexAnalysisObjectsById(stdout);
      const fallback = pickPrimaryAnalysisObject(extractJsonObjectsFromKatagoStdout(stdout));
      const rawObj = (byId.get(p.queryId) ?? fallback) ?? undefined;
      out.push(entryForPrepared(p, rawObj, stderr, opts.sgfSha256, opts.sgfSizeBytes, code));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const tail = summarizeKatagoStderrForDb(stderr);
      out.push(failedEntry(p, tail && !msg.includes(tail.slice(0, 12)) ? `${msg} ${tail}` : msg));
    }
  }
  return out;
}

function emptyMeta(maxRuns: number): MultiTurnKatagoAnalysisMetaV1 {
  return {
    version: MULTI_TURN_KATAGO_ANALYSIS_V1_VERSION,
    candidateCount: 0,
    completedCount: 0,
    failedCount: 0,
    maxTurnsAnalyzed: maxRuns,
  };
}

/**
 * analysisPlan 후보별 “N번째 수 직전” 국면 KataGo raw (정규화 슬라이스만).
 * 기본은 stdin 여러 줄을 한 프로세스에 보냄 (`KATAGO_MULTI_TURN_BATCH=0` 이면 수순마다 별도 프로세스 — 비효율, README 참고).
 */
export async function runMultiTurnKatagoRawV1(opts: {
  parsed: ParsedMinimalSgf;
  plan: AnalysisPlanV1;
  jobId: string;
  sgfSha256: string;
  sgfSizeBytes: number;
  env: NodeJS.ProcessEnv;
  spawnFn?: SpawnFn;
}): Promise<{ turnAnalyses: TurnAnalysisEntryV1[]; multiTurnAnalysis: MultiTurnKatagoAnalysisMetaV1 }> {
  const maxRuns = readKatagoMultiTurnMaxFrom(opts.env);
  if (maxRuns === 0 || opts.parsed.moves.length === 0) {
    return { turnAnalyses: [], multiTurnAnalysis: emptyMeta(maxRuns) };
  }
  const candidates = selectCandidatesForMultiTurnAnalysis(opts.plan, maxRuns);
  if (candidates.length === 0) {
    return { turnAnalyses: [], multiTurnAnalysis: emptyMeta(maxRuns) };
  }
  const baseMaxVisits = readKatagoMaxVisitsFrom(opts.env);
  const mtMaxVisits = readKatagoMultiTurnMaxVisitsFrom(opts.env, baseMaxVisits);
  const ts = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const prepared = prepareTurns(opts.parsed, candidates, mtMaxVisits, opts.jobId, ts);

  const useBatch = opts.env.KATAGO_MULTI_TURN_BATCH?.trim() !== "0";
  const turnAnalyses = useBatch
    ? await executeBatch(prepared, opts)
    : await executeSequential(prepared, opts);

  const completedCount = turnAnalyses.filter((t) => t.status === "ok").length;
  const failedCount = turnAnalyses.filter((t) => t.status === "failed").length;
  return {
    turnAnalyses,
    multiTurnAnalysis: {
      version: MULTI_TURN_KATAGO_ANALYSIS_V1_VERSION,
      candidateCount: candidates.length,
      completedCount,
      failedCount,
      maxTurnsAnalyzed: maxRuns,
    },
  };
}
