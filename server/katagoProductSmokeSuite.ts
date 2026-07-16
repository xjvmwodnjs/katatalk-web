import { mkdir, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  runKatagoProductSmoke,
  type KatagoProductSmokeSummary,
} from "./katagoProductSmoke";
import {
  evaluateKatagoCorpusExpectations,
  loadKatagoCorpusManifest,
  type KatagoCorpusExpectationCheck,
  type KatagoCorpusTarget,
  type LoadedKatagoCorpusManifest,
} from "./katagoCorpusManifest";
import type {
  AnalyzeSgfInput,
  NormalizedAnalysisResult,
} from "./worker/analysisEngines/types";
import { closeSharedPersistentRootSession } from "./worker/analysisEngines/katagoEngine";

type AnalyzeFn = (input: AnalyzeSgfInput) => Promise<NormalizedAnalysisResult>;

export type KatagoProductSmokeFixture = {
  name: string;
  description: string;
  fileName: string;
  sgf: string;
  expectedToPass: boolean;
};

export type KatagoProductSmokeSuiteArgs = {
  sgfPaths: string[];
  corpusDirs: string[];
  corpusManifestPaths: string[];
  outDir?: string;
  language: string;
  requireHumanReview: boolean;
  strictWarnings: boolean;
  stopOnFailure: boolean;
  useDefaultFixtures: boolean;
  useExtendedFixtures: boolean;
  useCustomerFixtures: boolean;
  repeat: number;
  concurrency: number;
  maxSuccessfulP95Ms?: number;
  maxQueueP95Ms?: number;
  maxEndToEndP95Ms?: number;
  minThroughputJobsPerMinute?: number;
  maxPeakUsedDeltaMiB?: number;
  minFreeMemoryMiB?: number;
  maxExpectedPassFailureRate?: number;
  maxQualityWarningRows?: number;
  maxQualityFailureRows?: number;
  maxProductReviewCategoryQualityFailureRows?: number;
  help: boolean;
};

export type KatagoProductSmokeSuiteRow = {
  name: string;
  sgfPath: string;
  expectedToPass: boolean;
  expectationMet: boolean;
  passed: boolean;
  durationMs: number | null;
  queueWaitMs: number;
  endToEndMs: number;
  resultFileUrl: string | null;
  error: string | null;
  quality: {
    ok: boolean | null;
    failureCount: number | null;
    warningCount: number | null;
    issueCodes: string[];
  };
  productReviewCategoryQuality: {
    ok: boolean | null;
    failureCount: number | null;
    issueCodes: string[];
  };
  moves: number | null;
  visits: number | null;
  turnsOk: number | null;
  turnsFailed: number | null;
  bsiSignals: number | null;
  adiSignals: number | null;
  deepSearchEnabled: boolean | null;
  deepSearchCompleted: number | null;
  phaseDurationsMs: KatagoProductSmokeSummary["phaseDurationsMs"];
  corpus?: {
    manifestId: string;
    entryId: string;
    coverage: string[];
    approvedReviewers: number;
    passed: boolean;
    checks: KatagoCorpusExpectationCheck[];
  };
};

export type KatagoProductSmokeDurationStats = {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
};

export type KatagoProductSmokeMemorySnapshot = {
  totalBytes: number;
  freeBytes: number;
};

export type KatagoProductSmokeMemoryStats = {
  sampleCount: number;
  totalMiB: number;
  initialFreeMiB: number;
  minimumFreeMiB: number;
  peakUsedDeltaMiB: number;
};

export type KatagoProductSmokeSuiteStats = {
  successfulDurationMs: KatagoProductSmokeDurationStats;
  queueWaitMs: KatagoProductSmokeDurationStats;
  endToEndMs: KatagoProductSmokeDurationStats;
  expectedPass: {
    count: number;
    failed: number;
    failureRate: number | null;
  };
  quality: {
    warningRows: number;
    failureRows: number;
  };
  productReviewCategoryQualityFailureRows: number;
};

export type KatagoProductSmokeSuiteGateCheck = {
  name: string;
  passed: boolean;
  actual: number | null;
  threshold: number;
  message: string;
};

export type KatagoProductSmokeSuiteGate = {
  passed: boolean;
  checks: KatagoProductSmokeSuiteGateCheck[];
};

export type KatagoProductSmokeSuiteGateThresholds = {
  maxSuccessfulP95Ms?: number;
  maxQueueP95Ms?: number;
  maxEndToEndP95Ms?: number;
  minThroughputJobsPerMinute?: number;
  maxPeakUsedDeltaMiB?: number;
  minFreeMemoryMiB?: number;
  maxExpectedPassFailureRate?: number;
  maxQualityWarningRows?: number;
  maxQualityFailureRows?: number;
  maxProductReviewCategoryQualityFailureRows?: number;
};

export type KatagoProductSmokeSuiteReport = {
  passed: boolean;
  outDir: string;
  jsonPath: string;
  markdownPath: string;
  jsonFileUrl: string;
  markdownFileUrl: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  executionDurationMs: number;
  throughputJobsPerMinute: number;
  concurrency: number;
  memory: KatagoProductSmokeMemoryStats;
  totals: {
    count: number;
    expectationMet: number;
    expectationFailed: number;
    productPassed: number;
    productFailed: number;
  };
  stats: KatagoProductSmokeSuiteStats;
  gate: KatagoProductSmokeSuiteGate;
  corpusManifests: Array<{
    id: string;
    manifestPath: string;
    entries: number;
    coverage: string[];
    humanReview: LoadedKatagoCorpusManifest["humanReview"];
  }>;
  rows: KatagoProductSmokeSuiteRow[];
};

type KatagoProductSmokeTarget = {
  name: string;
  path: string;
  expectedToPass: boolean;
  corpus?: KatagoCorpusTarget["corpus"];
};

export const DEFAULT_KATAGO_PRODUCT_SMOKE_FIXTURES: KatagoProductSmokeFixture[] =
  [
    {
      name: "short-2-move",
      description: "Minimal 19x19 opening smoke.",
      fileName: "short-2-move.sgf",
      expectedToPass: true,
      sgf: "(;FF[4]GM[1]SZ[19]KM[6.5];B[pd];W[dd])",
    },
    {
      name: "nine-by-nine-pass",
      description: "9x9 game with a pass move.",
      fileName: "nine-by-nine-pass.sgf",
      expectedToPass: true,
      sgf: "(;FF[4]GM[1]SZ[9]KM[6.5];B[ee];W[cc];B[fg];W[];B[dc];W[cf])",
    },
    {
      name: "handicap-initial-stones",
      description: "19x19 fixture with initial handicap stones.",
      fileName: "handicap-initial-stones.sgf",
      expectedToPass: true,
      sgf: "(;FF[4]GM[1]SZ[19]KM[0.5]AB[dd][pd];W[pp];B[dp];W[qq];B[cc];W[qc];B[cp];W[pc])",
    },
    {
      name: "midgame-24-move",
      description:
        "Longer synthetic 19x19 smoke with enough turns for product candidate selection.",
      fileName: "midgame-24-move.sgf",
      expectedToPass: true,
      sgf:
        "(;FF[4]GM[1]SZ[19]KM[6.5]" +
        ";B[pd];W[dd];B[qp];W[dp];B[oq];W[fq];B[cn];W[dn]" +
        ";B[cq];W[dq];B[cp];W[co];B[bo];W[ep];B[do];W[eo]" +
        ";B[fo];W[fp];B[gp];W[gq];B[hp];W[hq];B[ip];W[iq])",
    },
    {
      name: "malformed-not-sgf",
      description:
        "Negative input guard; this should fail before KataGo execution.",
      fileName: "malformed-not-sgf.sgf",
      expectedToPass: false,
      sgf: "not an sgf",
    },
  ];

