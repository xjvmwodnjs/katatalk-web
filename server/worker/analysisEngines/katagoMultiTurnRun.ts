import type { AnalysisPlanCandidateTurnV1, AnalysisPlanV1 } from "@shared/analysisPlanV1";
import type {
  MultiTurnKatagoAnalysisMetaV1,
  TurnAnalysisCandidateMoveSummaryV1,
  TurnAnalysisComparisonReadyV1,
  TurnAnalysisEntryFailedV1,
  TurnAnalysisEntrySuccessV1,
  TurnAnalysisEntryV1,
  TurnAnalysisKatagoSliceV1,
  TurnAnalysisMovePairSummaryV1,
  TurnAnalysisMoveSummaryV1,
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

type StrictStdoutMatch =
  | { ok: true; byId: Map<string, Record<string, unknown>>; unknownResponseIdCount: number }
  | { ok: false; error: string };

/**
 * stdout JSON/JSONL에서 `id` 문자열이 있는 객체만 매칭 후보로 본다(`id` 없는 분석 객체는 무시).
 * 기대 id 집합 밖의 id 는 unknownResponseIdCount 만 증가.
 * 동일 id 가 두 번 이상이면 실패(KATAGO_MULTI_TURN_DUPLICATE_ID).
 */
function matchStdoutByExpectedIds(stdout: string, expectedIds: readonly string[]): StrictStdoutMatch {
  const expectedSet = new Set(expectedIds);
  const seen = new Set<string>();
  const byId = new Map<string, Record<string, unknown>>();
  let unknownResponseIdCount = 0;

  for (const o of extractJsonObjectsFromKatagoStdout(stdout)) {
    if (!isPlainObject(o)) {
      continue;
    }
    const id = o.id;
    if (typeof id !== "string" || id.length === 0) {
      continue;
    }
    if (seen.has(id)) {
      return {
        ok: false,
        error: `KATAGO_MULTI_TURN_DUPLICATE_ID: stdout 에 동일 id 가 중복되었습니다: ${id}`,
      };
    }
    seen.add(id);
    if (expectedSet.has(id)) {
      byId.set(id, o);
    } else {
      unknownResponseIdCount += 1;
    }
  }

  return { ok: true, byId, unknownResponseIdCount };
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

function summarizeMoveRow(row: unknown): TurnAnalysisMoveSummaryV1 | null {
  if (!isPlainObject(row) || typeof row.move !== "string" || row.move.length === 0) {
    return null;
  }
  const winrate = typeof row.winrate === "number" && Number.isFinite(row.winrate) ? row.winrate : undefined;
  const scoreLead = typeof row.scoreLead === "number" && Number.isFinite(row.scoreLead) ? row.scoreLead : undefined;
  const scoreMean = typeof row.scoreMean === "number" && Number.isFinite(row.scoreMean) ? row.scoreMean : undefined;
  const visits = typeof row.visits === "number" && Number.isFinite(row.visits) && row.visits >= 0 ? row.visits : undefined;
  return {
    move: row.move,
    ...(winrate !== undefined ? { winrate } : {}),
    ...(scoreLead !== undefined ? { scoreLead } : {}),
    ...(scoreMean !== undefined ? { scoreMean } : {}),
    ...(visits !== undefined ? { visits } : {}),
  };
}

function buildMovePairSummary(playedGtp: string, moveInfos: unknown[]): TurnAnalysisMovePairSummaryV1 {
  const best = moveInfos.length > 0 ? summarizeMoveRow(moveInfos[0]) : null;
  let playedRow: unknown;
  for (const m of moveInfos) {
    if (isPlainObject(m) && m.move === playedGtp) {
      playedRow = m;
      break;
    }
  }
  const played = playedRow != null ? summarizeMoveRow(playedRow) : null;
  return { best, played };
}

const MAX_CANDIDATE_MOVE_SUMMARY_ROWS = 16;

function buildCandidateMovesSummary(moveInfos: unknown[]): TurnAnalysisCandidateMoveSummaryV1[] {
  const out: TurnAnalysisCandidateMoveSummaryV1[] = [];
  for (let i = 0; i < moveInfos.length && out.length < MAX_CANDIDATE_MOVE_SUMMARY_ROWS; i++) {
    const row = moveInfos[i];
    if (!isPlainObject(row) || typeof row.move !== "string" || row.move.length === 0) {
      continue;
    }
    const order = i + 1;
    const visits =
      typeof row.visits === "number" && Number.isFinite(row.visits) && row.visits >= 0 ? row.visits : undefined;
    const prior =
      typeof row.prior === "number" && Number.isFinite(row.prior)
        ? row.prior
        : typeof row.policy === "number" && Number.isFinite(row.policy)
          ? row.policy
          : undefined;
    const winrate =
      typeof row.winrate === "number" && Number.isFinite(row.winrate) ? row.winrate : undefined;
    const scoreLead =
      typeof row.scoreLead === "number" && Number.isFinite(row.scoreLead) ? row.scoreLead : undefined;
    const scoreMean =
      typeof row.scoreMean === "number" && Number.isFinite(row.scoreMean) ? row.scoreMean : undefined;
    let pvLength = 0;
    if (Array.isArray(row.pv)) {
      pvLength = row.pv.length;
    }
    out.push({
      move: row.move,
      order,
      pvLength,
      ...(visits !== undefined ? { visits } : {}),
      ...(prior !== undefined ? { prior } : {}),
      ...(winrate !== undefined ? { winrate } : {}),
      ...(scoreLead !== undefined ? { scoreLead } : {}),
      ...(scoreMean !== undefined ? { scoreMean } : {}),
    });
  }
  return out;
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
  exitCode: number | null,
  opts?: { fallbackUsed?: boolean }
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
    const moveSummary = buildMovePairSummary(p.playedMoveGtp, moveInfos);
    const candidateMoves = buildCandidateMovesSummary(moveInfos);
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
      moveSummary,
      candidateMoves,
      ...(opts?.fallbackUsed ? { fallbackUsed: true } : {}),
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
): Promise<{ entries: TurnAnalysisEntryV1[]; unknownResponseIdCount: number }> {
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
    return {
      entries: prepared.map((p) => failedEntry(p, `${msg}${tail ? ` ${tail}` : ""}`)),
      unknownResponseIdCount: 0,
    };
  }
  if (code !== 0 && code !== null) {
    const tail = summarizeKatagoStderrForDb(stderr);
    const msg = `KATAGO_EXIT_NONZERO: exit ${String(code)}${tail ? ` — ${tail}` : ""}`;
    return { entries: prepared.map((p) => failedEntry(p, msg)), unknownResponseIdCount: 0 };
  }

  const expectedIds = prepared.map((p) => p.queryId);
  const match = matchStdoutByExpectedIds(stdout, expectedIds);
  if (!match.ok) {
    return { entries: prepared.map((p) => failedEntry(p, match.error)), unknownResponseIdCount: 0 };
  }
  if (match.unknownResponseIdCount > 0) {
    console.warn(
      `[katago-multi-turn] stdout 에 기대 id 외 응답 ${String(match.unknownResponseIdCount)}건(원문 id 미로그)`
    );
  }

  const entries = prepared.map((p) => {
    const raw = match.byId.get(p.queryId);
    if (!raw) {
      return failedEntry(p, "KATAGO_MULTI_TURN_MISSING_ID: stdout 에 요청한 id 가 없습니다.");
    }
    return entryForPrepared(p, raw, stderr, opts.sgfSha256, opts.sgfSizeBytes, code);
  });
  return { entries, unknownResponseIdCount: match.unknownResponseIdCount };
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
): Promise<{ entries: TurnAnalysisEntryV1[]; unknownResponseIdCount: number }> {
  const qTimeout = readKatagoMultiTurnQueryTimeoutMsFrom(opts.env);
  const allowIdlessFallback =
    opts.env.KATAGO_MULTI_TURN_ALLOW_IDLESS_SEQUENTIAL_FALLBACK?.trim().toLowerCase() === "true";
  const out: TurnAnalysisEntryV1[] = [];
  let unknownTotal = 0;

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
      const match = matchStdoutByExpectedIds(stdout, [p.queryId]);
      if (!match.ok) {
        out.push(failedEntry(p, match.error));
        continue;
      }
      unknownTotal += match.unknownResponseIdCount;
      if (match.unknownResponseIdCount > 0) {
        console.warn(
          `[katago-multi-turn] sequential stdout 에 기대 id 외 응답 ${String(match.unknownResponseIdCount)}건(원문 id 미로그)`
        );
      }

      let rawObj = match.byId.get(p.queryId);
      let fallbackUsed = false;
      if (!rawObj && allowIdlessFallback) {
        const fb = pickPrimaryAnalysisObject(extractJsonObjectsFromKatagoStdout(stdout));
        if (fb && isPlainObject(fb)) {
          rawObj = fb;
          fallbackUsed = true;
        }
      }
      if (!rawObj) {
        out.push(
          failedEntry(
            p,
            "KATAGO_MULTI_TURN_MISSING_ID: stdout 에 요청 id 가 없고 id-less 폴백도 비활성입니다."
          )
        );
        continue;
      }
      out.push(entryForPrepared(p, rawObj, stderr, opts.sgfSha256, opts.sgfSizeBytes, code, { fallbackUsed }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const tail = summarizeKatagoStderrForDb(stderr);
      out.push(failedEntry(p, tail && !msg.includes(tail.slice(0, 12)) ? `${msg} ${tail}` : msg));
    }
  }
  return { entries: out, unknownResponseIdCount: unknownTotal };
}

function buildMultiTurnMeta(args: {
  maxRuns: number;
  candidateCount: number;
  completedCount: number;
  failedCount: number;
  unknownResponseIdCount: number;
}): MultiTurnKatagoAnalysisMetaV1 {
  const attemptedCount = args.candidateCount;
  const allFailed = args.completedCount === 0 && args.failedCount > 0 && attemptedCount > 0;
  const partialFailure = args.failedCount > 0 && args.completedCount > 0;
  const meta: MultiTurnKatagoAnalysisMetaV1 = {
    version: MULTI_TURN_KATAGO_ANALYSIS_V1_VERSION,
    maxTurnsRequested: args.maxRuns,
    maxTurnsAnalyzed: args.maxRuns,
    candidateCount: args.candidateCount,
    attemptedCount,
    completedCount: args.completedCount,
    failedCount: args.failedCount,
    allFailed,
    partialFailure,
  };
  if (args.unknownResponseIdCount > 0) {
    meta.unknownResponseIdCount = args.unknownResponseIdCount;
  }
  return meta;
}

function emptyMeta(maxRuns: number): MultiTurnKatagoAnalysisMetaV1 {
  return buildMultiTurnMeta({
    maxRuns,
    candidateCount: 0,
    completedCount: 0,
    failedCount: 0,
    unknownResponseIdCount: 0,
  });
}

/**
 * analysisPlan 후보별 “N번째 수 직전” 국면 KataGo raw (정규화 슬라이스만).
 * 기본은 stdin 여러 줄을 한 프로세스에 보냄 (`KATAGO_MULTI_TURN_BATCH=0` 이면 수순마다 별도 프로세스 — 비효율·README 참고).
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
  const { entries: turnAnalyses, unknownResponseIdCount } = useBatch
    ? await executeBatch(prepared, opts)
    : await executeSequential(prepared, opts);

  const completedCount = turnAnalyses.filter((t) => t.status === "ok").length;
  const failedCount = turnAnalyses.filter((t) => t.status === "failed").length;
  return {
    turnAnalyses,
    multiTurnAnalysis: buildMultiTurnMeta({
      maxRuns,
      candidateCount: candidates.length,
      completedCount,
      failedCount,
      unknownResponseIdCount,
    }),
  };
}
