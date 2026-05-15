/**
 * KataGo query용 SGF 파싱 — `shared/sgfKatagoParseV1` (sgfPlayback mainline) 와 동일 경로.
 *
 * 좌표계: **SGF** 소문자 열·행은 **연속 a–z 에서 i 를 건너뛰지 않음** (`a`=0 … `s`=18 on 19×19).
 * **GTP** 열 문자만 **대문자 I 를 생략**한다 (열 인덱스 → `A`–`H`,`J`–`T`).
 */

import { parseSgfForKatagoV1, SgfKatagoParseError } from "@shared/sgfKatagoParseV1";

/** SGF 좌표 한 글자 → 0-based 보드 인덱스 (i 포함, shift 없음). */
export function sgfLetterToCoordIndex(letter: string, boardSize: number): number {
  if (letter.length !== 1 || letter < "a" || letter > "z") {
    throw new Error(`[katago-smoke] 잘못된 SGF 좌표 문자: ${letter}`);
  }
  const code = letter.charCodeAt(0) - "a".charCodeAt(0);
  if (code < 0 || code >= boardSize) {
    throw new Error(`[katago-smoke] SGF 좌표가 보드 크기 ${String(boardSize)} 을 벗어났습니다: ${letter}`);
  }
  return code;
}

/** 0-based 열 인덱스 → GTP 열 문자(대문자 **I 만** 생략; SGF 와 무관). */
export function indexToGtpColumn(colIdx: number): string {
  let n = colIdx;
  if (n >= 8) {
    n += 1;
  }
  return String.fromCharCode("A".charCodeAt(0) + n);
}

/** `tt` 를 pass 로 보는 관례: 보드 크기 ≤19 만 (그 이상은 실좌표일 수 있음). */
function isTtPassConvention(pointLower: string, boardSize: number): boolean {
  return pointLower === "tt" && boardSize <= 19;
}

/** SGF 착점 → KataGo analysis 가 기대하는 GTP 좌표 또는 `pass`. */
export function sgfPointToGtp(point: string, boardSize: number): string {
  const raw = point.trim().toLowerCase();
  if (raw === "" || raw === "pass") {
    return "pass";
  }
  if (isTtPassConvention(raw, boardSize)) {
    return "pass";
  }
  if (raw.length !== 2) {
    throw new Error(`[katago-smoke] SGF 착점은 두 글자 또는 pass(B[]/W[] 빈칸, tt는 ≤19×19 한정) 여야 합니다.`);
  }
  const col = sgfLetterToCoordIndex(raw[0]!, boardSize);
  const rowFromTop = sgfLetterToCoordIndex(raw[1]!, boardSize);
  const gtpRow = boardSize - rowFromTop;
  return `${indexToGtpColumn(col)}${String(gtpRow)}`;
}

export type ParsedMinimalSgf = {
  boardSize: number;
  komi: number;
  moves: { color: "B" | "W"; sgfPoint: string }[];
};

export function parseMinimalSgfForSmoke(sgf: string): ParsedMinimalSgf {
  try {
    const parsed = parseSgfForKatagoV1(sgf);
    return {
      boardSize: parsed.boardSize,
      komi: parsed.komi,
      moves: parsed.moves,
    };
  } catch (e) {
    if (e instanceof SgfKatagoParseError) {
      throw new Error(e.message);
    }
    throw e;
  }
}

export type KatagoSmokeAnalysisQuery = {
  id: string;
  moves: [string, string][];
  rules: string;
  komi: number;
  boardXSize: number;
  boardYSize: number;
  includeOwnership: boolean;
  maxVisits: number;
};

/** KataGo `analysis` stdin 한 줄. 필드명은 버전에 따라 다를 수 있음 — `katago analysis --help` 참고. */
export function buildKatagoAnalysisQueryObject(params: {
  boardSize: number;
  komi: number;
  moves: { color: "B" | "W"; sgfPoint: string }[];
  maxVisits: number;
  id: string;
}): KatagoSmokeAnalysisQuery {
  const pairs: [string, string][] = params.moves.map(({ color, sgfPoint }) => [
    color,
    sgfPointToGtp(sgfPoint, params.boardSize),
  ]);
  return {
    id: params.id,
    moves: pairs,
    rules: "japanese",
    komi: params.komi,
    boardXSize: params.boardSize,
    boardYSize: params.boardSize,
    includeOwnership: true,
    maxVisits: params.maxVisits,
  };
}

export function buildKatagoAnalysisQueryLine(params: {
  boardSize: number;
  komi: number;
  moves: { color: "B" | "W"; sgfPoint: string }[];
  maxVisits: number;
  id: string;
}): string {
  return `${JSON.stringify(buildKatagoAnalysisQueryObject(params))}\n`;
}
