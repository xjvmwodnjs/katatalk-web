/**
 * SGF mainline → board snapshot ViewModel v1.
 * - Token 기반 루트 파서: property value 안의 `;`, `(`, `)`, 이스케이프 `]` 를 move 오인 없이 처리.
 * - 메인라인 `;B[]` / `;W[]` 만 반영; 변화도 `(` … `)` 는 건너뛰고 경고.
 * - 단순 capture: 상대 연결군 liberty 0 이면 제거. ko/자살 완전 판정 없음(경고만).
 * UI 렌더러 없음.
 */

export type SgfPlaybackStoneV1 = {
  x: number;
  y: number;
  color: "B" | "W";
  /** 1-based mainline move index (첫 수 = 1) */
  turnIndex: number;
};

export type SgfPlaybackLastMoveV1 = {
  x: number;
  y: number;
  color: "B" | "W";
  turnIndex: number;
  gtp: string;
};

export type SgfPlaybackWarningCodeV1 =
  | "no_root"
  | "setup_markers_ignored"
  | "unbalanced_parens"
  | "invalid_sz"
  | "sz_not_19"
  | "selected_turn_clamped_negative"
  | "selected_turn_clamped_high"
  | "invalid_point_format"
  | "coord_len_error"
  | "coord_out_of_range"
  | "duplicate_move"
  | "variation_branch_skipped"
  | "unclosed_property"
  | "suicide_not_fully_handled_v1";

export type SgfPlaybackWarningV1 = {
  code: SgfPlaybackWarningCodeV1;
  params?: Record<string, string | number>;
};

export type SgfPlaybackActiveV1 = {
  version: "sgf-playback-v1";
  placeholder: false;
  boardSize: number;
  totalMoves: number;
  selectedTurnIndex: number;
  currentPlayer: "B" | "W";
  stones: SgfPlaybackStoneV1[];
  lastMove: SgfPlaybackLastMoveV1 | null;
  warnings: SgfPlaybackWarningV1[];
};

export type SgfPlaybackPlaceholderV1 = {
  placeholder: true;
  /** UI 번역 키 */
  messageKey: string;
  totalMovesHint: number | null;
};

export type SgfPlaybackViewModelV1 = SgfPlaybackActiveV1 | SgfPlaybackPlaceholderV1;

export type ParsedMainlineMoveV1 = { color: "B" | "W"; sgfPoint: string };

/** `[` 직후부터 SGF Text 이스케이프 규칙으로 `]` 까지 읽기 (`\\`, `\]`) */
export function readSgfBracketValue(s: string, openBracketIdx: number): { text: string; end: number } | null {
  if (openBracketIdx >= s.length || s[openBracketIdx] !== "[") {
    return null;
  }
  let i = openBracketIdx + 1;
  let acc = "";
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "\\" && i + 1 < s.length) {
      acc += s[i + 1]!;
      i += 2;
      continue;
    }
    if (ch === "]") {
      return { text: acc, end: i + 1 };
    }
    acc += ch;
    i += 1;
  }
  return null;
}

/** SGF 열/행 한 글자 → 0-based (a=0 …, i 포함 연속) */
export function sgfLetterToCoordIndex(letter: string, boardSize: number): number | null {
  if (letter.length !== 1) {
    return null;
  }
  const low = letter.toLowerCase();
  if (low < "a" || low > "z") {
    return null;
  }
  const code = low.charCodeAt(0) - "a".charCodeAt(0);
  if (code < 0 || code >= boardSize) {
    return null;
  }
  return code;
}

/** 0-based 열 인덱스 → GTP 열 (대문자 I 생략) */
export function indexToGtpColumn(colIdx: number): string {
  let n = colIdx;
  if (n >= 8) {
    n += 1;
  }
  return String.fromCharCode("A".charCodeAt(0) + n);
}

function isTtPassConvention(pointLower: string, boardSize: number): boolean {
  return pointLower === "tt" && boardSize <= 19;
}

