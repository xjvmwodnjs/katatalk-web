/**
 * KataGo analysis query용 SGF mainline 파싱 — `sgfPlaybackV1.extractMainlineBwMoves` 와 동일 경로.
 */

import {
  extractMainlineBwMoves,
  readSgfBracketValue,
  sgfLetterToCoordIndex,
  sgfPointToGtp,
  skipSgfVariationTreeV1,
  type ExtractMainlineBwMovesResultV1,
  type ParsedMainlineMoveV1,
  type ParsedSetupStoneV1,
  type SgfPlaybackWarningV1,
} from "./sgfPlaybackV1";
import {
  parseSgfRootGameMetadataV1,
  type ParsedSgfGameMetadataV1,
} from "./sgfGameMetadataV1";

export type ParsedMinimalSgfV1 = {
  boardSize: number;
  boardSizeSource: SgfBoardSizeSourceV1;
  komi: number;
  komiSource: SgfKomiSourceV1;
  rules: SupportedKatagoRulesV1;
  initialPlayer: "B" | "W";
  initialPlayerSource: SgfInitialPlayerSourceV1;
  handicapStones: number | null;
  moves: { color: "B" | "W"; sgfPoint: string }[];
  initialStones: { color: "B" | "W"; sgfPoint: string }[];
  gameMetadata: ParsedSgfGameMetadataV1;
  parseWarnings: SgfPlaybackWarningV1[];
};

export type SupportedKatagoRulesV1 = "japanese";

export type SgfBoardSizeSourceV1 = "root_sz" | "sgf_default_missing";
export type SgfKomiSourceV1 = "root_km" | "product_default_missing";

export type SgfInitialPlayerSourceV1 =
  | "setup_pl"
  | "first_move"
  | "handicap_default_white"
  | "standard_default_black";

export type SgfKatagoParseErrorCodeV1 =
  | "SGF_PARSE_FAILED"
  | "SGF_UNSUPPORTED_SETUP_STONES"
  | "SGF_UNSUPPORTED_GAME_TYPE"
  | "SGF_UNSUPPORTED_RULES"
  | "SGF_INVALID_BOARD_SIZE"
  | "SGF_UNSUPPORTED_BOARD_SIZE"
  | "SGF_INVALID_KOMI"
  | "SGF_UNSUPPORTED_KOMI"
  | "SGF_INVALID_PLAYER_TO_PLAY"
  | "SGF_PLAYER_TO_PLAY_CONFLICT"
  | "SGF_UNSUPPORTED_PLAYER_TO_PLAY"
  | "SGF_INVALID_HANDICAP"
  | "SGF_HANDICAP_SETUP_MISMATCH"
  | "SGF_INVALID_COORDINATE"
  | "KATAGO_QUERY_BUILD_FAILED";

export class SgfKatagoParseError extends Error {
  readonly code: SgfKatagoParseErrorCodeV1;

  constructor(code: SgfKatagoParseErrorCodeV1, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "SgfKatagoParseError";
    this.code = code;
  }
}

type MainlinePropertyOccurrenceV1 = {
  nodeIndex: number;
  values: string[];
};

type MainlinePropertyScanV1 = {
  malformed: boolean;
  occurrences: MainlinePropertyOccurrenceV1[];
};

