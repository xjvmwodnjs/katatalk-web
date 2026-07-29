import { buildAnalysisPlanV1FromParsed } from "../../analysisPlan";
import { computeAdiV1FromTurnAnalysesAndBsi } from "../../adiV1";
import { computeBsiV1FromTurnAnalyses } from "../../bsiV1";
import { computeDeepSearchResultsV1 } from "../../deepSearchResultsV1";
import { computeDeepSearchPlanV1 } from "../../deepSearchPlanV1";
import { assertKatagoResultQualityForCompletion } from "../../katagoResultQualityGate";
import { sha256HexUtf8, utf8ByteLength } from "../../sgfPayload";
import {
  readKatagoMaxVisits,
  readKatagoMaxVisitsFrom,
  readKatagoMultiTurnMaxVisitsFrom,
  readKatagoPersistentMultiTurnEnabledFrom,
  readKatagoPersistentRootEnabledFrom,
  readKatagoPersistentRootIdleCloseMsFrom,
  readKatagoPersistentRootStrictFrom,
  readKatagoTimeoutMsFrom,
} from "./config";
import { runMultiTurnKatagoRawV1 } from "./katagoMultiTurnRun";
import {
  buildKatagoSmokeNormalized,
  rootHasScoreLeadOrMean,
  validateKatagoWorkerV1Document,
} from "./katagoRawParser";
import {
  buildKatagoAnalysisQueryLine,
  parseMinimalSgfForSmoke,
  type ParsedMinimalSgf,
} from "./katagoSgfQuery";
import { PersistentKatagoAnalysisSession } from "./katagoPersistentSession";
import { runKatagoWinrateTimelineV1 } from "./katagoWinrateTimelineRun";
import { resolveKatagoWinratePerspectiveConfig } from "./katagoWinratePerspectiveConfig";
import { normalizeWinratePerspectiveV1 } from "@shared/winratePerspectiveV1";
import {
  runKatagoWorkerAnalysisV1,
  summarizeKatagoStderrForDb,
  KATAGO_WORKER_KILL_GRACE_MS,
  type SpawnFn,
} from "./katagoSmokeRun";
import type { AnalyzeSgfInput, NormalizedAnalysisResult } from "./types";

const V25_REF = "docs/algorithm/KataTalk_Algorithm_V2.5.md";

type KatagoRootAnalysisMode =
  | "spawn"
  | "persistent"
  | "persistent_fallback_spawn";

type KatagoRootAnalysisRun = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  commandPreview: string;
  mode: KatagoRootAnalysisMode;
  durationMs: number | null;
  fallbackReason?: string;
};

let sharedPersistentRoot: {
  key: string;
  spawnFn?: SpawnFn;
  session: PersistentKatagoAnalysisSession;
} | null = null;
let sharedPersistentRootIdleTimer: ReturnType<typeof setTimeout> | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function persistentRootSessionKey(env: NodeJS.ProcessEnv): string {
  return [
    env.KATAGO_BINARY_PATH?.trim() ?? "",
    env.KATAGO_CONFIG_PATH?.trim() ?? "",
    env.KATAGO_MODEL_PATH?.trim() ?? "",
  ].join("\0");
}

async function resetSharedPersistentRoot(): Promise<void> {
  if (sharedPersistentRootIdleTimer) {
    clearTimeout(sharedPersistentRootIdleTimer);
    sharedPersistentRootIdleTimer = null;
  }
  const current = sharedPersistentRoot;
  sharedPersistentRoot = null;
  if (current) {
    try {
      await current.session.close();
    } catch {
      /* ignore close failures; the next request will spawn a fresh session */
    }
  }
}

async function getSharedPersistentRootSession(args: {
  env: NodeJS.ProcessEnv;
  spawnFn?: SpawnFn;
}): Promise<PersistentKatagoAnalysisSession> {
  if (sharedPersistentRootIdleTimer) {
    clearTimeout(sharedPersistentRootIdleTimer);
    sharedPersistentRootIdleTimer = null;
  }
  const key = persistentRootSessionKey(args.env);
  if (
    sharedPersistentRoot &&
    (sharedPersistentRoot.key !== key ||
      sharedPersistentRoot.spawnFn !== args.spawnFn ||
      sharedPersistentRoot.session.isClosed)
  ) {
    await resetSharedPersistentRoot();
  }
  if (!sharedPersistentRoot) {
    sharedPersistentRoot = {
      key,
      spawnFn: args.spawnFn,
      session: new PersistentKatagoAnalysisSession({
        env: args.env,
        spawnFn: args.spawnFn,
      }),
    };
  }
  return sharedPersistentRoot.session;
}