function sgfCoordFromIndex(index: number, boardSize: number): string {
  const col = index % boardSize;
  const row = Math.floor(index / boardSize);
  return `${String.fromCharCode("a".charCodeAt(0) + col)}${String.fromCharCode("a".charCodeAt(0) + row)}`;
}

function generatedSpreadPoints(
  boardSize: number,
  count: number,
  seed: number
): string[] {
  const total = boardSize * boardSize;
  if (count > total) {
    throw new Error(
      `Cannot generate ${String(count)} unique points on ${String(boardSize)}x${String(boardSize)}.`
    );
  }
  const step = boardSize === 19 ? 37 : boardSize === 13 ? 41 : 17;
  const points: string[] = [];
  const seen = new Set<number>();
  let cursor = seed % total;
  while (points.length < count) {
    if (!seen.has(cursor)) {
      seen.add(cursor);
      points.push(sgfCoordFromIndex(cursor, boardSize));
    }
    cursor = (cursor + step) % total;
  }
  return points;
}

function generatedAlternatingSgf(args: {
  boardSize: number;
  komi: number;
  count: number;
  seed: number;
  rootProps?: string;
  tailMoves?: string;
}): string {
  const points = generatedSpreadPoints(args.boardSize, args.count, args.seed);
  const moves = points
    .map((point, i) => `;${i % 2 === 0 ? "B" : "W"}[${point}]`)
    .join("");
  return `(;FF[4]GM[1]SZ[${String(args.boardSize)}]KM[${String(args.komi)}]${args.rootProps ?? ""}${moves}${
    args.tailMoves ?? ""
  })`;
}

export const EXTENDED_KATAGO_PRODUCT_SMOKE_FIXTURES: KatagoProductSmokeFixture[] =
  [
    {
      name: "synthetic-13x13-40-move",
      description:
        "Medium 13x13 synthetic corpus fixture with spread-out legal-looking moves.",
      fileName: "synthetic-13x13-40-move.sgf",
      expectedToPass: true,
      sgf: generatedAlternatingSgf({
        boardSize: 13,
        komi: 6.5,
        count: 40,
        seed: 7,
      }),
    },
    {
      name: "synthetic-19x19-60-move",
      description:
        "Longer 19x19 synthetic corpus fixture for runtime and product-signal smoke.",
      fileName: "synthetic-19x19-60-move.sgf",
      expectedToPass: true,
      sgf: generatedAlternatingSgf({
        boardSize: 19,
        komi: 6.5,
        count: 60,
        seed: 11,
      }),
    },
    {
      name: "synthetic-19x19-100-move",
      description:
        "Long 19x19 synthetic corpus fixture for customer-style runtime smoke.",
      fileName: "synthetic-19x19-100-move.sgf",
      expectedToPass: true,
      sgf: generatedAlternatingSgf({
        boardSize: 19,
        komi: 6.5,
        count: 100,
        seed: 23,
      }),
    },
  ];

export const CUSTOMER_STYLE_KATAGO_PRODUCT_SMOKE_FIXTURES: KatagoProductSmokeFixture[] =
  [
    {
      name: "customer-style-9x9-endgame-passes",
      description:
        "Synthetic 9x9 customer-style upload with endgame pass moves.",
      fileName: "customer-style-9x9-endgame-passes.sgf",
      expectedToPass: true,
      sgf: generatedAlternatingSgf({
        boardSize: 9,
        komi: 6.5,
        count: 36,
        seed: 5,
        rootProps:
          "PB[Mobile Black]PW[Mobile White]RE[W+2.5]C[customer-style 9x9 upload]",
        tailMoves: ";B[];W[]",
      }),
    },
    {
      name: "customer-style-13x13-commented-80-move",
      description:
        "Synthetic 13x13 customer-style upload with common metadata and comments.",
      fileName: "customer-style-13x13-commented-80-move.sgf",
      expectedToPass: true,
      sgf: generatedAlternatingSgf({
        boardSize: 13,
        komi: 6.5,
        count: 80,
        seed: 19,
        rootProps:
          "PB[Study Black]PW[Study White]BR[3k]WR[2k]RE[B+R]C[review request from imported SGF]",
      }),
    },
    {
      name: "customer-style-19x19-120-move",
      description:
        "Synthetic 19x19 customer-style midgame review with 120 moves.",
      fileName: "customer-style-19x19-120-move.sgf",
      expectedToPass: true,
      sgf: generatedAlternatingSgf({
        boardSize: 19,
        komi: 6.5,
        count: 120,
        seed: 31,
        rootProps:
          "PB[League Black]PW[League White]BR[1d]WR[1d]RE[W+R]DT[2026-07-10]",
      }),
    },
    {
      name: "customer-style-19x19-long-160-move",
      description:
        "Synthetic 19x19 customer-style longer game for runtime and parser coverage.",
      fileName: "customer-style-19x19-long-160-move.sgf",
      expectedToPass: true,
      sgf: generatedAlternatingSgf({
        boardSize: 19,
        komi: 7.5,
        count: 160,
        seed: 43,
        rootProps:
          "PB[Tournament Black]PW[Tournament White]BR[5d]WR[5d]RE[B+3.5]C[long-form customer review]",
      }),
    },
  ];

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function defaultMemorySnapshot(): KatagoProductSmokeMemorySnapshot {
  return { totalBytes: os.totalmem(), freeBytes: os.freemem() };
}

