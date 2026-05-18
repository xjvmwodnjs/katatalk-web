import type { ParsedMinimalSgf } from "./katagoSgfQuery";
import { sgfPointToGtp } from "./katagoSgfQuery";
import { runKatagoWorkerAnalysisQueryLines, summarizeKatagoStderrForDb, type SpawnFn } from "./katagoSmokeRun";
import { collectFinalResponsesByTurnNumber, katagoAnalyzeTurnResponseToProgressEventV1 } from "./katagoAnalyzeTurnsCollector";
import {
  buildAnalyzeTurnNumbers,
  readWinrateTimelineAnalysisPvLenFrom,
  readWinrateTimelineEnabledFrom,
  readWinrateTimelineIncludeFinalFrom,
  readWinrateTimelineLocalProgressEnabledFrom,
  readWinrateTimelineMaxTurnsFrom,
  readWinrateTimelineReportEverySecondsFrom,
  readWinrateTimelineTimeoutMsFrom,
  readWinrateTimelineVisitsFrom,
} from "./winrateTimelineConfig";
import {
  buildFailedTimelinePoint,
  buildOkTimelinePointFromRootInfo,
  summarizeWinrateTimelineV1,
  timelineMetaForTurnNumber,
  WINRATE_TIMELINE_V1_VERSION,
  type WinrateTimelineProgressEventV1,
  type WinrateTimelineV1,
} from "@shared/winrateTimelineV1";
import { appendWinrateTimelineProgressEventV1 } from "../../winrateTimelineProgressV1";
import { extractJsonObjectsFromKatagoStdout } from "./katagoRawParser";
import { detectKatagoBackendV1 } from "../katagoBackendDetectionV1";