/** Reads actual properties on the selected mainline while ignoring values and variations. */
function scanMainlinePropertyV1(
  sgf: string,
  propId: string
): MainlinePropertyScanV1 {
  const s = sgf.replace(/\r\n|\r|\n/g, " ");
  const rootIdx = s.indexOf("(;");
  if (rootIdx < 0) {
    return { malformed: false, occurrences: [] };
  }

  const target = propId.toUpperCase();
  let i = rootIdx + 2;
  let nodeIndex = 0;
  const occurrences: MainlinePropertyOccurrenceV1[] = [];

  while (i < s.length) {
    const ch = s[i]!;
    if (ch === ")") {
      break;
    }
    if (ch === "(") {
      i = skipSgfVariationTreeV1(s, i).end;
      continue;
    }
    if (ch === ";") {
      nodeIndex += 1;
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (!/[A-Za-z]/.test(ch)) {
      i += 1;
      continue;
    }
    const idStart = i;
    while (i < s.length && /[A-Za-z]/.test(s[i]!)) {
      i += 1;
    }
    const currentId = s.slice(idStart, i).toUpperCase();
    if (i >= s.length || s[i] !== "[") {
      if (currentId === target) {
        return { malformed: true, occurrences };
      }
      continue;
    }

    const values: string[] = [];
    while (i < s.length) {
      while (i < s.length && /\s/.test(s[i]!)) {
        i += 1;
      }
      if (i >= s.length || s[i] !== "[") {
        break;
      }
      const bracket = readSgfBracketValue(s, i);
      if (bracket == null) {
        return {
          malformed: currentId === target,
          occurrences,
        };
      }
      values.push(bracket.text);
      i = bracket.end;
    }
    if (currentId === target) {
      occurrences.push({ nodeIndex, values });
    }
  }
  return { malformed: false, occurrences };
}

const JAPANESE_RULE_ALIASES_V1 = new Set([
  "japanese",
  "japanese rules",
  "japan",
  "japan rules",
  "日本",
  "日本式",
  "日本ルール",
]);

function normalizeRulesLabelV1(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Reads every value of a property in the first/root node only. */
function readRootPropertyValuesV1(sgf: string, propId: string): string[] {
  const s = sgf.replace(/\r\n|\r|\n/g, " ");
  const rootIdx = s.indexOf("(;");
  if (rootIdx < 0) {
    return [];
  }

  const target = propId.toUpperCase();
  const found: string[] = [];
  let i = rootIdx + 2;

  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) {
      i += 1;
    }
    if (i >= s.length || s[i] === ";" || s[i] === "(" || s[i] === ")") {
      break;
    }
    if (!/[A-Za-z]/.test(s[i]!)) {
      i += 1;
      continue;
    }

    const idStart = i;
    while (i < s.length && /[A-Za-z]/.test(s[i]!)) {
      i += 1;
    }
    const currentId = s.slice(idStart, i).toUpperCase();
    while (i < s.length && /\s/.test(s[i]!)) {
      i += 1;
    }
    if (i >= s.length || s[i] !== "[") {
      continue;
    }

    while (i < s.length) {
      while (i < s.length && /\s/.test(s[i]!)) {
        i += 1;
      }
      if (i >= s.length || s[i] !== "[") {
        break;
      }
      const bracket = readSgfBracketValue(s, i);
      if (bracket == null) {
        if (currentId === target) {
          throw new SgfKatagoParseError(
            "SGF_PARSE_FAILED",
            "root RU property is not closed"
          );
        }
        return found;
      }
      if (currentId === target) {
        found.push(bracket.text);
      }
      i = bracket.end;
    }
  }

  return found;
}

/** Resolves the only ruleset supported by the current product analysis contract. */
export function parseSupportedKatagoRulesFromRootV1(
  sgf: string
): SupportedKatagoRulesV1 {
  const rawValues = readRootPropertyValuesV1(sgf, "RU");
  for (const rawValue of rawValues) {
    const normalized = normalizeRulesLabelV1(rawValue);
    if (normalized.length === 0) {
      continue;
    }
    if (!JAPANESE_RULE_ALIASES_V1.has(normalized)) {
      throw new SgfKatagoParseError(
        "SGF_UNSUPPORTED_RULES",
        "only Japanese rules are supported"
      );
    }
  }
  return "japanese";
}

export type SgfInitialTurnContractV1 = {
  initialPlayer: "B" | "W";
  initialPlayerSource: SgfInitialPlayerSourceV1;
  handicapStones: number | null;
};

/**
 * Resolves the initial side-to-move contract shared by upload admission,
 * KataGo queries, and SGF playback. PL is accepted only before the first move.
 */
