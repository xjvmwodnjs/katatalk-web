import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sha256HexUtf8, utf8ByteLength } from "../../sgfPayload";
import { readKatagoMaxVisitsFrom, readKatagoTimeoutMsFrom } from "./config";
import {
  buildKatagoSmokeNormalized,
  validateKatagoWorkerV1Document,
} from "./katagoRawParser";
import {
  buildKatagoAnalysisQueryLine,
  parseMinimalSgfForSmoke,
} from "./katagoSgfQuery";
import {
  CUSTOMER_STYLE_KATAGO_PRODUCT_SMOKE_FIXTURES,
  DEFAULT_KATAGO_PRODUCT_SMOKE_FIXTURES,
  EXTENDED_KATAGO_PRODUCT_SMOKE_FIXTURES,
  collectSgfCorpusTargets,
  writeDefaultKatagoProductSmokeFixtures,
} from "../../katagoProductSmokeSuite";
import {
  runKatagoWorkerAnalysisV1,
  summarizeKatagoStderrForDb,
  type SpawnFn,
} from "./katagoSmokeRun";
import {
  PersistentKatagoAnalysisSession,
  type PersistentKatagoQueryResult,
} from "./katagoPersistentSession";

export { PersistentKatagoAnalysisSession };
export type { PersistentKatagoQueryResult };

type PreparedBenchmarkTarget = {
  name: string;
  path: string;
  expectedToPass: boolean;
  sgfContent: string | null;
  sgfSha256: string | null;
  sgfSizeBytes: number | null;
  queryLine: string | null;
  queryId: string | null;
  moves: number | null;
  prepareError: string | null;
};

export type KatagoPersistentBenchmarkArgs = {
  sgfPaths: string[];
  corpusDirs: string[];
  outDir?: string;
  useDefaultFixtures: boolean;
  useExtendedFixtures: boolean;
  useCustomerFixtures: boolean;
  repeat: number;
  persistentOnly: boolean;
  help: boolean;
};

export type KatagoPersistentBenchmarkModeResult = {
  ok: boolean;
  durationMs: number | null;
  error: string | null;
  moveInfosCount: number | null;
  hasWinrate: boolean | null;
  hasScoreLead: boolean | null;
};

export type KatagoPersistentBenchmarkRow = {
  name: string;
  sgfPath: string;
  expectedToPass: boolean;
  expectationMet: boolean;
  moves: number | null;
  prepareError: string | null;
  spawn: KatagoPersistentBenchmarkModeResult | null;
  persistent: KatagoPersistentBenchmarkModeResult | null;
  speedupRatio: number | null;
};

export type KatagoPersistentBenchmarkStats = {
  spawnDurationMs: DurationStats;
  persistentDurationMs: DurationStats;
  persistentWarmDurationMs: DurationStats;
  speedupRatio: DurationStats;
};

export type KatagoPersistentBenchmarkReport = {
  passed: boolean;
  outDir: string;
  jsonPath: string;
  markdownPath: string;
  jsonFileUrl: string;
  markdownFileUrl: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  commandPreview: string;
  totals: {
    count: number;
    expectationMet: number;
    expectationFailed: number;
    persistentPassed: number;
    persistentFailed: number;
    spawnPassed: number | null;
    spawnFailed: number | null;
  };
  stats: KatagoPersistentBenchmarkStats;
  rows: KatagoPersistentBenchmarkRow[];
};

type DurationStats = {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
};

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export function buildDurationStats(values: readonly number[]): DurationStats {
  const sorted = values
    .filter(v => Number.isFinite(v))
    .slice()
    .sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
    mean: sorted.length > 0 ? Math.round(sum / sorted.length) : null,
    p50: percentileNearestRank(sorted, 50),
    p90: percentileNearestRank(sorted, 90),
    p95: percentileNearestRank(sorted, 95),
  };
}

