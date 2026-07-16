import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  analyzeSgfKatago,
  closeSharedPersistentRootSession,
} from "./worker/analysisEngines/katagoEngine";
import { readKatagoMaxVisitsFrom } from "./worker/analysisEngines/config";
import type {
  AnalyzeSgfInput,
  NormalizedAnalysisResult,
} from "./worker/analysisEngines/types";
import {
  evaluateKatagoResultQuality,
  type KatagoResultQualityIssue,
  type KatagoResultQualityReport,
} from "./katagoResultQualityGate";
import {
  evaluateProductReviewCategoryQualityGateV1,
  type ProductReviewCategoryQualityReportV1,
} from "./productReviewCategoryQualityGateV1";
import { buildProductReviewWorkbenchV1 } from "@shared/productReviewWorkbenchV1";

type AnalyzeFn = (input: AnalyzeSgfInput) => Promise<NormalizedAnalysisResult>;

export type KatagoProductSmokeArgs = {
  sgfPath: string | null;
  outDir?: string;
  jobId?: string;
  language: string;
  strictWarnings: boolean;
  help: boolean;
};

export type KatagoProductSmokeSummary = {
  passed: boolean;
  outputPath: string;
  outputFileUrl: string;
  jobId: string;
  durationMs: number;
  strictWarnings: boolean;
  qualityGate: KatagoResultQualityReport;
  engineMaxVisits: number | null;
  phaseDurationsMs: {
    totalBeforeQualityGate: number | null;
    rootAnalysis: number | null;
    rootStage: number | null;
    multiTurn: number | null;
    signalPlanning: number | null;
    deepSearch: number | null;
    winrateTimeline: number | null;
  };
  gameTotalMoves: number | null;
  turnAnalyses: {
    totalCount: number;
    okCount: number;
    failedCount: number;
  };
  bsiSignalCount: number;
  adiSignalCount: number;
  bsiSignalTurns: number[];
  adiSignalTurns: number[];
  productReviewCategoryQuality: ProductReviewCategoryQualityReportV1;
  deepSearch: {
    enabled: boolean | null;
    candidateCount: number | null;
    attemptedCount: number | null;
    completedCount: number | null;
    failedCount: number | null;
  };
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function signalTurns(value: unknown): number[] {
  if (!isPlainObject(value) || !Array.isArray(value.signals)) {
    return [];
  }
  const turns = new Set<number>();
  for (const signal of value.signals) {
    if (!isPlainObject(signal)) continue;
    const turnIndex = numberValue(signal.turnIndex);
    if (turnIndex != null && Number.isInteger(turnIndex) && turnIndex >= 1) {
      turns.add(turnIndex);
    }
  }
  return Array.from(turns).sort((a, b) => a - b);
}

function countTurnAnalyses(value: unknown): {
  totalCount: number;
  okCount: number;
  failedCount: number;
} {
  if (!Array.isArray(value)) {
    return { totalCount: 0, okCount: 0, failedCount: 0 };
  }
  let okCount = 0;
  let failedCount = 0;
  for (const row of value) {
    if (!isPlainObject(row)) {
      continue;
    }
    if (row.status === "ok") {
      okCount += 1;
    } else if (row.status === "failed") {
      failedCount += 1;
    }
  }
  return { totalCount: value.length, okCount, failedCount };
}

function summarizeDeepSearch(
  value: unknown
): KatagoProductSmokeSummary["deepSearch"] {
  if (!isPlainObject(value)) {
    return {
      enabled: null,
      candidateCount: null,
      attemptedCount: null,
      completedCount: null,
      failedCount: null,
    };
  }
  return {
    enabled: booleanValue(value.enabled),
    candidateCount: numberValue(value.candidateCount),
    attemptedCount: numberValue(value.attemptedCount),
    completedCount: numberValue(value.completedCount),
    failedCount: numberValue(value.failedCount),
  };
}

function summarizePhaseDurations(
  value: unknown
): KatagoProductSmokeSummary["phaseDurationsMs"] {
  const phases = isPlainObject(value) ? value : null;
  return {
    totalBeforeQualityGate: numberValue(phases?.totalBeforeQualityGate),
    rootAnalysis: numberValue(phases?.rootAnalysis),
    rootStage: numberValue(phases?.rootStage),
    multiTurn: numberValue(phases?.multiTurn),
    signalPlanning: numberValue(phases?.signalPlanning),
    deepSearch: numberValue(phases?.deepSearch),
    winrateTimeline: numberValue(phases?.winrateTimeline),
  };
}

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function shiftArg(argv: string[], index: number, flag: string): string | null {
  const current = argv[index] ?? "";
  const prefix = `${flag}=`;
  if (current.startsWith(prefix)) {
    return current.slice(prefix.length);
  }
  return argv[index + 1] && !argv[index + 1]!.startsWith("-")
    ? argv[index + 1]!
    : null;
}

export function parseKatagoProductSmokeArgs(
  argv: string[]
): KatagoProductSmokeArgs {
  const parsed: KatagoProductSmokeArgs = {
    sgfPath: null,
    language: "ko",
    strictWarnings: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
      continue;
    }
    if (arg === "--") {
      continue;
    }
    if (arg === "--strict-warnings") {
      parsed.strictWarnings = true;
      continue;
    }
    if (arg === "--out-dir" || arg.startsWith("--out-dir=")) {
      const value = shiftArg(argv, i, "--out-dir");
      if (value) {
        parsed.outDir = value;
        if (arg === "--out-dir") {
          i += 1;
        }
      }
      continue;
    }
    if (arg === "--job-id" || arg.startsWith("--job-id=")) {
      const value = shiftArg(argv, i, "--job-id");
      if (value) {
        parsed.jobId = value;
        if (arg === "--job-id") {
          i += 1;
        }
      }
      continue;
    }
    if (arg === "--lang" || arg.startsWith("--lang=")) {
      const value = shiftArg(argv, i, "--lang");
      if (value) {
        parsed.language = value;
        if (arg === "--lang") {
          i += 1;
        }
      }
      continue;
    }
    if (!arg.startsWith("-")) {
      parsed.sgfPath = arg;
    }
  }

  return parsed;
}