function timestampSuffix(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function buildKatagoAnalyzeTurnsQueryLine(params: {
  parsed: ParsedMinimalSgf;
  jobId: string;
  analyzeTurns: number[];
  maxVisits: number;
  analysisPVLen: number;
  reportDuringSearchEverySeconds: number;
}): string {
  const pairs: [string, string][] = params.parsed.moves.map(({ color, sgfPoint }) => [
    color,
    sgfPointToGtp(sgfPoint, params.parsed.boardSize),
  ]);
  const initialStones: [string, string][] = params.parsed.initialStones.map(({ color, sgfPoint }) => [
    color,
    sgfPointToGtp(sgfPoint, params.parsed.boardSize),
  ]);
  const body = {
    id: `katatalk-wt-${params.jobId}-${timestampSuffix()}`,
    moves: pairs,
    ...(initialStones.length > 0 ? { initialStones } : {}),
    rules: "japanese",
    komi: params.parsed.komi,
    boardXSize: params.parsed.boardSize,
    boardYSize: params.parsed.boardSize,
    analyzeTurns: params.analyzeTurns,
    maxVisits: params.maxVisits,
    reportDuringSearchEvery: params.reportDuringSearchEverySeconds,
    analysisPVLen: params.analysisPVLen,
    includeOwnership: false,
    includeMovesOwnership: false,
    includePolicy: false,
  };
  return `${JSON.stringify(body)}\n`;
}

export type RunKatagoWinrateTimelineV1Opts = {
  parsed: ParsedMinimalSgf;
  jobId: string;
  env?: NodeJS.ProcessEnv;
  spawnFn?: SpawnFn;
  progressAppendFn?: (event: WinrateTimelineProgressEventV1) => Promise<void>;
};

async function appendProgressEventSafelyV1(
  event: WinrateTimelineProgressEventV1,
  appendFn: (event: WinrateTimelineProgressEventV1) => Promise<void>
): Promise<void> {
  try {
    await appendFn(event);
  } catch {
    console.warn("[katago-timeline] progress append failed", {
      jobId: event.jobId,
      turnIndex: event.turnIndex,
      isDuringSearch: event.isDuringSearch,
    });
  }
}

/**
 * Runs optional full-game timeline query. Never throws — failures become timeline metadata only.
 */
export async function runKatagoWinrateTimelineV1(opts: RunKatagoWinrateTimelineV1Opts): Promise<WinrateTimelineV1> {
  const env = opts.env != null ? { ...process.env, ...opts.env } : process.env;
  const totalMoves = opts.parsed.moves.length;
  const visits = readWinrateTimelineVisitsFrom(env);
  const maxTurns = readWinrateTimelineMaxTurnsFrom(env);
  const timeoutMs = readWinrateTimelineTimeoutMsFrom(env);
  const analysisPVLen = readWinrateTimelineAnalysisPvLenFrom(env);
  const includeFinal = readWinrateTimelineIncludeFinalFrom(env);
  const reportDuringSearchEverySeconds = readWinrateTimelineReportEverySecondsFrom(env);
  const localProgressEnabled = readWinrateTimelineLocalProgressEnabledFrom(env);
  const progressAppendFn = opts.progressAppendFn ?? appendWinrateTimelineProgressEventV1;
  const analyzeTurns = buildAnalyzeTurnNumbers(totalMoves, maxTurns, includeFinal);

  const basePolicy = {
    mode: "full-mainline-after-each-move" as const,
    visits,
    maxTurns,
    analyzeTurnsCount: analyzeTurns.length,
    timeoutMs,
    analysisPVLen,
    includeFinal,
  };

  if (!readWinrateTimelineEnabledFrom(env)) {
    return {
      version: WINRATE_TIMELINE_V1_VERSION,
      enabled: false,
      source: "katago-analyzeTurns",
      policy: basePolicy,
      totalMoves,
      attemptedCount: 0,
      completedCount: 0,
      failedCount: 0,
      partialFailure: false,
      allFailed: false,
      points: [],
    };
  }

  const gtpAt = (sgfPoint: string) => sgfPointToGtp(sgfPoint, opts.parsed.boardSize);
  const queryLine = buildKatagoAnalyzeTurnsQueryLine({
    parsed: opts.parsed,
    jobId: opts.jobId,
    analyzeTurns,
    maxVisits: visits,
    analysisPVLen,
    reportDuringSearchEverySeconds,
  });

  const backend = await detectKatagoBackendV1({ env });
  console.log(
    [
      "[katago-timeline]",
      "start",
      `katagoBackend=${backend.backend}`,
      `backendCheckOk=${String(backend.ok)}`,
      `timelineMaxVisits=${String(visits)}`,
      `analyzeTurnsCount=${String(analyzeTurns.length)}`,
      `reportEverySeconds=${String(reportDuringSearchEverySeconds)}`,
      `localProgress=${String(localProgressEnabled)}`,
    ].join(" ")
  );

  let progressBuffer = "";
  const onStdoutChunk = localProgressEnabled
    ? (chunk: string) => {
        progressBuffer += chunk;
        const lines = progressBuffer.split(/\r?\n/);
        progressBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const event = katagoAnalyzeTurnResponseToProgressEventV1(
            extractJsonObjectsFromKatagoStdout(line)[0],
            opts.jobId
          );
          if (event) {
            void appendProgressEventSafelyV1(event, progressAppendFn);
          }
        }
      }
    : undefined;

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let runErrorCode: string | undefined;
  let runErrorMessage: string | undefined;

  try {
    const ran = await runKatagoWorkerAnalysisQueryLines({
      stdinPayload: queryLine,
      jobId: opts.jobId,
      env,
      spawnFn: opts.spawnFn,
      timeoutMs,
      onStdoutChunk,
    });
    stdout = ran.stdout;
    stderr = ran.stderr;
    exitCode = ran.code;
    if (localProgressEnabled && progressBuffer.trim()) {
      const event = katagoAnalyzeTurnResponseToProgressEventV1(
        extractJsonObjectsFromKatagoStdout(progressBuffer)[0],
        opts.jobId
      );
      if (event) {
        await appendProgressEventSafelyV1(event, progressAppendFn);
      }
      progressBuffer = "";
    }
    if (exitCode !== 0 && exitCode != null) {
      runErrorCode = "KATAGO_EXIT_NONZERO";
      runErrorMessage = summarizeKatagoStderrForDb(stderr) || `exit ${String(exitCode)}`;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    runErrorCode = msg.startsWith("KATAGO_TIMEOUT:") ? "KATAGO_TIMEOUT" : "KATAGO_TIMELINE_RUN_ERROR";
    runErrorMessage = summarizeKatagoStderrForDb(msg) || msg.slice(0, 200);
  }

  const byTurn =
    stdout.length > 0 ? collectFinalResponsesByTurnNumber(stdout) : new Map<number, Record<string, unknown>>();

  const points = analyzeTurns.map((turnNumber) => {
    const meta = timelineMetaForTurnNumber(turnNumber, opts.parsed.moves, gtpAt);
    const row = byTurn.get(turnNumber);
    const root = row?.rootInfo;
    if (root == null || typeof root !== "object" || Array.isArray(root)) {
      return buildFailedTimelinePoint(meta, "MISSING_TURN_RESPONSE", "No final response for turnNumber");
    }
    return buildOkTimelinePointFromRootInfo(meta, root as Record<string, unknown>);
  });

  points.sort((a, b) => a.turnIndex - b.turnIndex);

  const summary = summarizeWinrateTimelineV1(points);
  const warningCodes: string[] = [];
  if (totalMoves > maxTurns) {
    warningCodes.push("TIMELINE_TURNS_CAPPED");
  }
  if (runErrorCode) {
    warningCodes.push(runErrorCode);
  }
  if (summary.partialFailure) {
    warningCodes.push("PARTIAL_TURN_FAILURE");
  }

  return {
    version: WINRATE_TIMELINE_V1_VERSION,
    enabled: true,
    source: "katago-analyzeTurns",
    policy: basePolicy,
    totalMoves,
    attemptedCount: points.length,
    completedCount: summary.completedCount,
    failedCount: summary.failedCount,
    partialFailure: summary.partialFailure || Boolean(runErrorCode),
    allFailed: summary.allFailed || (points.length > 0 && summary.completedCount === 0),
    ...(warningCodes.length > 0 ? { warningCodes } : {}),
    ...(runErrorCode ? { errorCode: runErrorCode, errorMessage: runErrorMessage } : {}),
    points,
  };
}
