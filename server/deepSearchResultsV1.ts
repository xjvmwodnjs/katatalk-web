import type { DeepSearchPlanV1Result } from "@shared/deepSearchPlanV1";
import {
  DEEP_SEARCH_RESULTS_V1_COMPUTED_FROM,
  DEEP_SEARCH_RESULTS_V1_VERSION,
  type DeepSearchResultsPolicyV1,
  type DeepSearchResultsV1Result,
  type DeepSearchResultComparisonV1,
  type DeepSearchResultKatagoSliceV1,
  type DeepSearchResultQueryV1,
  type DeepSearchSingleResultFailedV1,
  type DeepSearchSingleResultOkV1,
  type DeepSearchSingleResultV1,
} from "@shared/deepSearchResultsV1";
import { sliceMovesBeforeTurnIndex } from "./analysisPlan";
import { buildKatagoSmokeNormalized, validateKatagoWorkerV1Document } from "./worker/analysisEngines/katagoRawParser";
import { matchStdoutByExpectedIds } from "./worker/analysisEngines/katagoMultiTurnRun";
import { buildKatagoAnalysisQueryLine, type ParsedMinimalSgf } from "./worker/analysisEngines/katagoSgfQuery";
import { runKatagoWorkerAnalysisQueryLines, summarizeKatagoStderrForDb, type SpawnFn } from "./worker/analysisEngines/katagoSmokeRun";

