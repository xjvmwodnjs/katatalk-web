import { buildAnalysisPlanV1FromParsed } from "../../analysisPlan";
import { sha256HexUtf8, utf8ByteLength } from "../../sgfPayload";
import { readKatagoMaxVisits } from "./config";
import { runMultiTurnKatagoRawV1 } from "./katagoMultiTurnRun";
import {
  buildKatagoSmokeNormalized,
  rootHasScoreLeadOrMean,
  validateKatagoWorkerV1Document,
} from "./katagoRawParser";
import { parseMinimalSgfForSmoke } from "./katagoSgfQuery";
import { runKatagoWorkerAnalysisV1, summarizeKatagoStderrForDb, KATAGO_WORKER_KILL_GRACE_MS } from "./katagoSmokeRun";
import type { AnalyzeSgfInput, NormalizedAnalysisResult } from "./types";

const V25_REF = "docs/algorithm/KataTalk_Algorithm_V2.5.md";

/**
 * Worker v1: 실제 KataGo `analysis` 1회 실행 후 normalized 만 `analysis_jobs.result` 에 저장한다.
 * raw stdout 전체는 DB 에 넣지 않는다.
 */
export async function analyzeSgfKatago(input: AnalyzeSgfInput): Promise<NormalizedAnalysisResult> {
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

  const maxVisits = input.maxVisits > 0 ? input.maxVisits : readKatagoMaxVisits();
  const sgfText = input.sgfContent;
  const sgfSha256 = sha256HexUtf8(sgfText);
  const sgfSizeBytes = utf8ByteLength(sgfText);
  const parsed = parseMinimalSgfForSmoke(sgfText);

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let commandPreview = "";

  try {
    const ran = await runKatagoWorkerAnalysisV1({
      sgfContent: sgfText,
      jobId: input.jobId,
      env: process.env,
      spawnFn: input.__testSpawnFn,
    });
    stdout = ran.stdout;
    stderr = ran.stderr;
    exitCode = ran.code;
    commandPreview = ran.commandPreview;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("KATAGO_TIMEOUT:")) {
      throw new Error(`${msg} (SIGTERM → ${KATAGO_WORKER_KILL_GRACE_MS}ms 후 SIGKILL 시도)`);
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
    throw new Error(tail && !base.includes(tail.slice(0, 20)) ? `${base} stderr: ${tail}` : base);
  }

  const root = document.katago.rootInfo as Record<string, unknown>;
  const hasScoreLeadField =
    document.normalized.hasScoreLead || rootHasScoreLeadOrMean(root);
  const rootWinrate = typeof root.winrate === "number" && Number.isFinite(root.winrate) ? root.winrate : null;

  const analysisPlan = buildAnalysisPlanV1FromParsed(parsed);

  const { turnAnalyses, multiTurnAnalysis } = await runMultiTurnKatagoRawV1({
    parsed,
    plan: analysisPlan,
    jobId: input.jobId,
    sgfSha256,
    sgfSizeBytes,
    env: process.env,
    spawnFn: input.__testSpawnFn,
  });

  const result: NormalizedAnalysisResult = {
    ok: true,
    source: "katago-worker-v1",
    isMock: false,
    /** KataGo root winrate — 흑/백 고정 해석 없음(UI·문서에서 중립 표기) */
    katagoRootWinrate: rootWinrate,
    engine: {
      name: "katago",
      maxVisits,
      rawFormat: document.katago.rawFormat,
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
      summary: "KataGo raw analysis captured. BSI/ADI not computed yet.",
      sampleMoveInfos: document.normalized.sampleMoveInfos,
    },
    algorithmStage: {
      v25Reference: V25_REF,
      implemented: ["katago_raw_capture", "analysis_plan_v1", "multi_turn_katago_raw_v1"],
      notYetImplemented: [
        "bsi",
        "adi",
        "concept_tags",
        "explanation_planner",
        "claim_verification",
        "llm_commentary",
      ],
    },
    game_info: {
      black_player: "Black",
      white_player: "White",
      date: new Date().toISOString().slice(0, 10),
      total_moves: parsed.moves.length,
      result: {
        ko: "KataGo raw 분석 완료(BSI/ADI 미계산)",
        en: "KataGo raw done (BSI/ADI not computed)",
        zh: "KataGo 原始分析完成（未计算 BSI/ADI）",
        ja: "KataGo raw 完了(BSI/ADI 未実装)",
      },
      komi: parsed.komi,
    },
    top_mistakes: [],
    analysisPlan,
    turnAnalyses,
    multiTurnAnalysis,
  };

  return result;
}

/** @deprecated 호환용 별칭 — `analyzeSgfKatago` 사용 */
export const analyzeSgfKatagoStub = analyzeSgfKatago;
