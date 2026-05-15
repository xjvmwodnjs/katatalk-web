/**
 * KataGo analysis query용 SGF mainline 파싱 — `sgfPlaybackV1.extractMainlineBwMoves` 와 동일 경로.
 */

import {
  extractMainlineBwMoves,
  sgfPointToGtp,
  type ParsedMainlineMoveV1,
  type SgfPlaybackWarningV1,
} from "./sgfPlaybackV1";

export type ParsedMinimalSgfV1 = {
  boardSize: number;
  komi: number;
  moves: { color: "B" | "W"; sgfPoint: string }[];
  parseWarnings: SgfPlaybackWarningV1[];
};

export type SgfKatagoParseErrorCodeV1 =
  | "SGF_PARSE_FAILED"
  | "SGF_UNSUPPORTED_SETUP_STONES"
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

function readKomiFromSgf(sgf: string): number {
  const flat = sgf.replace(/\r\n|\r|\n/g, " ");
  const kmMatch = flat.match(/KM\[([^\]]+)\]/i);
  if (!kmMatch) {
    return 6.5;
  }
  const raw = kmMatch[1]!.trim().replace(",", ".");
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
  if (warnings.some((w) => w.code === "setup_markers_ignored")) {
    throw new SgfKatagoParseError(
      "SGF_UNSUPPORTED_SETUP_STONES",
      "AB/AW/AE setup stones are not supported for KataGo analysis v1"
    );
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
  const { moves, warnings, boardSizeHint } = extractMainlineBwMoves(sgf);
  assertParseableMainline(warnings);
  const boardSize = resolveBoardSize(boardSizeHint);
  validateMoveCoordinates(moves, boardSize);
  const komi = readKomiFromSgf(sgf);
  return {
    boardSize,
    komi,
    moves: moves.map((m) => ({ color: m.color, sgfPoint: m.sgfPoint })),
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