export function parseKatagoPersistentBenchmarkArgs(
  argv: string[]
): KatagoPersistentBenchmarkArgs {
  const parsed: KatagoPersistentBenchmarkArgs = {
    sgfPaths: [],
    corpusDirs: [],
    useDefaultFixtures: false,
    useExtendedFixtures: false,
    useCustomerFixtures: false,
    repeat: 1,
    persistentOnly: false,
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
    if (arg === "--persistent-only") {
      parsed.persistentOnly = true;
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
    if (!arg.startsWith("-")) {
      parsed.sgfPaths.push(arg);
    }
  }

  return parsed;
}

async function collectTargets(opts: {
  cwd: string;
  outDir: string;
  sgfPaths: readonly string[];
  corpusDirs: readonly string[];
  useDefaultFixtures: boolean;
  useExtendedFixtures: boolean;
  useCustomerFixtures: boolean;
}): Promise<{ name: string; path: string; expectedToPass: boolean }[]> {
  const targets: { name: string; path: string; expectedToPass: boolean }[] = [];
  if (opts.useDefaultFixtures) {
    targets.push(
      ...(await writeDefaultKatagoProductSmokeFixtures({
        cwd: opts.cwd,
        outDir: path.join(opts.outDir, "fixtures"),
        fixtures: DEFAULT_KATAGO_PRODUCT_SMOKE_FIXTURES,
      }))
    );
  }
  if (opts.useExtendedFixtures) {
    targets.push(
      ...(await writeDefaultKatagoProductSmokeFixtures({
        cwd: opts.cwd,
        outDir: path.join(opts.outDir, "fixtures"),
        fixtures: EXTENDED_KATAGO_PRODUCT_SMOKE_FIXTURES,
      }))
    );
  }
  if (opts.useCustomerFixtures) {
    targets.push(
      ...(await writeDefaultKatagoProductSmokeFixtures({
        cwd: opts.cwd,
        outDir: path.join(opts.outDir, "fixtures"),
        fixtures: CUSTOMER_STYLE_KATAGO_PRODUCT_SMOKE_FIXTURES,
      }))
    );
  }
  targets.push(
    ...(await collectSgfCorpusTargets({
      cwd: opts.cwd,
      corpusDirs: [...opts.corpusDirs],
    }))
  );
  for (const sgfPath of opts.sgfPaths) {
    const absolute = path.resolve(opts.cwd, sgfPath);
    targets.push({
      name: path.basename(sgfPath),
      path: absolute,
      expectedToPass: true,
    });
  }
  return targets;
}

async function prepareTarget(args: {
  target: { name: string; path: string; expectedToPass: boolean };
  maxVisits: number;
  index: number;
  ts: string;
}): Promise<PreparedBenchmarkTarget> {
  try {
    const sgfContent = await readFile(args.target.path, "utf8");
    const parsed = parseMinimalSgfForSmoke(sgfContent);
    const sgfSha256 = sha256HexUtf8(sgfContent);
    const sgfSizeBytes = utf8ByteLength(sgfContent);
    const queryId = `katatalk-persistent-benchmark-${String(args.index)}-${args.ts}`;
    const queryLine = buildKatagoAnalysisQueryLine({
      boardSize: parsed.boardSize,
      komi: parsed.komi,
      moves: parsed.moves,
      initialStones: parsed.initialStones,
      maxVisits: args.maxVisits,
      id: queryId,
    });
    return {
      name: args.target.name,
      path: args.target.path,
      expectedToPass: args.target.expectedToPass,
      sgfContent,
      sgfSha256,
      sgfSizeBytes,
      queryLine,
      queryId,
      moves: parsed.moves.length,
      prepareError: null,
    };
  } catch (error) {
    return {
      name: args.target.name,
      path: args.target.path,
      expectedToPass: args.target.expectedToPass,
      sgfContent: null,
      sgfSha256: null,
      sgfSizeBytes: null,
      queryLine: null,
      queryId: null,
      moves: null,
      prepareError: errorMessage(error),
    };
  }
}

function validateRawResult(args: {
  rawStdout: string;
  sgfSha256: string;
  sgfSizeBytes: number;
  commandPreview: string;
}): KatagoPersistentBenchmarkModeResult {
  const started = Date.now();
  try {
    const doc = buildKatagoSmokeNormalized({
      sgfSha256: args.sgfSha256,
      sgfSizeBytes: args.sgfSizeBytes,
      rawStdout: args.rawStdout,
      exitCode: 0,
      commandPreview: args.commandPreview,
    });
    validateKatagoWorkerV1Document(doc);
    return {
      ok: true,
      durationMs: Date.now() - started,
      error: null,
      moveInfosCount: doc.katago.moveInfosCount,
      hasWinrate: doc.normalized.hasWinrate,
      hasScoreLead: doc.normalized.hasScoreLead,
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: errorMessage(error),
      moveInfosCount: null,
      hasWinrate: null,
      hasScoreLead: null,
    };
  }
}

async function runSpawnBaseline(args: {
  target: PreparedBenchmarkTarget;
  env: NodeJS.ProcessEnv;
  spawnFn?: SpawnFn;
}): Promise<KatagoPersistentBenchmarkModeResult> {
  if (
    !args.target.sgfContent ||
    !args.target.sgfSha256 ||
    args.target.sgfSizeBytes == null
  ) {
    return {
      ok: false,
      durationMs: null,
      error: args.target.prepareError ?? "KATAGO_BENCHMARK_PREPARE_FAILED",
      moveInfosCount: null,
      hasWinrate: null,
      hasScoreLead: null,
    };
  }
  const started = Date.now();
  try {
    const ran = await runKatagoWorkerAnalysisV1({
      sgfContent: args.target.sgfContent,
      jobId: `persistent-benchmark-spawn-${args.target.name}`,
      env: args.env,
      spawnFn: args.spawnFn,
    });
    if (ran.code !== 0 && ran.code !== null) {
      const tail = summarizeKatagoStderrForDb(ran.stderr);
      throw new Error(
        `KATAGO_EXIT_NONZERO: exit=${String(ran.code)}${tail ? ` ${tail}` : ""}`
      );
    }
    const validated = validateRawResult({
      rawStdout: ran.stdout,
      sgfSha256: args.target.sgfSha256,
      sgfSizeBytes: args.target.sgfSizeBytes,
      commandPreview: ran.commandPreview,
    });
    return { ...validated, durationMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: errorMessage(error),
      moveInfosCount: null,
      hasWinrate: null,
      hasScoreLead: null,
    };
  }
}

async function runPersistent(args: {
  target: PreparedBenchmarkTarget;
  session: PersistentKatagoAnalysisSession;
  timeoutMs: number;
}): Promise<KatagoPersistentBenchmarkModeResult> {
  if (
    !args.target.queryLine ||
    !args.target.queryId ||
    !args.target.sgfSha256 ||
    args.target.sgfSizeBytes == null
  ) {
    return {
      ok: false,
      durationMs: null,
      error: args.target.prepareError ?? "KATAGO_BENCHMARK_PREPARE_FAILED",
      moveInfosCount: null,
      hasWinrate: null,
      hasScoreLead: null,
    };
  }
  try {
    const response = await args.session.analyzeLine({
      queryLine: args.target.queryLine,
      expectedId: args.target.queryId,
      timeoutMs: args.timeoutMs,
    });
    const validated = validateRawResult({
      rawStdout: `${response.rawLine}\n`,
      sgfSha256: args.target.sgfSha256,
      sgfSizeBytes: args.target.sgfSizeBytes,
      commandPreview: args.session.preview,
    });
    return { ...validated, durationMs: response.durationMs };
  } catch (error) {
    const tail = args.session.stderrTail;
    const msg = errorMessage(error);
    return {
      ok: false,
      durationMs: null,
      error:
        tail && !msg.includes(tail.slice(0, 20))
          ? `${msg} stderr: ${tail}`
          : msg,
      moveInfosCount: null,
      hasWinrate: null,
      hasScoreLead: null,
    };
  }
}

function buildStats(
  rows: KatagoPersistentBenchmarkRow[]
): KatagoPersistentBenchmarkStats {
  const spawnDurations = rows
    .filter(row => row.spawn?.ok === true)
    .map(row => row.spawn?.durationMs)
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value) && rowPassed(value)
    );
  const persistentDurations = rows
    .filter(row => row.persistent?.ok === true)
    .map(row => row.persistent?.durationMs)
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value) && rowPassed(value)
    );
  const persistentWarmDurations = persistentDurations.slice(1);
  const speedups = rows
    .map(row => row.speedupRatio)
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value)
    );
  return {
    spawnDurationMs: buildDurationStats(spawnDurations),
    persistentDurationMs: buildDurationStats(persistentDurations),
    persistentWarmDurationMs: buildDurationStats(persistentWarmDurations),
    speedupRatio: buildDurationStats(speedups),
  };
}