export function resolveSgfInitialTurnContractV1(
  extracted: ExtractMainlineBwMovesResultV1
): SgfInitialTurnContractV1 {
  const issues = new Set(extracted.initialPositionIssueCodes);
  if (
    issues.has("invalid_player_to_play") ||
    issues.has("player_to_play_with_move")
  ) {
    throw new SgfKatagoParseError(
      "SGF_INVALID_PLAYER_TO_PLAY",
      "PL must contain exactly B or W in a setup node before the first move"
    );
  }
  if (issues.has("player_to_play_after_move_unsupported")) {
    throw new SgfKatagoParseError(
      "SGF_UNSUPPORTED_PLAYER_TO_PLAY",
      "PL after the first move is not supported"
    );
  }
  if (issues.has("invalid_handicap") || issues.has("duplicate_handicap")) {
    throw new SgfKatagoParseError(
      "SGF_INVALID_HANDICAP",
      "HA must contain one integer that is 0 or at least 2"
    );
  }

  const firstMovePlayer = extracted.moves[0]?.color ?? null;
  if (
    extracted.initialPlayerHint != null &&
    firstMovePlayer != null &&
    extracted.initialPlayerHint !== firstMovePlayer
  ) {
    throw new SgfKatagoParseError(
      "SGF_PLAYER_TO_PLAY_CONFLICT",
      "PL conflicts with the first move color"
    );
  }

  const handicapStones =
    extracted.handicapHint != null && extracted.handicapHint >= 2
      ? extracted.handicapHint
      : null;
  if (handicapStones != null) {
    const blackSetupStoneCount = extracted.initialStones.filter(
      stone => stone.color === "B"
    ).length;
    if (blackSetupStoneCount !== handicapStones) {
      throw new SgfKatagoParseError(
        "SGF_HANDICAP_SETUP_MISMATCH",
        "HA does not match the effective initial black setup stones"
      );
    }
  }

  if (extracted.initialPlayerHint != null) {
    return {
      initialPlayer: extracted.initialPlayerHint,
      initialPlayerSource: "setup_pl",
      handicapStones,
    };
  }
  if (firstMovePlayer != null) {
    return {
      initialPlayer: firstMovePlayer,
      initialPlayerSource: "first_move",
      handicapStones,
    };
  }
  if (handicapStones != null) {
    return {
      initialPlayer: "W",
      initialPlayerSource: "handicap_default_white",
      handicapStones,
    };
  }
  return {
    initialPlayer: "B",
    initialPlayerSource: "standard_default_black",
    handicapStones: null,
  };
}

const DEFAULT_BOARD_SIZE_V1 = 19;
const DEFAULT_KOMI_V1 = 6.5;
const SUPPORTED_BOARD_SIZES_V1 = new Set([9, 13, 19]);
const MIN_KATAGO_KOMI_V1 = -150;
const MAX_KATAGO_KOMI_V1 = 150;

function readSingleRootScalarPropertyV1(
  sgf: string,
  propId: "SZ" | "KM",
  invalidCode: "SGF_INVALID_BOARD_SIZE" | "SGF_INVALID_KOMI"
): string | null {
  const scan = scanMainlinePropertyV1(sgf, propId);
  if (
    scan.malformed ||
    scan.occurrences.length > 1 ||
    scan.occurrences.some(occurrence => occurrence.nodeIndex !== 0) ||
    scan.occurrences.some(occurrence => occurrence.values.length !== 1)
  ) {
    throw new SgfKatagoParseError(
      invalidCode,
      `${propId} must be one closed scalar property in the root node`
    );
  }
  return scan.occurrences[0]?.values[0]?.trim() ?? null;
}

function readBoardSizeFromSgfV1(sgf: string): {
  boardSize: number;
  boardSizeSource: SgfBoardSizeSourceV1;
} {
  const raw = readSingleRootScalarPropertyV1(
    sgf,
    "SZ",
    "SGF_INVALID_BOARD_SIZE"
  );
  if (raw == null) {
    return {
      boardSize: DEFAULT_BOARD_SIZE_V1,
      boardSizeSource: "sgf_default_missing",
    };
  }
  const rectangular = /^([+-]?\d+):([+-]?\d+)$/.exec(raw);
  if (rectangular) {
    const width = Number(rectangular[1]);
    const height = Number(rectangular[2]);
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      width > 52 ||
      height < 1 ||
      height > 52 ||
      width === height
    ) {
      throw new SgfKatagoParseError(
        "SGF_INVALID_BOARD_SIZE",
        "SZ must contain one valid FF[4] Go board size"
      );
    }
    throw new SgfKatagoParseError(
      "SGF_UNSUPPORTED_BOARD_SIZE",
      "only square 9x9, 13x13, and 19x19 boards are supported"
    );
  }
  if (!/^[+-]?\d+$/.test(raw)) {
    throw new SgfKatagoParseError(
      "SGF_INVALID_BOARD_SIZE",
      "SZ must contain one integer"
    );
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 52) {
    throw new SgfKatagoParseError(
      "SGF_INVALID_BOARD_SIZE",
      "SZ must contain one valid FF[4] Go board size"
    );
  }
  if (!SUPPORTED_BOARD_SIZES_V1.has(parsed)) {
    throw new SgfKatagoParseError(
      "SGF_UNSUPPORTED_BOARD_SIZE",
      "only square 9x9, 13x13, and 19x19 boards are supported"
    );
  }
  return { boardSize: parsed, boardSizeSource: "root_sz" };
}