export async function runKatagoProductSmoke(opts: {
  sgfPath: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  outDir?: string;
  jobId?: string;
  language?: string;
  strictWarnings?: boolean;
  analyzeFn?: AnalyzeFn;
}): Promise<KatagoProductSmokeSummary> {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const sgfPath = path.resolve(cwd, opts.sgfPath);
  const sgfContent = await readFile(sgfPath, "utf8");
  const outDir = path.resolve(cwd, opts.outDir ?? path.join(".tmp", "katago"));
  await mkdir(outDir, { recursive: true });

  const startedAt = Date.now();
  const ts = timestampForFilename();
  const jobId = opts.jobId ?? `katatalk-product-smoke-${ts}`;
  const maxVisits = readKatagoMaxVisitsFrom(env);
  const analyzeFn = opts.analyzeFn ?? analyzeSgfKatago;
  const result = await analyzeFn({
    jobId,
    sgfContent,
    language: opts.language ?? "ko",
    maxVisits,
    fileName: path.basename(sgfPath),
  });

  const qualityGate = evaluateKatagoResultQuality(result);
  const productReviewCategoryQuality = evaluateProductReviewCategoryQualityGateV1(
    buildProductReviewWorkbenchV1(result)
  );
  const outputPath = path.join(
    outDir,
    `product-result-${ts}-${randomUUID()}.json`
  );
  const outputDocument = { ...result, qualityGate, productReviewCategoryQuality };
  await writeFile(
    outputPath,
    `${JSON.stringify(outputDocument, null, 2)}\n`,
    "utf8"
  );

  const engine = isPlainObject(result.engine) ? result.engine : null;
  const gameInfo = isPlainObject(result.game_info) ? result.game_info : null;
  const strictWarnings = opts.strictWarnings === true;
  const bsiSignalTurns = signalTurns(result.bsiV1);
  const adiSignalTurns = signalTurns(result.adiV1);
  const passed =
    qualityGate.ok &&
    productReviewCategoryQuality.ok &&
    (!strictWarnings || qualityGate.warningCount === 0);

  return {
    passed,
    outputPath,
    outputFileUrl: pathToFileURL(outputPath).href,
    jobId,
    durationMs: Date.now() - startedAt,
    strictWarnings,
    qualityGate,
    engineMaxVisits: numberValue(engine?.maxVisits),
    phaseDurationsMs: summarizePhaseDurations(engine?.phaseDurationsMs),
    gameTotalMoves: numberValue(gameInfo?.total_moves),
    turnAnalyses: countTurnAnalyses(result.turnAnalyses),
    bsiSignalCount: bsiSignalTurns.length,
    adiSignalCount: adiSignalTurns.length,
    bsiSignalTurns,
    adiSignalTurns,
    productReviewCategoryQuality,
    deepSearch: summarizeDeepSearch(result.deepSearchResults),
  };
}