function bytesToMiB(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function normalizeArgPath(cwd: string, p: string): string {
  return path.resolve(cwd, p);
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

export function parseKatagoProductSmokeSuiteArgs(
  argv: string[]
): KatagoProductSmokeSuiteArgs {
  const parsed: KatagoProductSmokeSuiteArgs = {
    sgfPaths: [],
    corpusDirs: [],
    corpusManifestPaths: [],
    language: "ko",
    requireHumanReview: false,
    strictWarnings: false,
    stopOnFailure: false,
    useDefaultFixtures: false,
    useExtendedFixtures: false,
    useCustomerFixtures: false,
    repeat: 1,
    concurrency: 1,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
      continue;
    }
    if (arg === "--strict-warnings") {
      parsed.strictWarnings = true;
      continue;
    }
    if (arg === "--require-human-review") {
      parsed.requireHumanReview = true;
      continue;
    }
    if (arg === "--stop-on-failure") {
      parsed.stopOnFailure = true;
      continue;
    }
    if (arg === "--default-fixtures") {
      parsed.useDefaultFixtures = true;
      continue;
    }
    if (arg === "--extended-fixtures") {
      parsed.useExtendedFixtures = true;
      continue;
    }
    if (arg === "--customer-fixtures") {
      parsed.useCustomerFixtures = true;
      continue;
    }
    if (arg === "--repeat" || arg.startsWith("--repeat=")) {
      const value = shiftArg(argv, i, "--repeat");
      const n = value != null ? Number.parseInt(value, 10) : NaN;
      if (Number.isFinite(n) && n > 0) {
        parsed.repeat = Math.min(20, Math.max(1, n));
      }
      if (arg === "--repeat") {
        i += 1;
      }
      continue;
    }
    if (arg === "--concurrency" || arg.startsWith("--concurrency=")) {
      const value = shiftArg(argv, i, "--concurrency");
      const n = value != null ? Number.parseInt(value, 10) : NaN;
      if (Number.isFinite(n) && n > 0) {
        parsed.concurrency = Math.min(4, Math.max(1, n));
      }
      if (arg === "--concurrency") {
        i += 1;
      }
      continue;
    }
    if (
      arg === "--max-successful-p95-ms" ||
      arg.startsWith("--max-successful-p95-ms=")
    ) {
      const value = shiftArg(argv, i, "--max-successful-p95-ms");
      const n = value != null ? Number.parseInt(value, 10) : NaN;
      if (Number.isFinite(n) && n >= 0) {
        parsed.maxSuccessfulP95Ms = n;
      }
      if (arg === "--max-successful-p95-ms") {
        i += 1;
      }
      continue;
    }
    if (arg === "--max-queue-p95-ms" || arg.startsWith("--max-queue-p95-ms=")) {
      const value = shiftArg(argv, i, "--max-queue-p95-ms");
      const n = value != null ? Number.parseInt(value, 10) : NaN;
      if (Number.isFinite(n) && n >= 0) {
        parsed.maxQueueP95Ms = n;
      }
      if (arg === "--max-queue-p95-ms") {
        i += 1;
      }
      continue;
    }
    if (
      arg === "--max-end-to-end-p95-ms" ||
      arg.startsWith("--max-end-to-end-p95-ms=")
    ) {
      const value = shiftArg(argv, i, "--max-end-to-end-p95-ms");
      const n = value != null ? Number.parseInt(value, 10) : NaN;
      if (Number.isFinite(n) && n >= 0) {
        parsed.maxEndToEndP95Ms = n;
      }
      if (arg === "--max-end-to-end-p95-ms") {
        i += 1;
      }
      continue;
    }
    if (
      arg === "--min-throughput-jobs-per-minute" ||
      arg.startsWith("--min-throughput-jobs-per-minute=")
    ) {
      const value = shiftArg(argv, i, "--min-throughput-jobs-per-minute");
      const n = value != null ? Number.parseFloat(value) : NaN;
      if (Number.isFinite(n) && n >= 0) {
        parsed.minThroughputJobsPerMinute = n;
      }
      if (arg === "--min-throughput-jobs-per-minute") {
        i += 1;
      }
      continue;
    }
    if (
      arg === "--max-peak-used-delta-mib" ||
      arg.startsWith("--max-peak-used-delta-mib=")
    ) {
      const value = shiftArg(argv, i, "--max-peak-used-delta-mib");
      const n = value != null ? Number.parseFloat(value) : NaN;
      if (Number.isFinite(n) && n >= 0) {
        parsed.maxPeakUsedDeltaMiB = n;
      }
      if (arg === "--max-peak-used-delta-mib") {
        i += 1;
      }
      continue;
    }
    if (
      arg === "--min-free-memory-mib" ||
      arg.startsWith("--min-free-memory-mib=")
    ) {
      const value = shiftArg(argv, i, "--min-free-memory-mib");
      const n = value != null ? Number.parseFloat(value) : NaN;
      if (Number.isFinite(n) && n >= 0) {
        parsed.minFreeMemoryMiB = n;
      }
      if (arg === "--min-free-memory-mib") {
        i += 1;
      }
      continue;
    }
    if (
      arg === "--max-expected-pass-failure-rate" ||
      arg.startsWith("--max-expected-pass-failure-rate=")
    ) {
      const value = shiftArg(argv, i, "--max-expected-pass-failure-rate");
      const n = value != null ? Number.parseFloat(value) : NaN;
      if (Number.isFinite(n) && n >= 0) {
        parsed.maxExpectedPassFailureRate = Math.min(1, n);
      }
      if (arg === "--max-expected-pass-failure-rate") {
        i += 1;
      }
      continue;
    }
    if (
      arg === "--max-quality-warning-rows" ||
      arg.startsWith("--max-quality-warning-rows=")
    ) {
      const value = shiftArg(argv, i, "--max-quality-warning-rows");
      const n = value != null ? Number.parseInt(value, 10) : NaN;
      if (Number.isFinite(n) && n >= 0) {
        parsed.maxQualityWarningRows = n;
      }
      if (arg === "--max-quality-warning-rows") {
        i += 1;
      }
      continue;
    }
    if (
      arg === "--max-quality-failure-rows" ||
      arg.startsWith("--max-quality-failure-rows=")
    ) {
      const value = shiftArg(argv, i, "--max-quality-failure-rows");
      const n = value != null ? Number.parseInt(value, 10) : NaN;
      if (Number.isFinite(n) && n >= 0) {
        parsed.maxQualityFailureRows = n;
      }
      if (arg === "--max-quality-failure-rows") {
        i += 1;
      }
      continue;
    }
    if (
      arg === "--max-product-review-category-quality-failure-rows" ||
      arg.startsWith("--max-product-review-category-quality-failure-rows=")
    ) {
      const value = shiftArg(
        argv,
        i,
        "--max-product-review-category-quality-failure-rows"
      );
      const n = value != null ? Number.parseInt(value, 10) : NaN;
      if (Number.isFinite(n) && n >= 0) {
        parsed.maxProductReviewCategoryQualityFailureRows = n;
      }
      if (arg === "--max-product-review-category-quality-failure-rows") {
        i += 1;
      }
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
    if (arg === "--corpus-dir" || arg.startsWith("--corpus-dir=")) {
      const value = shiftArg(argv, i, "--corpus-dir");
      if (value) {
        parsed.corpusDirs.push(value);
        if (arg === "--corpus-dir") {
          i += 1;
        }
      }
      continue;
    }
    if (arg === "--corpus-manifest" || arg.startsWith("--corpus-manifest=")) {
      const value = shiftArg(argv, i, "--corpus-manifest");
      if (value) {
        parsed.corpusManifestPaths.push(value);
        if (arg === "--corpus-manifest") {
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
      parsed.sgfPaths.push(arg);
    }
  }

  return parsed;
}

async function collectSgfPathsFromDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSgfPathsFromDir(p)));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".sgf")) {
      files.push(p);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

export async function collectSgfCorpusTargets(opts: {
  cwd?: string;
  corpusDirs: string[];
}): Promise<KatagoProductSmokeTarget[]> {
  const cwd = opts.cwd ?? process.cwd();
  const targets: KatagoProductSmokeTarget[] = [];
  for (const corpusDir of opts.corpusDirs) {
    const root = path.resolve(cwd, corpusDir);
    const sgfPaths = await collectSgfPathsFromDir(root);
    for (const sgfPath of sgfPaths) {
      targets.push({
        name: path.relative(cwd, sgfPath).replace(/\\/g, "/"),
        path: sgfPath,
        expectedToPass: true,
      });
    }
  }
  return targets;
}

export async function writeDefaultKatagoProductSmokeFixtures(opts: {
  cwd?: string;
  outDir?: string;
  fixtures?: readonly KatagoProductSmokeFixture[];
}): Promise<KatagoProductSmokeTarget[]> {
  const cwd = opts.cwd ?? process.cwd();
  const fixtureDir = path.resolve(
    cwd,
    opts.outDir ?? path.join(".tmp", "katago-suite", "fixtures")
  );
  await mkdir(fixtureDir, { recursive: true });
  const out: KatagoProductSmokeTarget[] = [];
  for (const fixture of opts.fixtures ??
    DEFAULT_KATAGO_PRODUCT_SMOKE_FIXTURES) {
    const fixturePath = path.join(fixtureDir, fixture.fileName);
    await writeFile(fixturePath, `${fixture.sgf}\n`, "utf8");
    out.push({
      name: fixture.name,
      path: fixturePath,
      expectedToPass: fixture.expectedToPass,
    });
  }
  return out;
}

function rowFromSummary(args: {
  name: string;
  sgfPath: string;
  expectedToPass: boolean;
  corpus?: KatagoCorpusTarget["corpus"];
  summary: KatagoProductSmokeSummary;
  queueWaitMs: number;
  endToEndMs: number;
}): KatagoProductSmokeSuiteRow {
  const productPassed = args.summary.passed;
  const corpusEvaluation =
    args.corpus == null
      ? null
      : evaluateKatagoCorpusExpectations({
          expected: args.corpus.expected,
          actual: {
            visits: args.summary.engineMaxVisits,
            turnsOk: args.summary.turnAnalyses.okCount,
            turnsFailed: args.summary.turnAnalyses.failedCount,
            bsiSignals: args.summary.bsiSignalCount,
            adiSignals: args.summary.adiSignalCount,
            bsiSignalTurns: args.summary.bsiSignalTurns,
            adiSignalTurns: args.summary.adiSignalTurns,
            qualityWarnings: args.summary.qualityGate.warningCount,
            qualityFailures: args.summary.qualityGate.failureCount,
          },
        });
  return {
    name: args.name,
    sgfPath: args.sgfPath,
    expectedToPass: args.expectedToPass,
    expectationMet:
      productPassed === args.expectedToPass &&
      (corpusEvaluation?.passed ?? true),
    passed: productPassed,
    durationMs: args.summary.durationMs,
    queueWaitMs: args.queueWaitMs,
    endToEndMs: args.endToEndMs,
    resultFileUrl: args.summary.outputFileUrl,
    error: null,
    quality: {
      ok: args.summary.qualityGate.ok,
      failureCount: args.summary.qualityGate.failureCount,
      warningCount: args.summary.qualityGate.warningCount,
      issueCodes: args.summary.qualityGate.issues.map(issue => issue.code),
    },
    productReviewCategoryQuality: {
      ok: args.summary.productReviewCategoryQuality.ok,
      failureCount: args.summary.productReviewCategoryQuality.failureCount,
      issueCodes: args.summary.productReviewCategoryQuality.issues.map(issue => issue.code),
    },
    moves: args.summary.gameTotalMoves,
    visits: args.summary.engineMaxVisits,
    turnsOk: args.summary.turnAnalyses.okCount,
    turnsFailed: args.summary.turnAnalyses.failedCount,
    bsiSignals: args.summary.bsiSignalCount,
    adiSignals: args.summary.adiSignalCount,
    deepSearchEnabled: args.summary.deepSearch.enabled,
    deepSearchCompleted: args.summary.deepSearch.completedCount,
    phaseDurationsMs: args.summary.phaseDurationsMs,
    ...(args.corpus == null || corpusEvaluation == null
      ? {}
      : {
          corpus: {
            manifestId: args.corpus.manifestId,
            entryId: args.corpus.entryId,
            coverage: args.corpus.coverage,
            approvedReviewers: args.corpus.approvedReviewers,
            passed: corpusEvaluation.passed,
            checks: corpusEvaluation.checks,
          },
        }),
  };
}

function rowFromError(args: {
  name: string;
  sgfPath: string;
  expectedToPass: boolean;
  corpus?: KatagoCorpusTarget["corpus"];
  error: unknown;
  queueWaitMs: number;
  endToEndMs: number;
}): KatagoProductSmokeSuiteRow {
  const message =
    args.error instanceof Error ? args.error.message : String(args.error);
  return {
    name: args.name,
    sgfPath: args.sgfPath,
    expectedToPass: args.expectedToPass,
    expectationMet: args.expectedToPass === false,
    passed: false,
    durationMs: null,
    queueWaitMs: args.queueWaitMs,
    endToEndMs: args.endToEndMs,
    resultFileUrl: null,
    error: message,
    quality: {
      ok: null,
      failureCount: null,
      warningCount: null,
      issueCodes: [],
    },
    productReviewCategoryQuality: {
      ok: null,
      failureCount: null,
      issueCodes: [],
    },
    moves: null,
    visits: null,
    turnsOk: null,
    turnsFailed: null,
    bsiSignals: null,
    adiSignals: null,
    deepSearchEnabled: null,
    deepSearchCompleted: null,
    phaseDurationsMs: {
      totalBeforeQualityGate: null,
      rootAnalysis: null,
      rootStage: null,
      multiTurn: null,
      signalPlanning: null,
      deepSearch: null,
      winrateTimeline: null,
    },
    ...(args.corpus == null
      ? {}
      : {
          corpus: {
            manifestId: args.corpus.manifestId,
            entryId: args.corpus.entryId,
            coverage: args.corpus.coverage,
            approvedReviewers: args.corpus.approvedReviewers,
            passed: false,
            checks: [],
          },
        }),
  };
}

function markdownEscape(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function percentileNearestRank(
  sortedValues: number[],
  percentile: number
): number | null {
  if (sortedValues.length === 0) {
    return null;
  }
  const rank = Math.ceil((percentile / 100) * sortedValues.length);
  const index = Math.min(sortedValues.length - 1, Math.max(0, rank - 1));
  return sortedValues[index]!;
}

function buildDurationStats(values: number[]): KatagoProductSmokeDurationStats {
  const sortedValues = values
    .filter(value => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const sum = sortedValues.reduce((acc, value) => acc + value, 0);
  return {
    count: sortedValues.length,
    min: sortedValues[0] ?? null,
    max: sortedValues[sortedValues.length - 1] ?? null,
    mean:
      sortedValues.length > 0 ? Math.round(sum / sortedValues.length) : null,
    p50: percentileNearestRank(sortedValues, 50),
    p90: percentileNearestRank(sortedValues, 90),
    p95: percentileNearestRank(sortedValues, 95),
  };
}

export function buildKatagoProductSmokeSuiteStats(
  rows: KatagoProductSmokeSuiteRow[]
): KatagoProductSmokeSuiteStats {
  const successfulDurations = rows
    .filter(
      row =>
        row.passed &&
        typeof row.durationMs === "number" &&
        Number.isFinite(row.durationMs)
    )
    .map(row => row.durationMs as number)
    .sort((a, b) => a - b);
  const expectedPassRows = rows.filter(row => row.expectedToPass);
  const expectedPassFailed = expectedPassRows.filter(row => !row.passed).length;

  return {
    successfulDurationMs: buildDurationStats(successfulDurations),
    queueWaitMs: buildDurationStats(rows.map(row => row.queueWaitMs)),
    endToEndMs: buildDurationStats(rows.map(row => row.endToEndMs)),
    expectedPass: {
      count: expectedPassRows.length,
      failed: expectedPassFailed,
      failureRate:
        expectedPassRows.length > 0
          ? expectedPassFailed / expectedPassRows.length
          : null,
    },
    quality: {
      warningRows: rows.filter(row => (row.quality.warningCount ?? 0) > 0)
        .length,
      failureRows: rows.filter(row => (row.quality.failureCount ?? 0) > 0)
        .length,
    },
    productReviewCategoryQualityFailureRows: rows.filter(
      row => (row.productReviewCategoryQuality.failureCount ?? 0) > 0
    ).length,
  };
}

function gateCheck(args: {
  name: string;
  actual: number | null;
  threshold: number;
  messageLabel: string;
}): KatagoProductSmokeSuiteGateCheck {
  const passed = args.actual != null && args.actual <= args.threshold;
  return {
    name: args.name,
    passed,
    actual: args.actual,
    threshold: args.threshold,
    message: `${args.messageLabel}: actual=${String(args.actual ?? "n/a")} threshold<=${String(args.threshold)}`,
  };
}

function minimumGateCheck(args: {
  name: string;
  actual: number | null;
  threshold: number;
  messageLabel: string;
}): KatagoProductSmokeSuiteGateCheck {
  const passed = args.actual != null && args.actual >= args.threshold;
  return {
    name: args.name,
    passed,
    actual: args.actual,
    threshold: args.threshold,
    message: `${args.messageLabel}: actual=${String(args.actual ?? "n/a")} threshold>=${String(args.threshold)}`,
  };
}

export function buildKatagoProductSmokeSuiteGate(args: {
  stats: KatagoProductSmokeSuiteStats;
  throughputJobsPerMinute?: number | null;
  memory?: KatagoProductSmokeMemoryStats;
  thresholds?: KatagoProductSmokeSuiteGateThresholds;
}): KatagoProductSmokeSuiteGate {
  const thresholds = args.thresholds ?? {};
  const checks: KatagoProductSmokeSuiteGateCheck[] = [];

  if (thresholds.maxSuccessfulP95Ms != null) {
    checks.push(
      gateCheck({
        name: "max_successful_p95_ms",
        actual: args.stats.successfulDurationMs.p95,
        threshold: thresholds.maxSuccessfulP95Ms,
        messageLabel: "successful duration p95 ms",
      })
    );
  }
  if (thresholds.maxQueueP95Ms != null) {
    checks.push(
      gateCheck({
        name: "max_queue_p95_ms",
        actual: args.stats.queueWaitMs.p95,
        threshold: thresholds.maxQueueP95Ms,
        messageLabel: "queue wait p95 ms",
      })
    );
  }
  if (thresholds.maxEndToEndP95Ms != null) {
    checks.push(
      gateCheck({
        name: "max_end_to_end_p95_ms",
        actual: args.stats.endToEndMs.p95,
        threshold: thresholds.maxEndToEndP95Ms,
        messageLabel: "end-to-end p95 ms",
      })
    );
  }
  if (thresholds.minThroughputJobsPerMinute != null) {
    checks.push(
      minimumGateCheck({
        name: "min_throughput_jobs_per_minute",
        actual: args.throughputJobsPerMinute ?? null,
        threshold: thresholds.minThroughputJobsPerMinute,
        messageLabel: "throughput jobs per minute",
      })
    );
  }
  if (thresholds.maxPeakUsedDeltaMiB != null) {
    checks.push(
      gateCheck({
        name: "max_peak_used_delta_mib",
        actual: args.memory?.peakUsedDeltaMiB ?? null,
        threshold: thresholds.maxPeakUsedDeltaMiB,
        messageLabel: "whole-system peak used delta MiB",
      })
    );
  }
  if (thresholds.minFreeMemoryMiB != null) {
    checks.push(
      minimumGateCheck({
        name: "min_free_memory_mib",
        actual: args.memory?.minimumFreeMiB ?? null,
        threshold: thresholds.minFreeMemoryMiB,
        messageLabel: "whole-system minimum free memory MiB",
      })
    );
  }
  if (thresholds.maxExpectedPassFailureRate != null) {
    checks.push(
      gateCheck({
        name: "max_expected_pass_failure_rate",
        actual: args.stats.expectedPass.failureRate,
        threshold: thresholds.maxExpectedPassFailureRate,
        messageLabel: "expected-pass failure rate",
      })
    );
  }
  if (thresholds.maxQualityWarningRows != null) {
    checks.push(
      gateCheck({
        name: "max_quality_warning_rows",
        actual: args.stats.quality.warningRows,
        threshold: thresholds.maxQualityWarningRows,
        messageLabel: "quality warning rows",
      })
    );
  }
  if (thresholds.maxQualityFailureRows != null) {
    checks.push(
      gateCheck({
        name: "max_quality_failure_rows",
        actual: args.stats.quality.failureRows,
        threshold: thresholds.maxQualityFailureRows,
        messageLabel: "quality failure rows",
      })
    );
  }
  if (thresholds.maxProductReviewCategoryQualityFailureRows != null) {
    checks.push(
      gateCheck({
        name: "max_product_review_category_quality_failure_rows",
        actual: args.stats.productReviewCategoryQualityFailureRows,
        threshold: thresholds.maxProductReviewCategoryQualityFailureRows,
        messageLabel: "Product Review category-quality failure rows",
      })
    );
  }

  return {
    passed: checks.every(check => check.passed),
    checks,
  };
}

export function renderKatagoProductSmokeSuiteMarkdown(
  report: Omit<
    KatagoProductSmokeSuiteReport,
    "jsonPath" | "markdownPath" | "jsonFileUrl" | "markdownFileUrl"
  >
): string {
  const lines: string[] = [];
  lines.push("# KataGo Product Smoke Suite Benchmark");
  lines.push("");
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Finished: ${report.finishedAt}`);
  lines.push(`- Duration ms: ${String(report.durationMs)}`);
  lines.push(`- Execution duration ms: ${String(report.executionDurationMs)}`);
  lines.push(
    `- Throughput jobs/min: ${String(report.throughputJobsPerMinute)}`
  );
  lines.push(`- Concurrency: ${String(report.concurrency)}`);
  lines.push(
    `- Whole-system memory MiB*: initialFree=${String(report.memory.initialFreeMiB)} minimumFree=${String(report.memory.minimumFreeMiB)} peakUsedDelta=${String(report.memory.peakUsedDeltaMiB)} samples=${String(report.memory.sampleCount)}`
  );
  lines.push(`- Passed: ${String(report.passed)}`);
  lines.push(
    `- Expectation met: ${String(report.totals.expectationMet)}/${String(report.totals.count)}`
  );
  lines.push(
    `- Successful duration ms: count=${String(report.stats.successfulDurationMs.count)} p50=${String(
      report.stats.successfulDurationMs.p50 ?? "n/a"
    )} p90=${String(report.stats.successfulDurationMs.p90 ?? "n/a")} p95=${String(
      report.stats.successfulDurationMs.p95 ?? "n/a"
    )} max=${String(report.stats.successfulDurationMs.max ?? "n/a")}`
  );
  lines.push(
    `- Queue wait ms: count=${String(report.stats.queueWaitMs.count)} p50=${String(
      report.stats.queueWaitMs.p50 ?? "n/a"
    )} p90=${String(report.stats.queueWaitMs.p90 ?? "n/a")} p95=${String(
      report.stats.queueWaitMs.p95 ?? "n/a"
    )} max=${String(report.stats.queueWaitMs.max ?? "n/a")}`
  );
  lines.push(
    `- End-to-end ms: count=${String(report.stats.endToEndMs.count)} p50=${String(
      report.stats.endToEndMs.p50 ?? "n/a"
    )} p90=${String(report.stats.endToEndMs.p90 ?? "n/a")} p95=${String(
      report.stats.endToEndMs.p95 ?? "n/a"
    )} max=${String(report.stats.endToEndMs.max ?? "n/a")}`
  );
  lines.push(
    `- Expected-pass failures: ${String(report.stats.expectedPass.failed)}/${String(
      report.stats.expectedPass.count
    )} rate=${String(report.stats.expectedPass.failureRate ?? "n/a")}`
  );
  lines.push(
    `- Quality issue rows: warnings=${String(report.stats.quality.warningRows)} failures=${String(
      report.stats.quality.failureRows
    )}`
  );
  lines.push(
    `- Product Review category-quality failure rows: ${String(report.stats.productReviewCategoryQualityFailureRows)}`
  );
  lines.push(`- Gate passed: ${String(report.gate.passed)}`);
  if (report.gate.checks.length > 0) {
    for (const check of report.gate.checks) {
      lines.push(
        `  - ${check.name}: ${check.passed ? "passed" : "failed"} (${check.message})`
      );
    }
  }
  if (report.corpusManifests.length > 0) {
    lines.push("- Corpus manifests:");
    for (const manifest of report.corpusManifests) {
      lines.push(
        `  - ${manifest.id}: entries=${String(manifest.entries)} coverage=${manifest.coverage.join(",")} humanApproved=${String(manifest.humanReview.approvedEntries)}/${String(manifest.humanReview.totalEntries)} required=${String(manifest.humanReview.required)}`
      );
    }
  }
  lines.push("");
  lines.push(
    "| Fixture | Expected | Met | Product Passed | Moves | Visits | Duration ms | Queue ms | E2E ms | Root/MT ms | Quality | Product Review Category | Turns ok/failed | BSI | ADI | Deep Search | Corpus | Issues/Error |"
  );
  lines.push(
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |"
  );
  for (const row of report.rows) {
    const quality =
      row.quality.ok == null
        ? "n/a"
        : `ok=${String(row.quality.ok)} f=${String(row.quality.failureCount)} w=${String(row.quality.warningCount)}`;
    const categoryQuality =
      row.productReviewCategoryQuality.ok == null
        ? "n/a"
        : `ok=${String(row.productReviewCategoryQuality.ok)} f=${String(row.productReviewCategoryQuality.failureCount)}`;
    const turns =
      row.turnsOk == null || row.turnsFailed == null
        ? "n/a"
        : `${String(row.turnsOk)}/${String(row.turnsFailed)}`;
    const deep =
      row.deepSearchEnabled == null
        ? "n/a"
        : `enabled=${String(row.deepSearchEnabled)} completed=${String(row.deepSearchCompleted ?? "n/a")}`;
    const phases = `${String(row.phaseDurationsMs.rootAnalysis ?? "n/a")}/${String(row.phaseDurationsMs.multiTurn ?? "n/a")}`;
    const corpus =
      row.corpus == null
        ? "n/a"
        : `${row.corpus.manifestId}/${row.corpus.entryId} passed=${String(row.corpus.passed)} reviews=${String(row.corpus.approvedReviewers)}`;
    const failedCorpusChecks =
      row.corpus?.checks
        .filter(check => !check.passed)
        .map(check => check.message) ?? [];
    const issuesOrError =
      row.error != null
        ? row.error
        : [
            ...row.quality.issueCodes,
            ...row.productReviewCategoryQuality.issueCodes,
            ...failedCorpusChecks,
          ].join(",");
    lines.push(
      [
        markdownEscape(row.name),
        row.expectedToPass ? "pass" : "fail",
        String(row.expectationMet),
        String(row.passed),
        String(row.moves ?? "n/a"),
        String(row.visits ?? "n/a"),
        String(row.durationMs ?? "n/a"),
        String(row.queueWaitMs),
        String(row.endToEndMs),
        phases,
        markdownEscape(quality),
        markdownEscape(categoryQuality),
        turns,
        String(row.bsiSignals ?? "n/a"),
        String(row.adiSignals ?? "n/a"),
        markdownEscape(deep),
        markdownEscape(corpus),
        markdownEscape(issuesOrError),
      ]
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |")
    );
  }
  lines.push("");
  lines.push(
    "Result JSON files are written by each product smoke run and linked in the suite JSON report."
  );
  lines.push(
    "\* Memory values are approximate whole-system samples, not isolated Worker RSS or GPU VRAM."
  );
  return `${lines.join("\n")}\n`;
}

export async function runKatagoProductSmokeSuite(opts: {
  sgfPaths: string[];
  corpusDirs?: string[];
  corpusManifestPaths?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  outDir?: string;
  language?: string;
  requireHumanReview?: boolean;
  strictWarnings?: boolean;
  stopOnFailure?: boolean;
  useDefaultFixtures?: boolean;
  useExtendedFixtures?: boolean;
  useCustomerFixtures?: boolean;
  repeat?: number;
  concurrency?: number;
  gateThresholds?: KatagoProductSmokeSuiteGateThresholds;
  analyzeFn?: AnalyzeFn;
  memorySnapshot?: () => KatagoProductSmokeMemorySnapshot;
  memorySampleIntervalMs?: number;
}): Promise<KatagoProductSmokeSuiteReport> {
  const cwd = opts.cwd ?? process.cwd();
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const ts = timestampForFilename();
  const outDir = path.resolve(
    cwd,
    opts.outDir ?? path.join(".tmp", "katago-suite", ts)
  );
  const resultsDir = path.join(outDir, "results");
  await mkdir(resultsDir, { recursive: true });

  const targets: KatagoProductSmokeTarget[] = [];
  const corpusManifests: LoadedKatagoCorpusManifest[] = [];
  for (const manifestPath of opts.corpusManifestPaths ?? []) {
    const manifest = await loadKatagoCorpusManifest({
      cwd,
      manifestPath,
      requireHumanReview: opts.requireHumanReview,
    });
    corpusManifests.push(manifest);
    targets.push(...manifest.entries);
  }
  if (opts.useDefaultFixtures) {
    targets.push(
      ...(await writeDefaultKatagoProductSmokeFixtures({
        cwd,
        outDir: path.join(outDir, "fixtures"),
      }))
    );
  }
  if (opts.useExtendedFixtures) {
    targets.push(
      ...(await writeDefaultKatagoProductSmokeFixtures({
        cwd,
        outDir: path.join(outDir, "fixtures"),
        fixtures: EXTENDED_KATAGO_PRODUCT_SMOKE_FIXTURES,
      }))
    );
  }
  if (opts.useCustomerFixtures) {
    targets.push(
      ...(await writeDefaultKatagoProductSmokeFixtures({
        cwd,
        outDir: path.join(outDir, "fixtures"),
        fixtures: CUSTOMER_STYLE_KATAGO_PRODUCT_SMOKE_FIXTURES,
      }))
    );
  }
  targets.push(
    ...(await collectSgfCorpusTargets({
      cwd,
      corpusDirs: opts.corpusDirs ?? [],
    }))
  );
  for (const sgfPath of opts.sgfPaths) {
    const absolute = normalizeArgPath(cwd, sgfPath);
    targets.push({
      name: path.basename(sgfPath),
      path: absolute,
      expectedToPass: true,
    });
  }
  if (targets.length === 0) {
    throw new Error(
      "KATAGO_PRODUCT_SMOKE_SUITE_NO_TARGETS: pass SGF paths, --corpus-manifest, --corpus-dir, --default-fixtures, --extended-fixtures, or --customer-fixtures."
    );
  }
  const repeat = Math.min(20, Math.max(1, Math.trunc(opts.repeat ?? 1)));
  const repeatedTargets =
    repeat === 1
      ? targets
      : Array.from({ length: repeat }, (_, i) =>
          targets.map(target => ({
            ...target,
            name: `${target.name}#${String(i + 1)}`,
          }))
        ).flat();
  const requestedConcurrency = Math.trunc(opts.concurrency ?? 1);
  const concurrency = Number.isFinite(requestedConcurrency)
    ? Math.min(4, Math.max(1, requestedConcurrency))
    : 1;
  if (opts.stopOnFailure === true && concurrency > 1) {
    throw new Error(
      "KATAGO_PRODUCT_SMOKE_SUITE_STOP_ON_FAILURE_REQUIRES_CONCURRENCY_1"
    );
  }

  const rowsByIndex: Array<KatagoProductSmokeSuiteRow | undefined> = new Array(
    repeatedTargets.length
  );
  const memorySnapshot = opts.memorySnapshot ?? defaultMemorySnapshot;
  const initialMemory = memorySnapshot();
  const initialUsedBytes = initialMemory.totalBytes - initialMemory.freeBytes;
  let peakUsedBytes = initialUsedBytes;
  let minimumFreeBytes = initialMemory.freeBytes;
  let memorySampleCount = 1;
  const sampleMemory = (): void => {
    const current = memorySnapshot();
    peakUsedBytes = Math.max(
      peakUsedBytes,
      current.totalBytes - current.freeBytes
    );
    minimumFreeBytes = Math.min(minimumFreeBytes, current.freeBytes);
    memorySampleCount += 1;
  };
  const requestedMemorySampleIntervalMs = Math.trunc(
    opts.memorySampleIntervalMs ?? 250
  );
  const memorySampleIntervalMs = Number.isFinite(
    requestedMemorySampleIntervalMs
  )
    ? Math.max(25, requestedMemorySampleIntervalMs)
    : 250;
  const memoryTimer = setInterval(sampleMemory, memorySampleIntervalMs);
  memoryTimer.unref?.();
  const executionStarted = Date.now();
  let nextIndex = 0;
  let stopRequested = false;

  const runNext = async (): Promise<void> => {
    while (!stopRequested) {
      const index = nextIndex;
      if (index >= repeatedTargets.length) {
        return;
      }
      nextIndex += 1;
      const target = repeatedTargets[index]!;
      const queueWaitMs = Date.now() - executionStarted;
      let row: KatagoProductSmokeSuiteRow;
      try {
        const summary = await runKatagoProductSmoke({
          sgfPath: target.path,
          cwd,
          env: opts.env,
          outDir: resultsDir,
          jobId: `katatalk-suite-${target.name}-${String(index + 1)}-${ts}`,
          language: opts.language ?? "ko",
          strictWarnings: opts.strictWarnings,
          analyzeFn: opts.analyzeFn,
        });
        row = rowFromSummary({
          name: target.name,
          sgfPath: target.path,
          expectedToPass: target.expectedToPass,
          corpus: target.corpus,
          summary,
          queueWaitMs,
          endToEndMs: Date.now() - executionStarted,
        });
      } catch (error) {
        row = rowFromError({
          name: target.name,
          sgfPath: target.path,
          expectedToPass: target.expectedToPass,
          corpus: target.corpus,
          error,
          queueWaitMs,
          endToEndMs: Date.now() - executionStarted,
        });
      }
      rowsByIndex[index] = row;
      if (opts.stopOnFailure === true && !row.expectationMet) {
        stopRequested = true;
      }
    }
  };

  const workerCount = Math.min(concurrency, repeatedTargets.length);
  try {
    await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  } finally {
    clearInterval(memoryTimer);
    sampleMemory();
  }
  const executionDurationMs = Date.now() - executionStarted;
  const rows = rowsByIndex.filter(
    (row): row is KatagoProductSmokeSuiteRow => row != null
  );
  const throughputJobsPerMinute =
    Math.round(
      ((rows.length * 60_000) / Math.max(1, executionDurationMs)) * 100
    ) / 100;
  const memory: KatagoProductSmokeMemoryStats = {
    sampleCount: memorySampleCount,
    totalMiB: bytesToMiB(initialMemory.totalBytes),
    initialFreeMiB: bytesToMiB(initialMemory.freeBytes),
    minimumFreeMiB: bytesToMiB(minimumFreeBytes),
    peakUsedDeltaMiB: bytesToMiB(Math.max(0, peakUsedBytes - initialUsedBytes)),
  };

  const finishedAt = new Date().toISOString();
  const totals = {
    count: rows.length,
    expectationMet: rows.filter(row => row.expectationMet).length,
    expectationFailed: rows.filter(row => !row.expectationMet).length,
    productPassed: rows.filter(row => row.passed).length,
    productFailed: rows.filter(row => !row.passed).length,
  };
  const stats = buildKatagoProductSmokeSuiteStats(rows);
  const gate = buildKatagoProductSmokeSuiteGate({
    stats,
    throughputJobsPerMinute,
    memory,
    thresholds: opts.gateThresholds,
  });
  const passed = totals.expectationFailed === 0 && gate.passed;

  const jsonPath = path.join(outDir, `benchmark-${ts}.json`);
  const markdownPath = path.join(outDir, `benchmark-${ts}.md`);
  const reportBase = {
    passed,
    outDir,
    startedAt,
    finishedAt,
    durationMs: Date.now() - started,
    executionDurationMs,
    throughputJobsPerMinute,
    concurrency,
    memory,
    totals,
    stats,
    gate,
    corpusManifests: corpusManifests.map(manifest => ({
      id: manifest.id,
      manifestPath: manifest.manifestPath,
      entries: manifest.entries.length,
      coverage: manifest.coverage,
      humanReview: manifest.humanReview,
    })),
    rows,
  };
  const markdown = renderKatagoProductSmokeSuiteMarkdown(reportBase);
  const report: KatagoProductSmokeSuiteReport = {
    ...reportBase,
    jsonPath,
    markdownPath,
    jsonFileUrl: pathToFileURL(jsonPath).href,
    markdownFileUrl: pathToFileURL(markdownPath).href,
  };

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdown, "utf8");
  return report;
}