function scheduleSharedPersistentRootIdleClose(env: NodeJS.ProcessEnv): void {
  if (
    !sharedPersistentRoot ||
    sharedPersistentRoot.session.isClosed ||
    !readKatagoPersistentRootEnabledFrom(env)
  ) {
    return;
  }
  if (sharedPersistentRootIdleTimer) {
    clearTimeout(sharedPersistentRootIdleTimer);
  }
  sharedPersistentRootIdleTimer = setTimeout(() => {
    if (sharedPersistentRoot && sharedPersistentRoot.session.pendingCount > 0) {
      scheduleSharedPersistentRootIdleClose(env);
      return;
    }
    void resetSharedPersistentRoot();
  }, readKatagoPersistentRootIdleCloseMsFrom(env));
  sharedPersistentRootIdleTimer.unref?.();
}

async function runSpawnRootAnalysis(args: {
  sgfText: string;
  jobId: string;
  env: NodeJS.ProcessEnv;
  spawnFn?: SpawnFn;
  mode: KatagoRootAnalysisMode;
  fallbackReason?: string;
}): Promise<KatagoRootAnalysisRun> {
  try {
    const started = Date.now();
    const ran = await runKatagoWorkerAnalysisV1({
      sgfContent: args.sgfText,
      jobId: args.jobId,
      env: args.env,
      spawnFn: args.spawnFn,
    });
    return {
      stdout: ran.stdout,
      stderr: ran.stderr,
      exitCode: ran.code,
      commandPreview: ran.commandPreview,
      mode: args.mode,
      durationMs: Date.now() - started,
      ...(args.fallbackReason ? { fallbackReason: args.fallbackReason } : {}),
    };
  } catch (e) {
    const msg = errorMessage(e);
    if (msg.startsWith("KATAGO_TIMEOUT:")) {
      throw new Error(
        `${msg} (SIGTERM ??${KATAGO_WORKER_KILL_GRACE_MS}ms ??SIGKILL ?쒕룄)`
      );
    }
    throw e instanceof Error ? e : new Error(msg);
  }
}

