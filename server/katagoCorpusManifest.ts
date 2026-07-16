import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { MAX_SGF_FILE_BYTES } from "@shared/const";
import { parseSgfForKatagoV1 } from "@shared/sgfKatagoParseV1";
import { z } from "zod";

export const KATAGO_CORPUS_COVERAGE_TAGS = [
  "board-9",
  "board-13",
  "board-19",
  "handicap",
  "pass",
  "setup-stones",
  "long-game",
] as const;

export type KatagoCorpusCoverageTag =
  (typeof KATAGO_CORPUS_COVERAGE_TAGS)[number];

const coverageTagSchema = z.enum(KATAGO_CORPUS_COVERAGE_TAGS);
const scoreSchema = z.number().int().min(1).max(5);

const reviewSchema = z
  .object({
    reviewerId: z
      .string()
      .min(2)
      .max(80)
      .regex(/^[A-Za-z0-9_-]+$/),
    reviewedAt: z.string().min(1),
    verdict: z.enum(["approved", "rejected"]),
    scores: z
      .object({
        criticalMomentAccuracy: scoreSchema,
        candidateUsefulness: scoreSchema,
        educationalUsefulness: scoreSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((review, context) => {
    if (
      review.verdict === "approved" &&
      Object.values(review.scores).some(score => score < 3)
    ) {
      context.addIssue({
        code: "custom",
        path: ["scores"],
        message: "approved reviews require every score to be at least 3",
      });
    }
  });

const expectedSchema = z
  .object({
    productPass: z.literal(true),
    boardSize: z.union([z.literal(9), z.literal(13), z.literal(19)]),
    minMoves: z.number().int().min(1),
    maxMoves: z.number().int().min(1),
    minVisits: z.number().int().min(1),
    minTurnsOk: z.number().int().min(1),
    maxTurnsFailed: z.literal(0),
    minBsiSignals: z.number().int().min(1),
    minAdiSignals: z.number().int().min(1),
    criticalTurns: z.array(z.number().int().min(1)).min(1).max(12),
    minCriticalTurnMatches: z.number().int().min(1),
    maxQualityWarnings: z.literal(0),
    maxQualityFailures: z.literal(0),
  })
  .strict()
  .superRefine((expected, context) => {
    if (expected.maxMoves < expected.minMoves) {
      context.addIssue({
        code: "custom",
        path: ["maxMoves"],
        message: "maxMoves must be greater than or equal to minMoves",
      });
    }
    if (expected.minCriticalTurnMatches > new Set(expected.criticalTurns).size) {
      context.addIssue({
        code: "custom",
        path: ["minCriticalTurnMatches"],
        message: "minCriticalTurnMatches cannot exceed distinct criticalTurns",
      });
    }
    if (new Set(expected.criticalTurns).size !== expected.criticalTurns.length) {
      context.addIssue({
        code: "custom",
        path: ["criticalTurns"],
        message: "criticalTurns must not contain duplicates",
      });
    }
  });

const entrySchema = z
  .object({
    id: z
      .string()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9._-]*$/),
    sgf: z.string().min(5).max(500),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    provenance: z.enum(["customer-consented", "licensed-public", "internal"]),
    anonymized: z.literal(true),
    expected: expectedSchema,
    reviews: z.array(reviewSchema).optional(),
  })
  .strict();

const manifestSchema = z
  .object({
    version: z.literal(1),
    id: z
      .string()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9._-]*$/),
    minimumEntries: z.number().int().min(10),
    requiredCoverage: z.array(coverageTagSchema).min(1),
    entries: z.array(entrySchema).min(1),
  })
  .strict();

export type KatagoCorpusExpectedV1 = z.infer<typeof expectedSchema>;
export type KatagoCorpusReviewV1 = z.infer<typeof reviewSchema>;
export type KatagoCorpusManifestV1 = z.infer<typeof manifestSchema>;