function rowPassed(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function markdownEscape(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderKatagoPersistentBenchmarkMarkdown(
  report: Omit<
    KatagoPersistentBenchmarkReport,
    "jsonPath" | "markdownPath" | "jsonFileUrl" | "markdownFileUrl"
  >
): string {
  const lines: string[] = [];
  lines.push("# KataGo Persistent Benchmark");
  lines.push("");
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Finished: ${report.finishedAt}`);
  lines.push(`- Duration ms: ${String(report.durationMs)}`);
  lines.push(`- Passed: ${String(report.passed)}`);
  lines.push(
    `- Expectation met: ${String(report.totals.expectationMet)}/${String(report.totals.count)}`
  );
  lines.push(`- Command: ${report.commandPreview}`);
  lines.push(
    `- Spawn duration ms: count=${String(report.stats.spawnDurationMs.count)} p50=${String(
      report.stats.spawnDurationMs.p50 ?? "n/a"
    )} p95=${String(report.stats.spawnDurationMs.p95 ?? "n/a")}`
  );
  lines.push(
    `- Persistent duration ms: count=${String(report.stats.persistentDurationMs.count)} p50=${String(
      report.stats.persistentDurationMs.p50 ?? "n/a"
    )} p95=${String(report.stats.persistentDurationMs.p95 ?? "n/a")}`
  );
  lines.push(
    `- Persistent warm duration ms: count=${String(report.stats.persistentWarmDurationMs.count)} p50=${String(
      report.stats.persistentWarmDurationMs.p50 ?? "n/a"
    )} p95=${String(report.stats.persistentWarmDurationMs.p95 ?? "n/a")}`
  );
  lines.push(
    `- Speedup ratio: count=${String(report.stats.speedupRatio.count)} p50=${String(
      report.stats.speedupRatio.p50 ?? "n/a"
    )} p95=${String(report.stats.speedupRatio.p95 ?? "n/a")}`
  );
  lines.push("");
  lines.push(
    "| Target | Expected | Met | Moves | Spawn ms | Persistent ms | Speedup | Persistent OK | Error |"
  );
  lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |");
  for (const row of report.rows) {
    const error =
      row.prepareError ?? row.persistent?.error ?? row.spawn?.error ?? "";
    lines.push(
      [
        markdownEscape(row.name),
        row.expectedToPass ? "pass" : "fail",
        String(row.expectationMet),
        String(row.moves ?? "n/a"),
        String(row.spawn?.durationMs ?? "n/a"),
        String(row.persistent?.durationMs ?? "n/a"),
        row.speedupRatio == null ? "n/a" : row.speedupRatio.toFixed(2),
        String(row.persistent?.ok ?? "n/a"),
        markdownEscape(error),
      ]
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |")
    );
  }
  lines.push("");
  lines.push(
    "This benchmark validates root KataGo analysis latency only; it does not replace full product quality suites."
  );
  return `${lines.join("\n")}\n`;
}

export async function runKatagoPersistentBenchmark(opts: {
  sgfPaths: string[];
  corpusDirs?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  outDir?: string;
  useDefaultFixtures?: boolean;
  useExtendedFixtures?: boolean;
  useCustomerFixtures?: boolean;
  repeat?: number;
  persistentOnly?: boolean;
  spawnFn?: SpawnFn;
}): Promise<KatagoPersistentBenchmarkReport> {
  const env = opts.env != null ? { ...process.env, ...opts.env } : process.env;
  const cwd = opts.cwd ?? process.cwd();
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const ts = timestampForFilename();
  const outDir = path.resolve(
    cwd,
    opts.outDir ?? path.join(".tmp", "katago-persistent-benchmark", ts)
  );
  await mkdir(outDir, { recursive: true });

  const targets = await collectTargets({
    cwd,
    outDir,
    sgfPaths: opts.sgfPaths,
    corpusDirs: opts.corpusDirs ?? [],
    useDefaultFixtures: opts.useDefaultFixtures === true,
    useExtendedFixtures: opts.useExtendedFixtures === true,
    useCustomerFixtures: opts.useCustomerFixtures === true,
  });
  if (targets.length === 0) {
    throw new Error(
      "KATAGO_PERSISTENT_BENCHMARK_NO_TARGETS: pass SGF paths, --corpus-dir, --default-fixtures, --extended-fixtures, or --customer-fixtures."
    );
  }

  const repeat = Math.min(20, Math.max(1, Math.trunc(opts.repeat ?? 1)));
  const repeatedTargets =
    repeat === 1
      ? targets
      : targets.flatMap(target =>
          Array.from({ length: repeat }, (_, i) => ({
            ...target,
            name: `${target.name}#${String(i + 1)}`,
          }))
        );
  const maxVisits = readKatagoMaxVisitsFrom(env);
  const timeoutMs = readKatagoTimeoutMsFrom(env);
  const prepared: PreparedBenchmarkTarget[] = [];
  for (let i = 0; i < repeatedTargets.length; i++) {
    prepared.push(
      await prepareTarget({
        target: repeatedTargets[i]!,
        maxVisits,
        index: i + 1,
        ts,
      })
    );
  }

  const session = new PersistentKatagoAnalysisSession({
    env,
    spawnFn: opts.spawnFn,
  });
  const rows: KatagoPersistentBenchmarkRow[] = [];
  try {
    for (const target of prepared) {
      const spawnResult =
        opts.persistentOnly === true
          ? null
          : await runSpawnBaseline({
              target,
              env,
              spawnFn: opts.spawnFn,
            });
      const persistentResult = await runPersistent({
        target,
        session,
        timeoutMs,
      });
      const expectedPassOk =
        persistentResult.ok && (spawnResult == null || spawnResult.ok);
      const expectedFailOk =
        !persistentResult.ok && (spawnResult == null || !spawnResult.ok);
      const expectationMet = target.expectedToPass
        ? expectedPassOk
        : expectedFailOk;
      const speedupRatio =
        spawnResult?.durationMs != null &&
        persistentResult.durationMs != null &&
        persistentResult.durationMs > 0
          ? spawnResult.durationMs / persistentResult.durationMs
          : null;
      rows.push({
        name: target.name,
        sgfPath: target.path,
        expectedToPass: target.expectedToPass,
        expectationMet,
        moves: target.moves,
        prepareError: target.prepareError,
        spawn: spawnResult,
        persistent: persistentResult,
        speedupRatio,
      });
    }
  } finally {
    await session.close();
  }

  const stats = buildStats(rows);
  const finishedAt = new Date().toISOString();
  const totals = {
    count: rows.length,
    expectationMet: rows.filter(row => row.expectationMet).length,
    expectationFailed: rows.filter(row => !row.expectationMet).length,
    persistentPassed: rows.filter(row => row.persistent?.ok === true).length,
    persistentFailed: rows.filter(row => row.persistent?.ok === false).length,
    spawnPassed:
      opts.persistentOnly === true
        ? null
        : rows.filter(row => row.spawn?.ok === true).length,
    spawnFailed:
      opts.persistentOnly === true
        ? null
        : rows.filter(row => row.spawn?.ok === false).length,
  };
  const reportBase = {
    passed: totals.expectationFailed === 0,
    outDir,
    startedAt,
    finishedAt,
    durationMs: Date.now() - started,
    commandPreview: session.preview,
    totals,
    stats,
    rows,
  };
  const jsonPath = path.join(outDir, `persistent-benchmark-${ts}.json`);
  const markdownPath = path.join(outDir, `persistent-benchmark-${ts}.md`);
  const report: KatagoPersistentBenchmarkReport = {
    ...reportBase,
    jsonPath,
    markdownPath,
    jsonFileUrl: pathToFileURL(jsonPath).href,
    markdownFileUrl: pathToFileURL(markdownPath).href,
  };
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(
    markdownPath,
    renderKatagoPersistentBenchmarkMarkdown(reportBase),
    "utf8"
  );
  return report;
}