/** GTP 열 문자(A–T, I 생략) → 0-based 열 인덱스. 실패 시 null */
export function gtpColumnToIndex(colLetter: string, boardSize: number): number | null {
  const ch = colLetter.trim().toUpperCase();
  if (ch.length !== 1 || ch < "A" || ch > "T" || ch === "I") {
    return null;
  }
  let colIdx = ch.charCodeAt(0) - "A".charCodeAt(0);
  if (colIdx >= 8) {
    colIdx -= 1;
  }
  if (colIdx < 0 || colIdx >= boardSize) {
    return null;
  }
  return colIdx;
}

/**
 * GTP 좌표 → 보드 엔진과 동일한 0-based (x, y). `pass`·파싱 실패 시 null.
 * 행 번호는 GTP 관례(하단=1, 상단=boardSize)이며 y 는 SGF row-from-top 과 같다.
 */
export function gtpCoordToBoardXY(gtp: string, boardSize: number): { x: number; y: number } | null {
  const raw = gtp.trim();
  if (!raw || /^pass$/i.test(raw)) {
    return null;
  }
  const m = /^([A-Za-z]+)(\d+)$/.exec(raw);
  if (!m) {
    return null;
  }
  const colIdx = gtpColumnToIndex(m[1]!, boardSize);
  if (colIdx == null) {
    return null;
  }
  const rowNum = Number.parseInt(m[2]!, 10);
  if (!Number.isFinite(rowNum) || rowNum < 1 || rowNum > boardSize) {
    return null;
  }
  const y = boardSize - rowNum;
  if (y < 0 || y >= boardSize) {
    return null;
  }
  return { x: colIdx, y };
}

/** GTP 행 번호(1=하단) 표시용 */
export function boardYToGtpRow(y: number, boardSize: number): number {
  return boardSize - y;
}

/** 착점 → GTP 좌표 또는 pass (실패 시 null) */
export function sgfPointToGtp(point: string, boardSize: number): string | null {
  const raw = point.trim().toLowerCase();
  if (raw === "" || raw === "pass") {
    return "pass";
  }
  if (isTtPassConvention(raw, boardSize)) {
    return "pass";
  }
  if (raw.length !== 2) {
    return null;
  }
  const col = sgfLetterToCoordIndex(raw[0]!, boardSize);
  const rowFromTop = sgfLetterToCoordIndex(raw[1]!, boardSize);
  if (col == null || rowFromTop == null) {
    return null;
  }
  const gtpRow = boardSize - rowFromTop;
  return `${indexToGtpColumn(col)}${String(gtpRow)}`;
}

export type ExtractMainlineBwMovesResultV1 = {
  moves: ParsedMainlineMoveV1[];
  warnings: SgfPlaybackWarningV1[];
  /** 루트 메인라인에서 첫 유효 SZ (없으면 null → 기본 19) */
  boardSizeHint: number | null;
};

/**
 * `i`에서 한 개의 `PropIdent[value]` 를 읽는다. 호출부는 `s[i]`가 문자로 시작한다고 가정한다.
 */
function consumeOneProperty(
  s: string,
  i: number
):
  | { ok: true; propId: string; value: string; end: number }
  | { ok: false; kind: "bad_prop"; end: number }
  | { ok: false; kind: "unclosed"; bracketAt: number; end: number } {
  let j = i;
  while (j < s.length && /\s/.test(s[j]!)) {
    j += 1;
  }
  if (j >= s.length || !/[A-Za-z]/.test(s[j]!)) {
    return { ok: false, kind: "bad_prop", end: i + 1 };
  }
  const idStart = j;
  while (j < s.length && /[A-Za-z]/.test(s[j]!)) {
    j += 1;
  }
  if (j >= s.length || s[j] !== "[") {
    return { ok: false, kind: "bad_prop", end: j };
  }
  const bracketAt = j;
  const br = readSgfBracketValue(s, j);
  if (br == null) {
    return { ok: false, kind: "unclosed", bracketAt, end: j + 1 };
  }
  const propId = s.slice(idStart, j);
  return { ok: true, propId, value: br.text, end: br.end };
}

