/**
 * KataGo analysis query용 SGF mainline 파싱 — `sgfPlaybackV1.extractMainlineBwMoves` 와 동일 경로.
 */

import {
  extractMainlineBwMoves,
  readSgfBracketValue,
  sgfLetterToCoordIndex,
  sgfPointToGtp,
  type ParsedMainlineMoveV1,
  type ParsedSetupStoneV1,
  type SgfPlaybackWarningV1,
} from "./sgfPlaybackV1";

export type ParsedMinimalSgfV1 = {
  boardSize: number;
  komi: number;
  rules: SupportedKatagoRulesV1;
  moves: { color: "B" | "W"; sgfPoint: string }[];
  initialStones: { color: "B" | "W"; sgfPoint: string }[];
  parseWarnings: SgfPlaybackWarningV1[];
};

export type SupportedKatagoRulesV1 = "japanese";

export type SgfKatagoParseErrorCodeV1 =
  | "SGF_PARSE_FAILED"
  | "SGF_UNSUPPORTED_SETUP_STONES"
  | "SGF_UNSUPPORTED_GAME_TYPE"
  | "SGF_UNSUPPORTED_RULES"
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

function readOneSgfPropertyValue(
  s: string,
  i: number
): { propId: string; value: string; end: number } | null {
  let j = i;
  while (j < s.length && /\s/.test(s[j]!)) {
    j += 1;
  }
  if (j >= s.length || !/[A-Za-z]/.test(s[j]!)) {
    return null;
  }
  const idStart = j;
  while (j < s.length && /[A-Za-z]/.test(s[j]!)) {
    j += 1;
  }
  if (j >= s.length || s[j] !== "[") {
    return null;
  }
  const br = readSgfBracketValue(s, j);
  if (br == null) {
    return null;
  }
  return { propId: s.slice(idStart, j), value: br.text, end: br.end };
}

function findFirstMainlinePropertyValue(sgf: string, propId: string): string | null {
  const s = sgf.replace(/\r\n|\r|\n/g, " ");
  const rootIdx = s.indexOf("(;");
  if (rootIdx < 0) {
    return null;
  }

  const target = propId.toUpperCase();
  let i = rootIdx + 2;
  let parenDepth = 0;

  while (i < s.length) {
    const ch = s[i]!;
    if (parenDepth > 0) {
      if (ch === "(") {
        parenDepth += 1;
      } else if (ch === ")") {
        parenDepth -= 1;
      }
      i += 1;
      continue;
    }
    if (ch === ")") {
      break;
    }
    if (ch === "(") {
      parenDepth += 1;
      i += 1;
      continue;
    }
    if (ch === ";") {
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
    const prop = readOneSgfPropertyValue(s, i);
    if (prop == null) {
      i += 1;
      continue;
    }
    if (prop.propId.toUpperCase() === target) {
      return prop.value;
    }
    i = prop.end;
  }
  return null;
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

function readKomiFromSgf(sgf: string): number {
  const rawKomi = findFirstMainlinePropertyValue(sgf, "KM");
  if (rawKomi == null) {
    return 6.5;
  }
  const raw = rawKomi.trim().replace(",", ".");
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 6.5;
}

function resolveBoardSize(hint: number | null): number {
  const n = hint ?? 19;
  if (!Number.isFinite(n) || n < 2 || n > 25) {
    throw new SgfKatagoParseError("SGF_PARSE_FAILED", `invalid board size SZ=${String(hint)}`);
  }
  return n;
}

function assertParseableMainline(warnings: SgfPlaybackWarningV1[]): void {
  if (warnings.some((w) => w.code === "no_root")) {
    throw new SgfKatagoParseError("SGF_PARSE_FAILED", "SGF root (; missing");
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
      "AB/AW/AE after the first move is not supported for KataGo analysis v1"
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
  const { moves, initialStones, warnings, boardSizeHint } = extractMainlineBwMoves(sgf);
  assertParseableMainline(warnings);
  const rules = parseSupportedKatagoRulesFromRootV1(sgf);
  const boardSize = resolveBoardSize(boardSizeHint);
  validateSetupStoneCoordinates(initialStones, boardSize);
  validateMoveCoordinates(moves, boardSize);
  const komi = readKomiFromSgf(sgf);
  return {
    boardSize,
    komi,
    rules,
    moves: moves.map((m) => ({ color: m.color, sgfPoint: m.sgfPoint })),
    initialStones: initialStones.map((s) => ({ color: s.color, sgfPoint: s.sgfPoint })),
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