export function katagoProductSmokeSuiteUsage(): string {
  return [
    "Usage: corepack pnpm katago:product-suite -- [options] <game1.sgf> <game2.sgf> ...",
    "",
    "Options:",
    "  --default-fixtures      Generate and run built-in ignored synthetic fixtures.",
    "  --extended-fixtures     Generate and run longer synthetic representative fixtures.",
    "  --customer-fixtures     Generate and run broader synthetic customer-style fixtures.",
    "  --corpus-manifest <file>",
    "                          Run a versioned private corpus manifest with checksums and expectations.",
    "  --corpus-dir <dir>      Recursively run all .sgf files from an ignored private corpus directory.",
    "  --require-human-review  Require two approved reviewers per manifest entry and no rejection.",
    "  --repeat <n>            Repeat each target n times. Default: 1, max: 20.",
    "  --concurrency <n>       Run up to n targets concurrently. Default: 1, max: 4.",
    "  --max-successful-p95-ms <n>",
    "                          Fail the suite when successful duration p95 exceeds n ms.",
    "  --max-queue-p95-ms <n>",
    "                          Fail the suite when queue wait p95 exceeds n ms.",
    "  --max-end-to-end-p95-ms <n>",
    "                          Fail the suite when end-to-end p95 exceeds n ms.",
    "  --min-throughput-jobs-per-minute <n>",
    "                          Fail when completed throughput is below n jobs/min.",
    "  --max-peak-used-delta-mib <n>",
    "                          Fail when approximate whole-system used-memory delta exceeds n MiB.",
    "  --min-free-memory-mib <n>",
    "                          Fail when approximate whole-system free memory drops below n MiB.",
    "  --max-expected-pass-failure-rate <n>",
    "                          Fail when expected-pass failure rate exceeds n. Use 0-1, e.g. 0.05.",
    "  --max-quality-warning-rows <n>",
    "                          Fail when more than n rows contain quality warnings.",
    "  --max-quality-failure-rows <n>",
    "                          Fail when more than n rows contain quality failures.",
    "  --max-product-review-category-quality-failure-rows <n>",
    "                          Fail when more than n rows violate Product Review category invariants.",
    "  --strict-warnings       Treat quality warnings as product smoke failures.",
    "  --stop-on-failure       Stop after the first expectation mismatch.",
    "  --out-dir <dir>         Output directory. Default: .tmp/katago-suite/<timestamp>",
    "  --lang <code>           Analysis language input. Default: ko",
  ].join("\n");
}