function applyRootProperty(
  propId: string,
  value: string,
  moves: ParsedMainlineMoveV1[],
  warnings: SgfPlaybackWarningV1[],
  setupWarned: { v: boolean },
  recordSz: (raw: string) => void
): void {
  const up = propId.toUpperCase();
  if (up === "AB" || up === "AW" || up === "AE") {
    if (!setupWarned.v) {
      setupWarned.v = true;
      warnings.push({ code: "setup_markers_ignored" });
    }
  } else if (up === "SZ") {
    recordSz(value);
  } else if (propId.length === 1 && /^[BW]$/i.test(propId)) {
    const color = propId.toUpperCase() as "B" | "W";
    moves.push({ color, sgfPoint: value.trim().toLowerCase() });
  }
}

/** `start`부터 다음 `;` `(` `)` 전까지 노드 안의 모든 property 처리. 반환값은 다음 구조 문자 위치. */
function consumeAllPropertiesInNode(
  s: string,
  start: number,
  moves: ParsedMainlineMoveV1[],
  warnings: SgfPlaybackWarningV1[],
  setupWarned: { v: boolean },
  recordSz: (raw: string) => void
): number {
  let j = start;
  while (j < s.length) {
    while (j < s.length && /\s/.test(s[j]!)) {
      j += 1;
    }
    if (j >= s.length) {
      break;
    }
    const ch = s[j]!;
    if (ch === ";" || ch === "(" || ch === ")") {
      break;
    }
    if (!/[A-Za-z]/.test(ch)) {
      j += 1;
      continue;
    }
    const r = consumeOneProperty(s, j);
    if (!r.ok) {
      if (r.kind === "unclosed") {
        warnings.push({ code: "unclosed_property", params: { at: r.bracketAt } });
      }
      j = r.end;
      continue;
    }
    applyRootProperty(r.propId, r.value, moves, warnings, setupWarned, recordSz);
    j = r.end;
  }
  return j;
}

/**
 * 루트 `(; … )` 안에서 변화도 `( … )` 는 건너뛰고, 각 노드의 **모든** `Prop[value]`(첫 `(;` 직후·`;` 뒤)를 순회해
 * `B`/`W` 착수·`SZ`·`AB`/`AW`/`AE` 만 처리한다. 값은 `readSgfBracketValue` 로만 읽는다.
 */
export function extractMainlineBwMoves(sgf: string): ExtractMainlineBwMovesResultV1 {
  const warnings: SgfPlaybackWarningV1[] = [];
  const s = sgf.replace(/\r\n|\r|\n/g, " ");
  const rootIdx = s.indexOf("(;");
  if (rootIdx < 0) {
    warnings.push({ code: "no_root" });
    return { moves: [], warnings, boardSizeHint: null };
  }

  let i = rootIdx + 2;
  let parenDepth = 0;
  const moves: ParsedMainlineMoveV1[] = [];
  let boardSizeHint: number | null = null;
  const setupWarned = { v: false };
  let variationBranchCount = 0;

  const recordSz = (raw: string) => {
    if (boardSizeHint != null) {
      return;
    }
    const t = raw.trim();
    const m = /^(\d+)$/.exec(t);
    if (m) {
      const n = Number.parseInt(m[1]!, 10);
      if (Number.isFinite(n)) {
        boardSizeHint = n;
      }
    }
  };

  while (i < s.length) {
    const c = s[i]!;
    if (parenDepth > 0) {
      if (c === "(") {
        parenDepth += 1;
      } else if (c === ")") {
        parenDepth -= 1;
      }
      i += 1;
      continue;
    }
    if (c === ")") {
      break;
    }
    if (c === "(") {
      variationBranchCount += 1;
      parenDepth += 1;
      i += 1;
      continue;
    }
    if (c === ";") {
      i += 1;
      i = consumeAllPropertiesInNode(s, i, moves, warnings, setupWarned, recordSz);
      continue;
    }
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      i = consumeAllPropertiesInNode(s, i, moves, warnings, setupWarned, recordSz);
      continue;
    }
    i += 1;
  }

  if (parenDepth > 0) {
    warnings.push({ code: "unbalanced_parens" });
  }
  if (variationBranchCount > 0) {
    warnings.push({ code: "variation_branch_skipped", params: { count: variationBranchCount } });
  }

  return { moves, warnings, boardSizeHint };
}