function formatIssue(issue: KatagoResultQualityIssue): string {
  return `${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`;
}

export function katagoProductSmokeUsage(): string {
  return [
    "Usage: corepack pnpm katago:product-smoke -- <game.sgf> [options]",
    "",
    "Options:",
    "  --strict-warnings       Exit non-zero when the quality gate has warnings.",
    "  --out-dir <dir>         Output directory. Default: .tmp/katago",
    "  --job-id <id>           Override smoke job id.",
    "  --lang <code>           Analysis language input. Default: ko",
  ].join("\n");
}

export async function runKatagoProductSmokeCliMain(
  argv: string[]
): Promise<void> {
  const args = parseKatagoProductSmokeArgs(argv);
  if (args.help) {
    console.log(katagoProductSmokeUsage());
    return;
  }
  if (!args.sgfPath) {
    console.error(katagoProductSmokeUsage());
    process.exitCode = 2;
    return;
  }

  try {
    const summary = await runKatagoProductSmoke({
      sgfPath: args.sgfPath,
      outDir: args.outDir,
      jobId: args.jobId,
      language: args.language,
      strictWarnings: args.strictWarnings,
    });

    console.log(`[katago-product-smoke] result: ${summary.outputFileUrl}`);
    console.log(
      `[katago-product-smoke] quality ok=${String(summary.qualityGate.ok)} failures=${String(
        summary.qualityGate.failureCount
      )} warnings=${String(summary.qualityGate.warningCount)} strictWarnings=${String(summary.strictWarnings)}`
    );
    console.log(
      `[katago-product-smoke] moves=${String(summary.gameTotalMoves ?? "n/a")} visits=${String(
        summary.engineMaxVisits ?? "n/a"
      )} durationMs=${String(summary.durationMs)}`
    );
    console.log(
      `[katago-product-smoke] phases root=${String(summary.phaseDurationsMs.rootAnalysis ?? "n/a")} multiTurn=${String(summary.phaseDurationsMs.multiTurn ?? "n/a")} signal=${String(summary.phaseDurationsMs.signalPlanning ?? "n/a")} deep=${String(summary.phaseDurationsMs.deepSearch ?? "n/a")} timeline=${String(summary.phaseDurationsMs.winrateTimeline ?? "n/a")}`
    );
    console.log(
      `[katago-product-smoke] turns ok=${String(summary.turnAnalyses.okCount)} failed=${String(
        summary.turnAnalyses.failedCount
      )} total=${String(summary.turnAnalyses.totalCount)} bsi=${String(summary.bsiSignalCount)} adi=${String(
        summary.adiSignalCount
      )}`
    );
    console.log(
      `[katago-product-smoke] deepSearch enabled=${String(summary.deepSearch.enabled)} attempted=${String(
        summary.deepSearch.attemptedCount
      )} completed=${String(summary.deepSearch.completedCount)} failed=${String(summary.deepSearch.failedCount)}`
    );
    for (const issue of summary.qualityGate.issues) {
      const line = `[katago-product-smoke] ${formatIssue(issue)}`;
      if (issue.severity === "fail") {
        console.error(line);
      } else {
        console.warn(line);
      }
    }
    if (!summary.passed) {
      process.exitCode = 1;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[katago-product-smoke] failed: ${msg}`);
    process.exitCode = 1;
  } finally {
    await closeSharedPersistentRootSession();
  }
}