export type KatagoCorpusExpectationCheck = {
  name: string;
  passed: boolean;
  actual: number | null;
  threshold: number;
  comparator: ">=" | "<=";
  message: string;
};

export type KatagoCorpusTarget = {
  name: string;
  path: string;
  expectedToPass: true;
  corpus: {
    manifestId: string;
    entryId: string;
    coverage: KatagoCorpusCoverageTag[];
    expected: KatagoCorpusExpectedV1;
    approvedReviewers: number;
  };
};

export type LoadedKatagoCorpusManifest = {
  id: string;
  manifestPath: string;
  entries: KatagoCorpusTarget[];
  coverage: KatagoCorpusCoverageTag[];
  humanReview: {
    required: boolean;
    approvedEntries: number;
    totalEntries: number;
  };
};

const SENSITIVE_SGF_PROPERTIES = new Set([
  "AN",
  "BR",
  "BT",
  "CP",
  "DT",
  "EV",
  "GN",
  "ON",
  "PB",
  "PC",
  "PW",
  "RO",
  "SO",
  "US",
  "WR",
  "WT",
]);

function manifestError(message: string): Error {
  return new Error(`KATAGO_CORPUS_MANIFEST_INVALID: ${message}`);
}

function parseManifestJson(
  text: string,
  manifestPath: string
): KatagoCorpusManifestV1 {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw manifestError(`${manifestPath}: invalid JSON: ${detail}`);
  }
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(issue => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw manifestError(`${manifestPath}: ${detail}`);
  }
  return parsed.data;
}

function collectSgfPropertyIds(sgf: string): Set<string> {
  const ids = new Set<string>();
  let inValue = false;
  let escaped = false;
  for (let i = 0; i < sgf.length; i += 1) {
    const ch = sgf[i]!;
    if (inValue) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "]") {
        inValue = false;
      }
      continue;
    }
    if (ch === "[") {
      inValue = true;
      continue;
    }
    if (!/[A-Za-z]/.test(ch)) {
      continue;
    }
    const start = i;
    while (i + 1 < sgf.length && /[A-Za-z]/.test(sgf[i + 1]!)) {
      i += 1;
    }
    let next = i + 1;
    while (next < sgf.length && /\s/.test(sgf[next]!)) {
      next += 1;
    }
    if (sgf[next] === "[") {
      ids.add(sgf.slice(start, i + 1).toUpperCase());
    }
  }
  return ids;
}