function nextPlayerAfterMoves(moveCount: number): "B" | "W" {
  return moveCount % 2 === 0 ? "B" : "W";
}

type StoneCellV1 = { color: "B" | "W"; turnIndex: number };

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function neighbors4(x: number, y: number, boardSize: number): [number, number][] {
  const out: [number, number][] = [];
  if (x > 0) {
    out.push([x - 1, y]);
  }
  if (x < boardSize - 1) {
    out.push([x + 1, y]);
  }
  if (y > 0) {
    out.push([x, y - 1]);
  }
  if (y < boardSize - 1) {
    out.push([x, y + 1]);
  }
  return out;
}

function collectGroup(
  board: Map<string, StoneCellV1>,
  sx: number,
  sy: number,
  color: "B" | "W",
  boardSize: number
): Set<string> {
  const start = cellKey(sx, sy);
  const root = board.get(start);
  if (!root || root.color !== color) {
    return new Set();
  }
  const seen = new Set<string>();
  const stack: [number, number][] = [[sx, sy]];
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const k = cellKey(x, y);
    if (seen.has(k)) {
      continue;
    }
    const cell = board.get(k);
    if (!cell || cell.color !== color) {
      continue;
    }
    seen.add(k);
    for (const [nx, ny] of neighbors4(x, y, boardSize)) {
      if (!seen.has(cellKey(nx, ny))) {
        stack.push([nx, ny]);
      }
    }
  }
  return seen;
}

function countLiberties(board: Map<string, StoneCellV1>, group: Set<string>, boardSize: number): number {
  const lib = new Set<string>();
  for (const k of Array.from(group)) {
    const parts = k.split(",").map((n: string) => Number.parseInt(n, 10));
    const x = parts[0]!;
    const y = parts[1]!;
    for (const [nx, ny] of neighbors4(x, y, boardSize)) {
      const nk = cellKey(nx, ny);
      if (!board.has(nk)) {
        lib.add(nk);
      }
    }
  }
  return lib.size;
}

function removeStones(board: Map<string, StoneCellV1>, group: Set<string>): void {
  for (const k of Array.from(group)) {
    board.delete(k);
  }
}

/** 착수 + 상대 포획. 자살/ko 미완 — liberty 0 이면 경고만. */
function playStoneWithCapture(
  board: Map<string, StoneCellV1>,
  x: number,
  y: number,
  color: "B" | "W",
  turnIndex: number,
  boardSize: number,
  warnings: SgfPlaybackWarningV1[],
  sgfPointLabel: string
): boolean {
  const k = cellKey(x, y);
  if (board.has(k)) {
    warnings.push({ code: "duplicate_move", params: { turnIndex, point: sgfPointLabel } });
    return false;
  }
  const opponent: "B" | "W" = color === "B" ? "W" : "B";
  board.set(k, { color, turnIndex });

  const seenSig = new Set<string>();
  const toRemove: Set<string>[] = [];
  for (const [nx, ny] of neighbors4(x, y, boardSize)) {
    const nk = cellKey(nx, ny);
    const cell = board.get(nk);
    if (!cell || cell.color !== opponent) {
      continue;
    }
    const grp = collectGroup(board, nx, ny, opponent, boardSize);
    const sig = Array.from(grp).sort().join("|");
    if (seenSig.has(sig)) {
      continue;
    }
    seenSig.add(sig);
    if (countLiberties(board, grp, boardSize) === 0) {
      toRemove.push(grp);
    }
  }
  for (const grp of toRemove) {
    removeStones(board, grp);
  }

  const myGroup = collectGroup(board, x, y, color, boardSize);
  if (countLiberties(board, myGroup, boardSize) === 0) {
    warnings.push({ code: "suicide_not_fully_handled_v1", params: { turnIndex } });
  }
  return true;
}