function readKomiFromSgfV1(sgf: string): {
  komi: number;
  komiSource: SgfKomiSourceV1;
} {
  const raw = readSingleRootScalarPropertyV1(sgf, "KM", "SGF_INVALID_KOMI");
  if (raw == null) {
    return {
      komi: DEFAULT_KOMI_V1,
      komiSource: "product_default_missing",
    };
  }
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw)) {
    throw new SgfKatagoParseError(
      "SGF_INVALID_KOMI",
      "KM must contain one numeric value"
    );
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new SgfKatagoParseError(
      "SGF_INVALID_KOMI",
      "KM must contain one finite numeric value"
    );
  }
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw)!;
  const fraction = match[3] ?? "";
  const isWholePoint = fraction.length === 0 || /^0+$/.test(fraction);
  const isHalfPoint = /^50*$/.test(fraction);
  if (!isWholePoint && !isHalfPoint) {
    throw new SgfKatagoParseError(
      "SGF_UNSUPPORTED_KOMI",
      "KM must be an integer or half-integer from -150 to 150"
    );
  }
  const absoluteWhole = Number(match[2]);
  const signedHalfUnits =
    (match[1] === "-" ? -1 : 1) * (absoluteWhole * 2 + (isHalfPoint ? 1 : 0));
  if (
    !Number.isSafeInteger(signedHalfUnits) ||
    signedHalfUnits < MIN_KATAGO_KOMI_V1 * 2 ||
    signedHalfUnits > MAX_KATAGO_KOMI_V1 * 2
  ) {
    throw new SgfKatagoParseError(
      "SGF_UNSUPPORTED_KOMI",
      "KM must be an integer or half-integer from -150 to 150"
    );
  }
  return { komi: signedHalfUnits / 2, komiSource: "root_km" };
}

function assertParseableMainline(warnings: SgfPlaybackWarningV1[]): void {
  if (warnings.some((w) => w.code === "no_root")) {
    throw new SgfKatagoParseError("SGF_PARSE_FAILED", "SGF root (; missing");
  }
  if (warnings.some((w) => w.code === "unbalanced_parens")) {
    throw new SgfKatagoParseError(
      "SGF_PARSE_FAILED",
      "SGF variation tree is not closed"
    );
  }
  const unsupportedGm = warnings.find((w) => w.code === "unsupported_game_type");
  if (unsupportedGm) {
    throw new SgfKatagoParseError(
      "SGF_UNSUPPORTED_GAME_TYPE",
      `only GM[1] is supported; got GM[${String(unsupportedGm.params?.gm ?? "?")}]`
    );
  }
  if (warnings.some((w) => w.code === "setup_after_move_unsupported")) {
    throw new SgfKatagoParseError(
      "SGF_UNSUPPORTED_SETUP_STONES",
      "AB/AW/AE in a move node or after the first move is not supported for KataGo analysis v1"
    );
  }
}