function deriveCoverage(sgf: string): {
  tags: KatagoCorpusCoverageTag[];
  boardSize: number;
  moves: number;
} {
  const parsed = parseSgfForKatagoV1(sgf);
  const tags = new Set<KatagoCorpusCoverageTag>();
  if (parsed.boardSize === 9) tags.add("board-9");
  if (parsed.boardSize === 13) tags.add("board-13");
  if (parsed.boardSize === 19) tags.add("board-19");
  if (
    parsed.initialStones.length >= 2 ||
    parsed.parseWarnings.some(
      warning => warning.code === "handicap_property_present"
    )
  ) {
    tags.add("handicap");
  }
  if (parsed.initialStones.length > 0) {
    tags.add("setup-stones");
  }
  if (
    parsed.moves.some(
      move =>
        move.sgfPoint === "" ||
        move.sgfPoint === "pass" ||
        (move.sgfPoint.toLowerCase() === "tt" && parsed.boardSize <= 19)
    )
  ) {
    tags.add("pass");
  }
  if (parsed.moves.length >= 100) {
    tags.add("long-game");
  }
  return {
    tags: KATAGO_CORPUS_COVERAGE_TAGS.filter(tag => tags.has(tag)),
    boardSize: parsed.boardSize,
    moves: parsed.moves.length,
  };
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

function approvedReviewerCount(
  reviews: KatagoCorpusReviewV1[] | undefined
): number {
  return new Set(
    (reviews ?? [])
      .filter(review => review.verdict === "approved")
      .map(review => review.reviewerId)
  ).size;
}

function validateReviewDates(
  reviews: KatagoCorpusReviewV1[] | undefined,
  entryId: string
): void {
  const reviewerIds = new Set<string>();
  for (const review of reviews ?? []) {
    if (reviewerIds.has(review.reviewerId)) {
      throw manifestError(
        `${entryId}: duplicate reviewerId ${review.reviewerId}`
      );
    }
    reviewerIds.add(review.reviewerId);
    if (!Number.isFinite(Date.parse(review.reviewedAt))) {
      throw manifestError(
        `${entryId}: reviewer ${review.reviewerId} has invalid reviewedAt`
      );
    }
  }
}

export async function loadKatagoCorpusManifest(opts: {
  manifestPath: string;
  cwd?: string;
  requireHumanReview?: boolean;
}): Promise<LoadedKatagoCorpusManifest> {
  const cwd = opts.cwd ?? process.cwd();
  const manifestPath = path.resolve(cwd, opts.manifestPath);
  const manifest = parseManifestJson(
    await readFile(manifestPath, "utf8"),
    manifestPath
  );
  const requiredCoverage = new Set(manifest.requiredCoverage);
  for (const required of KATAGO_CORPUS_COVERAGE_TAGS) {
    if (!requiredCoverage.has(required)) {
      throw manifestError(
        `${manifest.id}: requiredCoverage must include ${required}`
      );
    }
  }
  if (manifest.entries.length < manifest.minimumEntries) {
    throw manifestError(
      `${manifest.id}: entries=${String(manifest.entries.length)} minimumEntries=${String(manifest.minimumEntries)}`
    );
  }

  const manifestRoot = await realpath(path.dirname(manifestPath));
  const ids = new Set<string>();
  const paths = new Set<string>();
  const hashes = new Set<string>();
  const coverage = new Set<KatagoCorpusCoverageTag>();
  const entries: KatagoCorpusTarget[] = [];
  let approvedEntries = 0;

  for (const entry of manifest.entries) {
    if (ids.has(entry.id)) {
      throw manifestError(`${manifest.id}: duplicate entry id ${entry.id}`);
    }
    ids.add(entry.id);
    if (path.isAbsolute(entry.sgf)) {
      throw manifestError(
        `${entry.id}: sgf path must be relative to the manifest`
      );
    }
    const requestedPath = path.resolve(manifestRoot, entry.sgf);
    const sgfPath = await realpath(requestedPath);
    if (!isWithinRoot(manifestRoot, sgfPath)) {
      throw manifestError(
        `${entry.id}: sgf path escapes the manifest directory`
      );
    }
    const normalizedPath = sgfPath.toLowerCase();
    if (paths.has(normalizedPath)) {
      throw manifestError(`${entry.id}: duplicate SGF path ${entry.sgf}`);
    }
    paths.add(normalizedPath);

    const fileStat = await stat(sgfPath);
    if (!fileStat.isFile()) {
      throw manifestError(`${entry.id}: SGF target is not a file`);
    }
    if (fileStat.size <= 0 || fileStat.size > MAX_SGF_FILE_BYTES) {
      throw manifestError(
        `${entry.id}: SGF size must be 1..${String(MAX_SGF_FILE_BYTES)} bytes`
      );
    }
    const bytes = await readFile(sgfPath);
    const sgf = bytes.toString("utf8");
    if (sgf.includes("\uFFFD")) {
      throw manifestError(`${entry.id}: SGF must be valid UTF-8`);
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== entry.sha256) {
      throw manifestError(
        `${entry.id}: sha256 mismatch expected=${entry.sha256} actual=${sha256}`
      );
    }
    if (hashes.has(sha256)) {
      throw manifestError(
        `${entry.id}: duplicate SGF content sha256=${sha256}`
      );
    }
    hashes.add(sha256);

    const sensitiveProperties = Array.from(collectSgfPropertyIds(sgf))
      .filter(property => SENSITIVE_SGF_PROPERTIES.has(property))
      .sort();
    if (sensitiveProperties.length > 0) {
      throw manifestError(
        `${entry.id}: anonymization failed; remove SGF properties ${sensitiveProperties.join(",")}`
      );
    }

    const derived = deriveCoverage(sgf);
    if (derived.boardSize !== entry.expected.boardSize) {
      throw manifestError(
        `${entry.id}: board size ${String(derived.boardSize)} does not match expected ${String(entry.expected.boardSize)}`
      );
    }
    if (
      derived.moves < entry.expected.minMoves ||
      derived.moves > entry.expected.maxMoves
    ) {
      throw manifestError(
        `${entry.id}: moves ${String(derived.moves)} outside expected ${String(entry.expected.minMoves)}..${String(entry.expected.maxMoves)}`
      );
    }
    for (const tag of derived.tags) coverage.add(tag);

    validateReviewDates(entry.reviews, entry.id);
    const approvedReviewers = approvedReviewerCount(entry.reviews);
    const rejected = (entry.reviews ?? []).some(
      review => review.verdict === "rejected"
    );
    if (approvedReviewers >= 2 && !rejected) {
      approvedEntries += 1;
    }
    if (
      opts.requireHumanReview === true &&
      (approvedReviewers < 2 || rejected)
    ) {
      throw manifestError(
        `${entry.id}: two distinct approved human reviews and no rejection are required`
      );
    }

    entries.push({
      name: `${manifest.id}/${entry.id}`,
      path: sgfPath,
      expectedToPass: true,
      corpus: {
        manifestId: manifest.id,
        entryId: entry.id,
        coverage: derived.tags,
        expected: entry.expected,
        approvedReviewers,
      },
    });
  }

  for (const required of KATAGO_CORPUS_COVERAGE_TAGS) {
    if (!coverage.has(required)) {
      throw manifestError(
        `${manifest.id}: corpus does not provide derived coverage ${required}`
      );
    }
  }

  return {
    id: manifest.id,
    manifestPath,
    entries,
    coverage: KATAGO_CORPUS_COVERAGE_TAGS.filter(tag => coverage.has(tag)),
    humanReview: {
      required: opts.requireHumanReview === true,
      approvedEntries,
      totalEntries: entries.length,
    },
  };
}

function numericCheck(args: {
  name: string;
  actual: number | null;
  threshold: number;
  comparator: ">=" | "<=";
}): KatagoCorpusExpectationCheck {
  const passed =
    args.actual != null &&
    (args.comparator === ">="
      ? args.actual >= args.threshold
      : args.actual <= args.threshold);
  return {
    ...args,
    passed,
    message: `${args.name}: actual=${String(args.actual ?? "n/a")} expected${args.comparator}${String(args.threshold)}`,
  };
}

export function evaluateKatagoCorpusExpectations(args: {
  expected: KatagoCorpusExpectedV1;
  actual: {
    visits: number | null;
    turnsOk: number | null;
    turnsFailed: number | null;
    bsiSignals: number | null;
    adiSignals: number | null;
    bsiSignalTurns: number[] | null;
    adiSignalTurns: number[] | null;
    qualityWarnings: number | null;
    qualityFailures: number | null;
  };
}): { passed: boolean; checks: KatagoCorpusExpectationCheck[] } {
  const bsiTurns = new Set(args.actual.bsiSignalTurns ?? []);
  const adiTurns = new Set(args.actual.adiSignalTurns ?? []);
  const criticalTurnMatches = new Set(args.expected.criticalTurns).size === 0
    ? null
    : Array.from(new Set(args.expected.criticalTurns)).filter(
        turnIndex => bsiTurns.has(turnIndex) && adiTurns.has(turnIndex)
      ).length;
  const checks = [
    numericCheck({
      name: "min_visits",
      actual: args.actual.visits,
      threshold: args.expected.minVisits,
      comparator: ">=",
    }),
    numericCheck({
      name: "min_turns_ok",
      actual: args.actual.turnsOk,
      threshold: args.expected.minTurnsOk,
      comparator: ">=",
    }),
    numericCheck({
      name: "max_turns_failed",
      actual: args.actual.turnsFailed,
      threshold: args.expected.maxTurnsFailed,
      comparator: "<=",
    }),
    numericCheck({
      name: "min_bsi_signals",
      actual: args.actual.bsiSignals,
      threshold: args.expected.minBsiSignals,
      comparator: ">=",
    }),
    numericCheck({
      name: "min_adi_signals",
      actual: args.actual.adiSignals,
      threshold: args.expected.minAdiSignals,
      comparator: ">=",
    }),
    numericCheck({
      name: "min_critical_turn_matches",
      actual: criticalTurnMatches,
      threshold: args.expected.minCriticalTurnMatches,
      comparator: ">=",
    }),
    numericCheck({
      name: "max_quality_warnings",
      actual: args.actual.qualityWarnings,
      threshold: args.expected.maxQualityWarnings,
      comparator: "<=",
    }),
    numericCheck({
      name: "max_quality_failures",
      actual: args.actual.qualityFailures,
      threshold: args.expected.maxQualityFailures,
      comparator: "<=",
    }),
  ];
  return {
    passed: checks.every(check => check.passed),
    checks,
  };
}

export type KatagoCorpusValidateArgs = {
  manifestPaths: string[];
  requireHumanReview: boolean;
  help: boolean;
};

export function parseKatagoCorpusValidateArgs(
  argv: string[]
): KatagoCorpusValidateArgs {
  const parsed: KatagoCorpusValidateArgs = {
    manifestPaths: [],
    requireHumanReview: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--" || arg === "") continue;
    if (arg === "-h" || arg === "--help") {
      parsed.help = true;
      continue;
    }
    if (arg === "--require-human-review") {
      parsed.requireHumanReview = true;
      continue;
    }
    if (arg === "--manifest" || arg.startsWith("--manifest=")) {
      const value = arg.startsWith("--manifest=")
        ? arg.slice("--manifest=".length)
        : argv[index + 1];
      if (value && !value.startsWith("-")) {
        parsed.manifestPaths.push(value);
        if (arg === "--manifest") index += 1;
      }
      continue;
    }
    if (!arg.startsWith("-")) {
      parsed.manifestPaths.push(arg);
    }
  }
  return parsed;
}

export function katagoCorpusValidateUsage(): string {
  return [
    "Usage: corepack pnpm katago:corpus-validate -- <manifest.json> [options]",
    "",
    "Options:",
    "  --manifest <file>       Validate a corpus manifest. Repeatable.",
    "  --require-human-review  Require two approvals per entry and no rejection.",
  ].join("\n");
}

export async function runKatagoCorpusValidateCliMain(
  argv: string[]
): Promise<void> {
  const args = parseKatagoCorpusValidateArgs(argv);
  if (args.help) {
    console.log(katagoCorpusValidateUsage());
    return;
  }
  if (args.manifestPaths.length === 0) {
    console.error("[katago-corpus] failed: pass at least one manifest path");
    process.exitCode = 1;
    return;
  }
  try {
    for (const manifestPath of args.manifestPaths) {
      const manifest = await loadKatagoCorpusManifest({
        manifestPath,
        requireHumanReview: args.requireHumanReview,
      });
      console.log(
        `[katago-corpus] valid id=${manifest.id} entries=${String(manifest.entries.length)} coverage=${manifest.coverage.join(",")} humanApproved=${String(manifest.humanReview.approvedEntries)}/${String(manifest.humanReview.totalEntries)} required=${String(manifest.humanReview.required)}`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[katago-corpus] failed: ${message}`);
    process.exitCode = 1;
  }
}