export type BuildSgfPlaybackStateV1Args = {
  sgfText: string;
  /** null = 마지막 수까지 */
  selectedTurnIndex: number | null;
  /** game_info 등 힌트 (placeholder totalMovesHint 용, 선택) */
  totalMovesHint?: number | null;
};

/**
 * 메인라인 기준 보드 스냅샷(capture 반영). placeholder 는 호출측(`sgf_content` 없음)에서 유지.
 */
export function buildSgfPlaybackStateV1(args: BuildSgfPlaybackStateV1Args): SgfPlaybackActiveV1 {
  const { moves: mainline, warnings: parseWarnings, boardSizeHint } = extractMainlineBwMoves(args.sgfText);
  const warnings: SgfPlaybackWarningV1[] = [...parseWarnings];

  let boardSize = 19;
  if (boardSizeHint != null && Number.isFinite(boardSizeHint) && boardSizeHint >= 2 && boardSizeHint <= 25) {
    boardSize = Math.trunc(boardSizeHint);
  } else if (boardSizeHint != null) {
    warnings.push({ code: "invalid_sz", params: { raw: String(boardSizeHint) } });
  }
  if (boardSize !== 19) {
    warnings.push({ code: "sz_not_19", params: { size: boardSize } });
  }

  const totalMoves = mainline.length;
  let sel =
    args.selectedTurnIndex == null ? totalMoves : Math.trunc(Number(args.selectedTurnIndex));
  if (!Number.isFinite(sel)) {
    sel = totalMoves;
  }
  if (sel < 0) {
    warnings.push({ code: "selected_turn_clamped_negative" });
    sel = 0;
  }
  if (sel > totalMoves) {
    warnings.push({ code: "selected_turn_clamped_high", params: { max: totalMoves } });
    sel = totalMoves;
  }

  const board = new Map<string, StoneCellV1>();
  let lastNonPass: SgfPlaybackLastMoveV1 | null = null;

  for (let mi = 0; mi < sel; mi += 1) {
    const mv = mainline[mi]!;
    const turnIndex = mi + 1;
    const pt = mv.sgfPoint.trim().toLowerCase();
    const gtp = sgfPointToGtp(pt, boardSize);
    if (gtp === "pass" || gtp == null) {
      if (gtp == null) {
        warnings.push({ code: "invalid_point_format", params: { turnIndex, point: mv.sgfPoint } });
      }
      continue;
    }
    if (pt.length !== 2) {
      warnings.push({ code: "coord_len_error", params: { turnIndex, point: mv.sgfPoint } });
      continue;
    }
    const x = sgfLetterToCoordIndex(pt[0]!, boardSize);
    const y = sgfLetterToCoordIndex(pt[1]!, boardSize);
    if (x == null || y == null) {
      warnings.push({ code: "coord_out_of_range", params: { turnIndex, point: mv.sgfPoint } });
      continue;
    }
    const ok = playStoneWithCapture(board, x, y, mv.color, turnIndex, boardSize, warnings, mv.sgfPoint);
    if (ok) {
      lastNonPass = { x, y, color: mv.color, turnIndex, gtp };
    }
  }

  const stones: SgfPlaybackStoneV1[] = Array.from(board.entries())
    .map(([k, v]) => {
      const [xs, ys] = k.split(",").map((n) => Number.parseInt(n, 10));
      return { x: xs!, y: ys!, color: v.color, turnIndex: v.turnIndex };
    })
    .sort((a, b) => a.turnIndex - b.turnIndex);

  return {
    version: "sgf-playback-v1",
    placeholder: false,
    boardSize,
    totalMoves,
    selectedTurnIndex: sel,
    currentPlayer: nextPlayerAfterMoves(sel),
    stones,
    lastMove: lastNonPass,
    warnings,
  };
}

export function readSgfContentFromResultPayload(result: Record<string, unknown>): string | null {
  const a = result.sgf_content;
  const b = result.sgfContent;
  if (typeof a === "string" && a.trim()) {
    return a;
  }
  if (typeof b === "string" && b.trim()) {
    return b;
  }
  return null;
}