export function katagoPersistentBenchmarkUsage(): string {
  return [
    "Usage: corepack pnpm katago:persistent-benchmark -- [options] <game1.sgf> <game2.sgf> ...",
    "",
    "Options:",
    "  --default-fixtures      Generate and run built-in ignored synthetic fixtures.",
    "  --extended-fixtures     Generate and run longer synthetic representative fixtures.",
    "  --customer-fixtures     Generate and run broader synthetic customer-style fixtures.",
    "  --corpus-dir <dir>      Recursively run all .sgf files from an ignored private corpus directory.",
    "  --repeat <n>            Repeat each target n times. Default: 1, max: 20.",
    "  --persistent-only       Skip spawn-per-analysis baseline and run persistent mode only.",
    "  --out-dir <dir>         Output directory. Default: .tmp/katago-persistent-benchmark/<timestamp>",
  ].join("\n");
}

export async function runKatagoPersistentBenchmarkCliMain(
  argv: string[]
): Promise<void> {
  const args = parseKatagoPersistentBenchmarkArgs(argv);
  if (args.help) {
    console.log(katagoPersistentBenchmarkUsage());
    return;
  }

  try {
    const report = await runKatagoPersistentBenchmark({
      sgfPaths: args.sgfPaths,
      corpusDirs: args.corpusDirs,
      outDir: args.outDir,
      useDefaultFixtures: args.useDefaultFixtures,
      useExtendedFixtures: args.useExtendedFixtures,
      useCustomerFixtures: args.useCustomerFixtures,
      repeat: args.repeat,
      persistentOnly: args.persistentOnly,
    });
    console.log(`[katago-persistent-benchmark] json: ${report.jsonFileUrl}`);
    console.log(
      `[katago-persistent-benchmark] markdown: ${report.markdownFileUrl}`
    );
    console.log(
      `[katago-persistent-benchmark] passed=${String(report.passed)} expectationMet=${String(
        report.totals.expectationMet
      )}/${String(report.totals.count)} spawnP95Ms=${String(
        report.stats.spawnDurationMs.p95 ?? "n/a"
      )} persistentP95Ms=${String(report.stats.persistentDurationMs.p95 ?? "n/a")} speedupP50=${String(
        report.stats.speedupRatio.p50 ?? "n/a"
      )} persistentWarmP95Ms=${String(report.stats.persistentWarmDurationMs.p95 ?? "n/a")}`
    );
    for (const row of report.rows) {
      console.log(
        `[katago-persistent-benchmark] ${row.name} met=${String(row.expectationMet)} spawnMs=${String(
          row.spawn?.durationMs ?? "n/a"
        )} persistentMs=${String(row.persistent?.durationMs ?? "n/a")} speedup=${
          row.speedupRatio == null ? "n/a" : row.speedupRatio.toFixed(2)
        } persistentOk=${String(row.persistent?.ok ?? "n/a")}${row.persistent?.error ? ` error=${row.persistent.error}` : ""}`
      );
    }
    if (!report.passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[katago-persistent-benchmark] failed: ${msg}`);
    process.exitCode = 1;
  }
}