export async function runKatagoProductSmokeSuiteCliMain(
  argv: string[]
): Promise<void> {
  const args = parseKatagoProductSmokeSuiteArgs(argv);
  if (args.help) {
    console.log(katagoProductSmokeSuiteUsage());
    return;
  }

  try {
    const report = await runKatagoProductSmokeSuite({
      sgfPaths: args.sgfPaths,
      corpusDirs: args.corpusDirs,
      corpusManifestPaths: args.corpusManifestPaths,
      outDir: args.outDir,
      language: args.language,
      requireHumanReview: args.requireHumanReview,
      strictWarnings: args.strictWarnings,
      stopOnFailure: args.stopOnFailure,
      useDefaultFixtures: args.useDefaultFixtures,
      useExtendedFixtures: args.useExtendedFixtures,
      useCustomerFixtures: args.useCustomerFixtures,
      repeat: args.repeat,
      concurrency: args.concurrency,
      gateThresholds: {
        maxSuccessfulP95Ms: args.maxSuccessfulP95Ms,
        maxQueueP95Ms: args.maxQueueP95Ms,
        maxEndToEndP95Ms: args.maxEndToEndP95Ms,
        minThroughputJobsPerMinute: args.minThroughputJobsPerMinute,
        maxPeakUsedDeltaMiB: args.maxPeakUsedDeltaMiB,
        minFreeMemoryMiB: args.minFreeMemoryMiB,
        maxExpectedPassFailureRate: args.maxExpectedPassFailureRate,
        maxQualityWarningRows: args.maxQualityWarningRows,
        maxQualityFailureRows: args.maxQualityFailureRows,
        maxProductReviewCategoryQualityFailureRows:
          args.maxProductReviewCategoryQualityFailureRows,
      },
    });
    console.log(`[katago-product-suite] json: ${report.jsonFileUrl}`);
    console.log(`[katago-product-suite] markdown: ${report.markdownFileUrl}`);
    console.log(
      `[katago-product-suite] passed=${String(report.passed)} expectationMet=${String(
        report.totals.expectationMet
      )}/${String(report.totals.count)} productPassed=${String(report.totals.productPassed)} productFailed=${String(
        report.totals.productFailed
      )} concurrency=${String(report.concurrency)} durationMs=${String(report.durationMs)} executionDurationMs=${String(report.executionDurationMs)} throughputJobsPerMinute=${String(report.throughputJobsPerMinute)} peakUsedDeltaMiB=${String(report.memory.peakUsedDeltaMiB)} minimumFreeMiB=${String(report.memory.minimumFreeMiB)} successfulP50Ms=${String(
        report.stats.successfulDurationMs.p50 ?? "n/a"
      )} successfulP95Ms=${String(report.stats.successfulDurationMs.p95 ?? "n/a")} queueP95Ms=${String(
        report.stats.queueWaitMs.p95 ?? "n/a"
      )} endToEndP95Ms=${String(report.stats.endToEndMs.p95 ?? "n/a")} expectedPassFailureRate=${String(
        report.stats.expectedPass.failureRate ?? "n/a"
      )} gatePassed=${String(report.gate.passed)}`
    );
    for (const check of report.gate.checks) {
      console.log(
        `[katago-product-suite] gate ${check.name} passed=${String(check.passed)} ${check.message}`
      );
    }
    for (const manifest of report.corpusManifests) {
      console.log(
        `[katago-product-suite] corpus=${manifest.id} entries=${String(manifest.entries)} coverage=${manifest.coverage.join(",")} humanApproved=${String(manifest.humanReview.approvedEntries)}/${String(manifest.humanReview.totalEntries)} required=${String(manifest.humanReview.required)}`
      );
    }
    for (const row of report.rows) {
      console.log(
        `[katago-product-suite] ${row.name} expected=${row.expectedToPass ? "pass" : "fail"} met=${String(
          row.expectationMet
        )} productPassed=${String(row.passed)} durationMs=${String(row.durationMs ?? "n/a")} queueWaitMs=${String(row.queueWaitMs)} endToEndMs=${String(row.endToEndMs)} qualityOk=${String(
          row.quality.ok ?? "n/a"
        )} warnings=${String(row.quality.warningCount ?? "n/a")} rootMs=${String(row.phaseDurationsMs.rootAnalysis ?? "n/a")} multiTurnMs=${String(row.phaseDurationsMs.multiTurn ?? "n/a")} corpusPassed=${String(row.corpus?.passed ?? "n/a")}${row.error ? ` error=${row.error}` : ""}`
      );
    }
    if (!report.passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[katago-product-suite] failed: ${msg}`);
    process.exitCode = 1;
  } finally {
    await closeSharedPersistentRootSession();
  }
}