function buildPersistentRootQueryId(jobId: string): string {
  const safeJobId =
    jobId.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80) || "job";
  return `katatalk-root-${safeJobId}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function runKatagoRootAnalysis(args: {
  sgfText: string;
  parsed: ParsedMinimalSgf;
  jobId: string;
  maxVisits: number;
  env: NodeJS.ProcessEnv;
  spawnFn?: SpawnFn;
}): Promise<KatagoRootAnalysisRun> {
  if (!readKatagoPersistentRootEnabledFrom(args.env)) {
    return runSpawnRootAnalysis({
      sgfText: args.sgfText,
      jobId: args.jobId,
      env: args.env,
      spawnFn: args.spawnFn,
      mode: "spawn",
    });
  }

  try {
    const queryId = buildPersistentRootQueryId(args.jobId);
    const queryLine = buildKatagoAnalysisQueryLine({
      boardSize: args.parsed.boardSize,
      komi: args.parsed.komi,
      rules: args.parsed.rules,
      initialPlayer: args.parsed.initialPlayer,
      moves: args.parsed.moves,
      initialStones: args.parsed.initialStones,
      maxVisits: args.maxVisits,
      id: queryId,
    });
    const session = await getSharedPersistentRootSession({
      env: args.env,
      spawnFn: args.spawnFn,
    });
    const response = await session.analyzeLine({
      queryLine,
      expectedId: queryId,
      timeoutMs: readKatagoTimeoutMsFrom(args.env),
    });
    return {
      stdout: `${response.rawLine}\n`,
      stderr: session.stderrTail,
      exitCode: 0,
      commandPreview: session.preview,
      mode: "persistent",
      durationMs: response.durationMs,
    };
  } catch (e) {
    const msg = errorMessage(e);
    await resetSharedPersistentRoot();
    if (readKatagoPersistentRootStrictFrom(args.env)) {
      if (msg.startsWith("KATAGO_PERSISTENT_TIMEOUT:")) {
        throw new Error(
          `${msg} (persistent root; fallback disabled by KATAGO_PERSISTENT_ROOT_STRICT)`
        );
      }
      throw e instanceof Error ? e : new Error(msg);
    }
    return runSpawnRootAnalysis({
      sgfText: args.sgfText,
      jobId: args.jobId,
      env: args.env,
      spawnFn: args.spawnFn,
      mode: "persistent_fallback_spawn",
      fallbackReason: msg.slice(0, 240),
    });
  }
}

export async function closeSharedPersistentRootSession(): Promise<void> {
  await resetSharedPersistentRoot();
}

export const closeSharedPersistentRootSessionForTests =
  closeSharedPersistentRootSession;

/**
 * Worker v1: 실제 KataGo `analysis` 1회 실행 후 normalized 만 `analysis_jobs.result` 에 저장한다.
 * raw stdout 전체는 DB 에 넣지 않는다.
 */
export async function analyzeSgfKatago(
  input: AnalyzeSgfInput
): Promise<NormalizedAnalysisResult> {
  const bin = process.env.KATAGO_BINARY_PATH?.trim();
  const cfg = process.env.KATAGO_CONFIG_PATH?.trim();
  const model = process.env.KATAGO_MODEL_PATH?.trim();
  if (!bin || !cfg || !model) {
    throw new Error(
      "KATAGO_ENV_MISSING: KATAGO_BINARY_PATH, KATAGO_CONFIG_PATH, KATAGO_MODEL_PATH 가 모두 필요합니다."
    );
  }
  if (!input.sgfContent?.trim()) {
    throw new Error("KATAGO_INPUT_MISSING: sgf_content 가 비어 있습니다.");
  }
  const winratePerspectiveResolution = resolveKatagoWinratePerspectiveConfig(
    process.env
  );
  if (winratePerspectiveResolution.perspective === "unknown") {
    throw new Error(
      `KATAGO_WINRATE_PERSPECTIVE_UNVERIFIED: reportAnalysisWinratesAs could not be verified (reason=${winratePerspectiveResolution.issue ?? "unknown"}).`
    );
  }
  const winratePerspective = winratePerspectiveResolution.perspective;

  const maxVisits =
    input.maxVisits > 0 ? input.maxVisits : readKatagoMaxVisits();
  const sgfText = input.sgfContent;
  const sgfSha256 = sha256HexUtf8(sgfText);
  const sgfSizeBytes = utf8ByteLength(sgfText);
  const analysisStartedAt = Date.now();
  const parseStartedAt = Date.now();
  let parsed;
  try {
    parsed = parseMinimalSgfForSmoke(sgfText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/^(SGF_|KATAGO_QUERY_BUILD_FAILED):/.test(msg)) {
      throw e instanceof Error ? e : new Error(msg);
    }
    throw new Error(`SGF_PARSE_FAILED: ${msg.slice(0, 120)}`);
  }
  const parseDurationMs = Date.now() - parseStartedAt;

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let commandPreview = "";
  let rootAnalysisMode: KatagoRootAnalysisMode = "spawn";
  let rootAnalysisDurationMs: number | null = null;
  let rootAnalysisFallbackReason: string | undefined;
  const rootStageStartedAt = Date.now();

  try {
    const ran = await runKatagoRootAnalysis({
      sgfText,
      parsed,
      jobId: input.jobId,
      maxVisits,
      env: process.env,
      spawnFn: input.__testSpawnFn,
    });
    stdout = ran.stdout;
    stderr = ran.stderr;
    exitCode = ran.exitCode;
    commandPreview = ran.commandPreview;
    rootAnalysisMode = ran.mode;
    rootAnalysisDurationMs = ran.durationMs;
    rootAnalysisFallbackReason = ran.fallbackReason;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("KATAGO_TIMEOUT:")) {
      throw new Error(
        `${msg} (SIGTERM → ${KATAGO_WORKER_KILL_GRACE_MS}ms 후 SIGKILL 시도)`
      );
    }
    throw e instanceof Error ? e : new Error(msg);
  }

  if (exitCode !== 0 && exitCode !== null) {
    const tail = summarizeKatagoStderrForDb(stderr);
    throw new Error(
      `KATAGO_EXIT_NONZERO: KataGo exit ${String(exitCode)}${tail ? ` — ${tail}` : ""}`
    );
  }

  const document = buildKatagoSmokeNormalized({
    sgfSha256,
    sgfSizeBytes,
    rawStdout: stdout,
    exitCode,
    commandPreview,
  });

  if (document.katago.rawFormat === "unknown") {
    const tail = summarizeKatagoStderrForDb(stderr);
    throw new Error(
      `KATAGO_OUTPUT_INVALID: stdout 을 분석 JSON 으로 읽을 수 없습니다.${tail ? ` stderr: ${tail}` : ""}`
    );
  }

  try {
    validateKatagoWorkerV1Document(document);
  } catch (err) {
    const tail = summarizeKatagoStderrForDb(stderr);
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(
      tail && !base.includes(tail.slice(0, 20))
        ? `${base} stderr: ${tail}`
        : base
    );
  }
  const rootStageDurationMs = Date.now() - rootStageStartedAt;

  const root = document.katago.rootInfo as Record<string, unknown>;
  const hasScoreLeadField =
    document.normalized.hasScoreLead || rootHasScoreLeadOrMean(root);
  const rootWinrate =
    typeof root.winrate === "number" && Number.isFinite(root.winrate)
      ? root.winrate
      : null;
  const rootCurrentPlayer =
    root.currentPlayer === "B" || root.currentPlayer === "W"
      ? root.currentPlayer
      : null;
  const normalizedRootWinrate = normalizeWinratePerspectiveV1({
    rawWinrate: rootWinrate,
    currentPlayer: rootCurrentPlayer,
    playerToMove: rootCurrentPlayer,
    configuredPerspective: winratePerspective,
  });

  const analysisPlanStartedAt = Date.now();
  const analysisPlan = buildAnalysisPlanV1FromParsed(parsed);
  const analysisPlanDurationMs = Date.now() - analysisPlanStartedAt;

  const multiTurnStartedAt = Date.now();
  const persistentMultiTurnSession =
    rootAnalysisMode === "persistent" &&
    readKatagoPersistentMultiTurnEnabledFrom(process.env)
      ? await getSharedPersistentRootSession({
          env: process.env,
          spawnFn: input.__testSpawnFn,
        })
      : undefined;
  const { turnAnalyses, multiTurnAnalysis } = await runMultiTurnKatagoRawV1({
    parsed,
    plan: analysisPlan,
    jobId: input.jobId,
    sgfSha256,
    sgfSizeBytes,
    env: process.env,
    spawnFn: input.__testSpawnFn,
    persistentSession: persistentMultiTurnSession,
  }).finally(() => {
    if (rootAnalysisMode === "persistent") {
      scheduleSharedPersistentRootIdleClose(process.env);
    }
  });
  const multiTurnDurationMs = Date.now() - multiTurnStartedAt;

  const signalPlanningStartedAt = Date.now();
  const baseMaxVisits = readKatagoMaxVisitsFrom(process.env);
  const multiTurnMaxVisits = readKatagoMultiTurnMaxVisitsFrom(
    process.env,
    baseMaxVisits
  );
  const bsiV1 = computeBsiV1FromTurnAnalyses(turnAnalyses, {
    engineMaxVisits: maxVisits,
    multiTurnMaxVisits,
  });
  const adiV1 = computeAdiV1FromTurnAnalysesAndBsi(turnAnalyses, bsiV1);
  const deepSearchPlan = computeDeepSearchPlanV1({
    analysisPlan,
    turnAnalyses,
    bsiV1,
    adiV1,
    env: process.env,
  });
  const signalPlanningDurationMs = Date.now() - signalPlanningStartedAt;

  const deepSearchStartedAt = Date.now();
  const deepSearchResults = await computeDeepSearchResultsV1({
    env: process.env,
    jobId: input.jobId,
    parsed,
    deepSearchPlan,
    sgfSha256,
    sgfSizeBytes,
    spawnFn: input.__testSpawnFn,
  });
  const deepSearchDurationMs = Date.now() - deepSearchStartedAt;

  const winrateTimelineStartedAt = Date.now();
  const winrateTimelineV1 = await runKatagoWinrateTimelineV1({
    parsed,
    jobId: input.jobId,
    env: process.env,
    spawnFn: input.__testSpawnFn,
    winratePerspective,
  });
  const winrateTimelineDurationMs = Date.now() - winrateTimelineStartedAt;
  const totalBeforeQualityGateMs = Date.now() - analysisStartedAt;

  const result: NormalizedAnalysisResult = {
    ok: true,
    source: "katago-worker-v1",
    isMock: false,
    /** KataGo raw root winrate in the configured reportAnalysisWinratesAs axis. */
    katagoRootWinrate: rootWinrate,
    katagoRootBlackWinrate: normalizedRootWinrate.normalized.blackWinrate,
    katagoRootWhiteWinrate: normalizedRootWinrate.normalized.whiteWinrate,
    engine: {
      name: "katago",
      maxVisits,
      winratePerspective,
      winratePerspectiveSource: winratePerspectiveResolution.source,
      rawFormat: document.katago.rawFormat,
      rootAnalysisMode,
      rootAnalysisDurationMs,
      multiTurnAnalysisMode: multiTurnAnalysis.executionMode ?? null,
      phaseDurationsMs: {
        totalBeforeQualityGate: totalBeforeQualityGateMs,
        parse: parseDurationMs,
        rootStage: rootStageDurationMs,
        rootAnalysis: rootAnalysisDurationMs,
        analysisPlan: analysisPlanDurationMs,
        multiTurn: multiTurnDurationMs,
        signalPlanning: signalPlanningDurationMs,
        deepSearch: deepSearchDurationMs,
        winrateTimeline: winrateTimelineDurationMs,
      },
      ...(rootAnalysisFallbackReason ? { rootAnalysisFallbackReason } : {}),
    },
    input: {
      sgfSha256: document.input.sgfSha256,
      sgfSizeBytes: document.input.sgfSizeBytes,
    },
    katago: {
      rootInfo: document.katago.rootInfo,
      moveInfosCount: document.katago.moveInfosCount,
      topMove: document.katago.topMove,
      hasWinrate: document.normalized.hasWinrate,
      hasScoreLead: hasScoreLeadField,
      hasOwnership: document.normalized.hasOwnership,
    },
    normalized: {
      summary:
        "KataGo raw + BSI/ADI v1 + deep-search-plan-v1 + deep-search-results-v1 (optional high-visits replays; no NL).",
      sampleMoveInfos: document.normalized.sampleMoveInfos,
    },
    algorithmStage: {
      v25Reference: V25_REF,
      implemented: [
        "katago_raw_capture",
        ...(rootAnalysisMode === "persistent"
          ? ["persistent_root_katago_v1"]
          : []),
        ...(multiTurnAnalysis.executionMode?.startsWith("persistent")
          ? ["persistent_multi_turn_katago_v1"]
          : []),
        "analysis_plan_v1",
        "multi_turn_katago_raw_v1",
        "bsi_v1",
        "adi_v1",
        "deep_search_plan_v1",
        "deep_search_results_v1",
      ],
      notYetImplemented: [
        "concept_tags",
        "explanation_planner",
        "claim_verification",
        "llm_commentary",
      ],
    },
    game_info: {
      metadata_version: parsed.gameMetadata.version,
      black_player: parsed.gameMetadata.blackPlayer,
      white_player: parsed.gameMetadata.whitePlayer,
      date: parsed.gameMetadata.date,
      total_moves: parsed.moves.length,
      result: parsed.gameMetadata.result,
      result_raw: parsed.gameMetadata.resultRaw,
      metadata_warnings: parsed.gameMetadata.warnings,
      komi: parsed.komi,
    },
    top_mistakes: [],
    analysisPlan,
    turnAnalyses,
    multiTurnAnalysis,
    bsiV1,
    adiV1,
    deepSearchPlan,
    deepSearchResults,
    winrateTimelineV1,
  };

  const qualityGate = assertKatagoResultQualityForCompletion(result);
  return { ...result, qualityGate };
}

/** @deprecated 호환용 별칭 — `analyzeSgfKatago` 사용 */
export const analyzeSgfKatagoStub = analyzeSgfKatago;