function validateSetupStoneCoordinates(stones: ParsedSetupStoneV1[], boardSize: number): void {
  for (let i = 0; i < stones.length; i++) {
    const pt = stones[i]!.sgfPoint.trim().toLowerCase();
    if (pt.length !== 2) {
      throw new SgfKatagoParseError(
        "SGF_INVALID_COORDINATE",
        `setup stone ${String(i + 1)} coordinate invalid for SZ[${String(boardSize)}]`
      );
    }
    const x = sgfLetterToCoordIndex(pt[0]!, boardSize);
    const y = sgfLetterToCoordIndex(pt[1]!, boardSize);
    if (x == null || y == null) {
      throw new SgfKatagoParseError(
        "SGF_INVALID_COORDINATE",
        `setup stone ${String(i + 1)} coordinate invalid for SZ[${String(boardSize)}]`
      );
    }
  }
}

function validateMoveCoordinates(moves: ParsedMainlineMoveV1[], boardSize: number): void {
  for (let i = 0; i < moves.length; i++) {
    const pt = moves[i]!.sgfPoint;
    if (pt === "" || pt === "pass") {
      continue;
    }
    if (pt === "tt" && boardSize <= 19) {
      continue;
    }
    const gtp = sgfPointToGtp(pt, boardSize);
    if (gtp == null) {
      throw new SgfKatagoParseError(
        "SGF_INVALID_COORDINATE",
        `move ${String(i + 1)} coordinate invalid for SZ[${String(boardSize)}]`
      );
    }
  }
}

/** KataGo worker / multi-turn / timeline 공통 mainline 파서 */
export function parseSgfForKatagoV1(sgf: string): ParsedMinimalSgfV1 {
  if (!sgf?.trim()) {
    throw new SgfKatagoParseError("SGF_PARSE_FAILED", "empty SGF");
  }
  const extracted = extractMainlineBwMoves(sgf);
  const { moves, initialStones, warnings } = extracted;
  assertParseableMainline(warnings);
  const rules = parseSupportedKatagoRulesFromRootV1(sgf);
  const initialTurn = resolveSgfInitialTurnContractV1(extracted);
  const boardContract = readBoardSizeFromSgfV1(sgf);
  const { boardSize } = boardContract;
  validateSetupStoneCoordinates(initialStones, boardSize);
  validateMoveCoordinates(moves, boardSize);
  const komiContract = readKomiFromSgfV1(sgf);
  const { komi } = komiContract;
  const gameMetadata = parseSgfRootGameMetadataV1(sgf);
  return {
    boardSize,
    boardSizeSource: boardContract.boardSizeSource,
    komi,
    komiSource: komiContract.komiSource,
    rules,
    initialPlayer: initialTurn.initialPlayer,
    initialPlayerSource: initialTurn.initialPlayerSource,
    handicapStones: initialTurn.handicapStones,
    moves: moves.map(m => ({ color: m.color, sgfPoint: m.sgfPoint })),
    initialStones: initialStones.map(s => ({
      color: s.color,
      sgfPoint: s.sgfPoint,
    })),
    gameMetadata,
    parseWarnings: warnings,
  };
}

/** Dev/test: SGF 원문 없이 요약만 (로그·테스트용) */
export function summarizeSgfForKatagoDebugV1(sgf: string): {
  boardSize: number | null;
  totalMoves: number;
  firstMove: { color: "B" | "W"; sgfPoint: string } | null;
  lastMove: { color: "B" | "W"; sgfPoint: string } | null;
  warningCodes: string[];
  parseErrorCode: string | null;
} {
  try {
    const parsed = parseSgfForKatagoV1(sgf);
    const first = parsed.moves[0] ?? null;
    const last = parsed.moves.length > 0 ? parsed.moves[parsed.moves.length - 1]! : null;
    return {
      boardSize: parsed.boardSize,
      totalMoves: parsed.moves.length,
      firstMove: first,
      lastMove: last,
      warningCodes: parsed.parseWarnings.map((w) => w.code),
      parseErrorCode: null,
    };
  } catch (e) {
    const code = e instanceof SgfKatagoParseError ? e.code : "SGF_PARSE_FAILED";
    const extracted = extractMainlineBwMoves(sgf);
    return {
      boardSize: extracted.boardSizeHint,
      totalMoves: extracted.moves.length,
      firstMove: extracted.moves[0] ?? null,
      lastMove:
        extracted.moves.length > 0 ? extracted.moves[extracted.moves.length - 1]! : null,
      warningCodes: extracted.warnings.map((w) => w.code),
      parseErrorCode: code,
    };
  }
}