const DEFAULT_MAX_CANDIDATES = 2;
const DEFAULT_VISITS = 800;
const DEFAULT_TIMEOUT_MS = 180_000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** `KATAGO_DEEP_SEARCH_ENABLED` 는 문자열 `true`(대소문자 무시)일 때만 활성. */
export function readDeepSearchExecutionEnabledFromEnv(env: NodeJS.ProcessEnv): boolean {
  return env.KATAGO_DEEP_SEARCH_ENABLED?.trim().toLowerCase() === "true";
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function readDeepSearchExecutionPolicyFromEnv(env: NodeJS.ProcessEnv): DeepSearchResultsPolicyV1 {
  const maxRaw = env.KATAGO_DEEP_SEARCH_MAX_CANDIDATES?.trim();
  let maxCandidates = DEFAULT_MAX_CANDIDATES;
  if (maxRaw) {
    const n = Number.parseInt(maxRaw, 10);
    if (Number.isFinite(n)) {
      maxCandidates = clampInt(n, 1, 5);
    }
  }

  const visitsRaw = env.KATAGO_DEEP_SEARCH_VISITS?.trim();
  let visits = DEFAULT_VISITS;
  if (visitsRaw) {
    const n = Number.parseInt(visitsRaw, 10);
    if (Number.isFinite(n)) {
      visits = clampInt(n, 100, 5000);
    }
  }

  const timeoutRaw = env.KATAGO_DEEP_SEARCH_TIMEOUT_MS?.trim();
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (timeoutRaw) {
    const n = Number.parseInt(timeoutRaw, 10);
    if (Number.isFinite(n)) {
      timeoutMs = clampInt(n, 30_000, 900_000);
    }
  }

  return {
    mode: "sequential",
    maxCandidates,
    visits,
    timeoutMs,
  };
}

function buildComparison(
  playedMove: string,
  plannedBestMove: string | null,
  moveInfos: unknown[]
): DeepSearchResultComparisonV1 {
  let playedMoveRank: number | null = null;
  for (let i = 0; i < moveInfos.length; i++) {
    const row = moveInfos[i];
    if (!isPlainObject(row) || typeof row.move !== "string") {
      continue;
    }
    if (row.move === playedMove) {
      playedMoveRank = i + 1;
      break;
    }
  }
  const top0 = moveInfos[0];
  const deepBestMove =
    isPlainObject(top0) && typeof top0.move === "string" && top0.move.length > 0 ? top0.move : null;
  const plannedBestMoveStillTop =
    plannedBestMove != null && deepBestMove != null && deepBestMove === plannedBestMove;
  return {
    deepBestMove,
    plannedBestMove,
    plannedBestMoveStillTop,
    playedMoveRank,
  };
}

function errorCodeFromMessage(msg: string): string {
  const head = msg.split(/[\s:—]/)[0] ?? "";
  if (/^[A-Z][A-Z0-9_]+$/.test(head) && head.length <= 64) {
    return head;
  }
  return "DEEP_SEARCH_FAILED";
}

function shortMessage(msg: string, maxLen = 240): string {
  const t = msg.replace(/\s+/g, " ").trim();
  return t.length <= maxLen ? t : `${t.slice(0, maxLen - 1)}…`;
}

function failedRow(args: {
  turnIndex: number;
  player: "B" | "W";
  playedMove: string;
  plannedBestMove: string | null;
  query: DeepSearchResultQueryV1;
  message: string;
}): DeepSearchSingleResultFailedV1 {
  const message = shortMessage(args.message);
  return {
    turnIndex: args.turnIndex,
    player: args.player,
    playedMove: args.playedMove,
    plannedBestMove: args.plannedBestMove,
    status: "failed",
    query: args.query,
    error: { code: errorCodeFromMessage(message), message },
  };
}

/**
 * Worker 전용: `deepSearchPlan.candidates` 일부에 대해 높은 visits KataGo `analysis` 를 순차 실행한다.
 * 비활성·후보 없음이면 KataGo 를 호출하지 않는다.
 */
export async function computeDeepSearchResultsV1(opts: {
  env: NodeJS.ProcessEnv;
  jobId: string;
  parsed: ParsedMinimalSgf;
  deepSearchPlan: DeepSearchPlanV1Result;
  sgfSha256: string;
  sgfSizeBytes: number;
  spawnFn?: SpawnFn;
}): Promise<DeepSearchResultsV1Result> {
  const policy = readDeepSearchExecutionPolicyFromEnv(opts.env);
  const enabled = readDeepSearchExecutionEnabledFromEnv(opts.env);
  const candidateCount = opts.deepSearchPlan.candidates.length;

  if (!enabled) {
    return {
      version: DEEP_SEARCH_RESULTS_V1_VERSION,
      computedFrom: DEEP_SEARCH_RESULTS_V1_COMPUTED_FROM,
      enabled: false,
      policy,
      candidateCount,
      attemptedCount: 0,
      completedCount: 0,
      failedCount: 0,
      partialFailure: false,
      allFailed: false,
      results: [],
    };
  }

  const toRun = opts.deepSearchPlan.candidates.slice(0, policy.maxCandidates);
  const attemptedCount = toRun.length;
  if (attemptedCount === 0) {
    return {
      version: DEEP_SEARCH_RESULTS_V1_VERSION,
      computedFrom: DEEP_SEARCH_RESULTS_V1_COMPUTED_FROM,
      enabled: true,
      policy,
      candidateCount,
      attemptedCount: 0,
      completedCount: 0,
      failedCount: 0,
      partialFailure: false,
      allFailed: false,
      results: [],
    };
  }

  const results: DeepSearchSingleResultV1[] = [];
  const ts = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  for (let i = 0; i < toRun.length; i++) {
    const c = toRun[i]!;
    const plannedBestMove = c.bestMove;
    let movesBeforeCount = 0;
    const boardSize = opts.parsed.boardSize;
    const komi = opts.parsed.komi;
    let playedMove = c.playedMove;
    let player = c.player;
    const queryBase: DeepSearchResultQueryV1 = {
      movesBeforeCount: 0,
      boardSize,
      komi,
      maxVisits: policy.visits,
    };

    let sliced: ReturnType<typeof sliceMovesBeforeTurnIndex>;
    try {
      sliced = sliceMovesBeforeTurnIndex(opts.parsed, c.turnIndex);
      movesBeforeCount = sliced.movesBeforeCount;
      playedMove = sliced.playedMoveGtp;
      player = sliced.player;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push(
        failedRow({
          turnIndex: c.turnIndex,
          player: c.player,
          playedMove: c.playedMove,
          plannedBestMove,
          query: { ...queryBase, movesBeforeCount: Math.max(0, c.turnIndex - 1) },
          message: msg,
        })
      );
      continue;
    }

    const queryId = `katatalk-ds-${opts.jobId}--turn-${String(c.turnIndex)}--${String(i)}-${ts}`;
    const queryLine = buildKatagoAnalysisQueryLine({
      boardSize: opts.parsed.boardSize,
      komi: opts.parsed.komi,
      rules: opts.parsed.rules,
      moves: sliced.movesBefore,
      initialStones: opts.parsed.initialStones,
      maxVisits: policy.visits,
      id: queryId,
    });

    let stdout = "";
    let stderr = "";
    let code: number | null = 0;
    try {
      const ran = await runKatagoWorkerAnalysisQueryLines({
        stdinPayload: queryLine,
        jobId: opts.jobId,
        env: opts.env,
        spawnFn: opts.spawnFn,
        timeoutMs: policy.timeoutMs,
      });
      stdout = ran.stdout;
      stderr = ran.stderr;
      code = ran.code;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const tail = summarizeKatagoStderrForDb(stderr);
      results.push(
        failedRow({
          turnIndex: c.turnIndex,
          player,
          playedMove,
          plannedBestMove,
          query: { ...queryBase, movesBeforeCount },
          message: tail && !msg.includes(tail.slice(0, 12)) ? `${msg} ${tail}` : msg,
        })
      );
      continue;
    }

    if (code !== 0 && code !== null) {
      const tail = summarizeKatagoStderrForDb(stderr);
      results.push(
        failedRow({
          turnIndex: c.turnIndex,
          player,
          playedMove,
          plannedBestMove,
          query: { ...queryBase, movesBeforeCount },
          message: `KATAGO_EXIT_NONZERO: exit ${String(code)}${tail ? ` — ${tail}` : ""}`,
        })
      );
      continue;
    }

    const match = matchStdoutByExpectedIds(stdout, [queryId]);
    if (!match.ok) {
      results.push(
        failedRow({
          turnIndex: c.turnIndex,
          player,
          playedMove,
          plannedBestMove,
          query: { ...queryBase, movesBeforeCount },
          message: match.error,
        })
      );
      continue;
    }

    const rawObj = match.byId.get(queryId);
    if (!rawObj) {
      results.push(
        failedRow({
          turnIndex: c.turnIndex,
          player,
          playedMove,
          plannedBestMove,
          query: { ...queryBase, movesBeforeCount },
          message: "KATAGO_DEEP_SEARCH_MISSING_ID: stdout 에 요청 id 가 없습니다.",
        })
      );
      continue;
    }

    const line = JSON.stringify(rawObj);
    try {
      const doc = buildKatagoSmokeNormalized({
        sgfSha256: opts.sgfSha256,
        sgfSizeBytes: opts.sgfSizeBytes,
        rawStdout: `${line}\n`,
        exitCode: code,
        commandPreview: "katago analysis (deep-search-v1)",
      });
      validateKatagoWorkerV1Document(doc);
      const moveInfos = Array.isArray(rawObj.moveInfos) ? (rawObj.moveInfos as unknown[]) : [];
      const katago: DeepSearchResultKatagoSliceV1 = {
        rootInfo: doc.katago.rootInfo,
        topMove: doc.katago.topMove ?? {},
        moveInfosCount: doc.katago.moveInfosCount,
        hasWinrate: doc.normalized.hasWinrate,
        hasScoreLead: doc.normalized.hasScoreLead,
        hasOwnership: doc.normalized.hasOwnership,
      };
      const comparison = buildComparison(playedMove, plannedBestMove, moveInfos);
      const ok: DeepSearchSingleResultOkV1 = {
        turnIndex: c.turnIndex,
        player,
        playedMove,
        plannedBestMove,
        status: "ok",
        query: { ...queryBase, movesBeforeCount },
        katago,
        comparison,
      };
      results.push(ok);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const tail = summarizeKatagoStderrForDb(stderr);
      results.push(
        failedRow({
          turnIndex: c.turnIndex,
          player,
          playedMove,
          plannedBestMove,
          query: { ...queryBase, movesBeforeCount },
          message: tail && !msg.includes(tail.slice(0, 12)) ? `${msg} ${tail}` : msg,
        })
      );
    }
  }

  const completedCount = results.filter((r) => r.status === "ok").length;
  const failedCount = results.filter((r) => r.status === "failed").length;
  const allFailed = attemptedCount > 0 && completedCount === 0 && failedCount > 0;
  const partialFailure = failedCount > 0 && completedCount > 0;

  return {
    version: DEEP_SEARCH_RESULTS_V1_VERSION,
    computedFrom: DEEP_SEARCH_RESULTS_V1_COMPUTED_FROM,
    enabled: true,
    policy,
    candidateCount,
    attemptedCount,
    completedCount,
    failedCount,
    partialFailure,
    allFailed,
    results,
  };
}
