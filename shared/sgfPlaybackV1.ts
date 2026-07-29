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
  /** 0 = SGF setup stone, otherwise 1-based mainline move index (첫 수 = 1) */
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
  | "setup_stones_applied"
  | "setup_stone_conflict"
  | "setup_after_move_unsupported"
  | "missing_ff_assumed_v4"
  | "missing_gm_assumed_go"
  | "unsupported_game_type"
  | "handicap_property_present"
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
export type ParsedSetupStoneV1 = { color: "B" | "W"; sgfPoint: string };

export type SgfInitialPositionIssueCodeV1 =
  | "invalid_player_to_play"
  | "player_to_play_with_move"
  | "player_to_play_after_move_unsupported"
  | "invalid_handicap"
  | "duplicate_handicap";

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

/** Skips one SGF game-tree branch without counting parentheses inside property values. */
export function skipSgfVariationTreeV1(
  s: string,
  openParenIndex: number
): { end: number; closed: boolean } {
  let depth = 0;
  let i = openParenIndex;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "[") {
      const bracket = readSgfBracketValue(s, i);
      if (bracket == null) {
        return { end: s.length, closed: false };
      }
      i = bracket.end;
      continue;
    }
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return { end: i + 1, closed: true };
      }
    }
    i += 1;
  }
  return { end: s.length, closed: false };
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
  initialStones: ParsedSetupStoneV1[];
  /** Last valid PL before the first move. */
  initialPlayerHint: "B" | "W" | null;
  /** Parsed HA value. `0` is retained as an exporter-compatible no-handicap marker. */
  handicapHint: number | null;
  /** Structural PL/HA issues resolved by the stricter KataGo parser. */
  initialPositionIssueCodes: SgfInitialPositionIssueCodeV1[];
  warnings: SgfPlaybackWarningV1[];
  /** 루트 메인라인에서 첫 유효 SZ (없으면 null → 기본 19) */
  boardSizeHint: number | null;
};

type SetupParseStateV1 = {
  sawSetup: boolean;
  afterMoveSetup: boolean;
  sawConflict: boolean;
  sawHa: boolean;
  initialPlayerHint: "B" | "W" | null;
  handicapHint: number | null;
  initialPositionIssueCodes: SgfInitialPositionIssueCodeV1[];
};

type NodePropertyContextV1 = {
  duplicateInNode: boolean;
  hadMoveBeforeNode: boolean;
  hasMoveInNode: boolean;
  isRootNode: boolean;
};

function pushInitialPositionIssueOnce(
  state: SetupParseStateV1,
  code: SgfInitialPositionIssueCodeV1
): void {
  if (!state.initialPositionIssueCodes.includes(code)) {
    state.initialPositionIssueCodes.push(code);
  }
}

/**
 * `i`에서 한 개의 `PropIdent[value]` 를 읽는다. 호출부는 `s[i]`가 문자로 시작한다고 가정한다.
 */
function consumeOneProperty(
  s: string,
  i: number
):
  | { ok: true; propId: string; values: string[]; end: number }
  | { ok: false; kind: "bad_prop"; end: number }
  | {
      ok: false;
      kind: "unclosed";
      propId: string;
      bracketAt: number;
      end: number;
    } {
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
  const propIdEnd = j;
  if (j >= s.length || s[j] !== "[") {
    return { ok: false, kind: "bad_prop", end: j };
  }
  const values: string[] = [];
  while (j < s.length) {
    while (j < s.length && /\s/.test(s[j]!)) {
      j += 1;
    }
    if (j >= s.length || s[j] !== "[") {
      break;
    }
    const bracketAt = j;
    const br = readSgfBracketValue(s, j);
    if (br == null) {
      return {
        ok: false,
        kind: "unclosed",
        propId: s.slice(idStart, propIdEnd),
        bracketAt,
        end: j + 1,
      };
    }
    values.push(br.text);
    j = br.end;
  }
  const propId = s.slice(idStart, propIdEnd);
  return { ok: true, propId, values, end: j };
}

function applyRootProperty(
  propId: string,
  values: string[],
  moves: ParsedMainlineMoveV1[],
  initialStoneMap: Map<string, "B" | "W">,
  warnings: SgfPlaybackWarningV1[],
  setupState: SetupParseStateV1,
  metadataState: {
    ffSeen: boolean;
    gmSeen: boolean;
    unsupportedGm: string | null;
  },
  recordSz: (raw: string) => void,
  nodeContext: NodePropertyContextV1
): void {
  const up = propId.toUpperCase();
  if (up === "AB" || up === "AW" || up === "AE") {
    if (nodeContext.hasMoveInNode || moves.length > 0) {
      if (!setupState.afterMoveSetup) {
        setupState.afterMoveSetup = true;
        warnings.push({ code: "setup_after_move_unsupported" });
      }
      return;
    }
    setupState.sawSetup = true;
    for (const rawValue of values) {
      const pt = rawValue.trim().toLowerCase();
      if (!pt) {
        continue;
      }
      if (up === "AE") {
        initialStoneMap.delete(pt);
        continue;
      }
      const color = up === "AB" ? "B" : "W";
      const prev = initialStoneMap.get(pt);
      if (prev != null && prev !== color && !setupState.sawConflict) {
        setupState.sawConflict = true;
        warnings.push({ code: "setup_stone_conflict", params: { point: pt } });
      }
      initialStoneMap.set(pt, color);
    }
  } else if (up === "SZ" && nodeContext.isRootNode) {
    recordSz(values[0] ?? "");
  } else if (up === "FF") {
    metadataState.ffSeen = true;
  } else if (up === "GM") {
    metadataState.gmSeen = true;
    const raw = (values[0] ?? "").trim();
    if (raw !== "1" && metadataState.unsupportedGm == null) {
      metadataState.unsupportedGm = raw || "(empty)";
      warnings.push({ code: "unsupported_game_type", params: { gm: metadataState.unsupportedGm } });
    }
  } else if (up === "HA") {
    if (!setupState.sawHa) {
      setupState.sawHa = true;
      warnings.push({ code: "handicap_property_present" });
    } else {
      pushInitialPositionIssueOnce(setupState, "duplicate_handicap");
    }
    if (nodeContext.duplicateInNode) {
      pushInitialPositionIssueOnce(setupState, "duplicate_handicap");
    }
    const raw = (values[0] ?? "").trim();
    if (values.length !== 1 || !/^\+?\d+$/.test(raw)) {
      pushInitialPositionIssueOnce(setupState, "invalid_handicap");
    } else {
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isSafeInteger(parsed) || (parsed !== 0 && parsed < 2)) {
        pushInitialPositionIssueOnce(setupState, "invalid_handicap");
      } else if (setupState.handicapHint == null) {
        setupState.handicapHint = parsed;
      }
    }
  } else if (up === "PL") {
    if (nodeContext.hadMoveBeforeNode) {
      pushInitialPositionIssueOnce(
        setupState,
        "player_to_play_after_move_unsupported"
      );
      return;
    }
    if (nodeContext.hasMoveInNode) {
      pushInitialPositionIssueOnce(setupState, "player_to_play_with_move");
      return;
    }
    const raw = (values[0] ?? "").trim().toUpperCase();
    if (
      nodeContext.duplicateInNode ||
      values.length !== 1 ||
      (raw !== "B" && raw !== "W")
    ) {
      pushInitialPositionIssueOnce(setupState, "invalid_player_to_play");
    } else {
      setupState.initialPlayerHint = raw;
    }
  } else if (propId.length === 1 && /^[BW]$/i.test(propId)) {
    const color = propId.toUpperCase() as "B" | "W";
    const value = values[0] ?? "";
    moves.push({ color, sgfPoint: value.trim().toLowerCase() });
  }
}

/** `start`부터 다음 `;` `(` `)` 전까지 노드 안의 모든 property 처리. 반환값은 다음 구조 문자 위치. */
function consumeAllPropertiesInNode(
  s: string,
  start: number,
  moves: ParsedMainlineMoveV1[],
  initialStoneMap: Map<string, "B" | "W">,
  warnings: SgfPlaybackWarningV1[],
  setupState: SetupParseStateV1,
  metadataState: {
    ffSeen: boolean;
    gmSeen: boolean;
    unsupportedGm: string | null;
  },
  recordSz: (raw: string) => void,
  isRootNode: boolean
): number {
  let j = start;
  const properties: { propId: string; values: string[] }[] = [];
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
        warnings.push({
          code: "unclosed_property",
          params: { at: r.bracketAt },
        });
        const unclosedId = r.propId.toUpperCase();
        if (unclosedId === "PL") {
          pushInitialPositionIssueOnce(setupState, "invalid_player_to_play");
        } else if (unclosedId === "HA") {
          pushInitialPositionIssueOnce(setupState, "invalid_handicap");
        }
      }
      j = r.end;
      continue;
    }
    properties.push({ propId: r.propId, values: r.values });
    j = r.end;
  }

  const hadMoveBeforeNode = moves.length > 0;
  const hasMoveInNode = properties.some(
    ({ propId }) => propId.length === 1 && /^[BW]$/i.test(propId)
  );
  const seenPropertyIds = new Set<string>();
  for (const property of properties) {
    const normalizedId = property.propId.toUpperCase();
    const duplicateInNode = seenPropertyIds.has(normalizedId);
    seenPropertyIds.add(normalizedId);
    applyRootProperty(
      property.propId,
      property.values,
      moves,
      initialStoneMap,
      warnings,
      setupState,
      metadataState,
      recordSz,
      { duplicateInNode, hadMoveBeforeNode, hasMoveInNode, isRootNode }
    );
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
    return {
      moves: [],
      initialStones: [],
      initialPlayerHint: null,
      handicapHint: null,
      initialPositionIssueCodes: [],
      warnings,
      boardSizeHint: null,
    };
  }

  let i = rootIdx + 2;
  const moves: ParsedMainlineMoveV1[] = [];
  const initialStoneMap = new Map<string, "B" | "W">();
  let boardSizeHint: number | null = null;
  const setupState: SetupParseStateV1 = {
    sawSetup: false,
    afterMoveSetup: false,
    sawConflict: false,
    sawHa: false,
    initialPlayerHint: null,
    handicapHint: null,
    initialPositionIssueCodes: [],
  };
  const metadataState = {
    ffSeen: false,
    gmSeen: false,
    unsupportedGm: null as string | null,
  };
  let variationBranchCount = 0;
  let unclosedVariation = false;
  let isRootNode = true;

  const recordSz = (raw: string) => {
    if (boardSizeHint != null) {
      return;
    }
    const t = raw.trim();
    const m = /^\+?(\d+)$/.exec(t);
    if (m) {
      const n = Number.parseInt(m[1]!, 10);
      if (Number.isFinite(n)) {
        boardSizeHint = n;
      }
    }
  };

  while (i < s.length) {
    const c = s[i]!;
    if (c === ")") {
      break;
    }
    if (c === "(") {
      variationBranchCount += 1;
      const skipped = skipSgfVariationTreeV1(s, i);
      i = skipped.end;
      if (!skipped.closed) {
        unclosedVariation = true;
      }
      continue;
    }
    if (c === ";") {
      isRootNode = false;
      i += 1;
      i = consumeAllPropertiesInNode(
        s,
        i,
        moves,
        initialStoneMap,
        warnings,
        setupState,
        metadataState,
        recordSz,
        isRootNode
      );
      continue;
    }
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      i = consumeAllPropertiesInNode(
        s,
        i,
        moves,
        initialStoneMap,
        warnings,
        setupState,
        metadataState,
        recordSz,
        isRootNode
      );
      continue;
    }
    i += 1;
  }

  if (unclosedVariation) {
    warnings.push({ code: "unbalanced_parens" });
  }
  if (variationBranchCount > 0) {
    warnings.push({ code: "variation_branch_skipped", params: { count: variationBranchCount } });
  }
  if (!metadataState.ffSeen) {
    warnings.push({ code: "missing_ff_assumed_v4" });
  }
  if (!metadataState.gmSeen) {
    warnings.push({ code: "missing_gm_assumed_go" });
  }

  const initialStones = Array.from(initialStoneMap.entries()).map(([sgfPoint, color]) => ({ color, sgfPoint }));
  if (initialStones.length > 0) {
    warnings.push({ code: "setup_stones_applied", params: { count: initialStones.length } });
  }

  return {
    moves,
    initialStones,
    initialPlayerHint: setupState.initialPlayerHint,
    handicapHint: setupState.handicapHint,
    initialPositionIssueCodes: setupState.initialPositionIssueCodes,
    warnings,
    boardSizeHint,
  };
}

function oppositePlayer(player: "B" | "W"): "B" | "W" {
  return player === "B" ? "W" : "B";
}

function nextPlayerAfterMoves(
  moves: ParsedMainlineMoveV1[],
  moveCount: number,
  initialPlayer: "B" | "W"
): "B" | "W" {
  if (moveCount <= 0) {
    return initialPlayer;
  }
  return oppositePlayer(moves[moveCount - 1]!.color);
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
  const {
    moves: mainline,
    initialStones,
    initialPlayerHint,
    handicapHint,
    initialPositionIssueCodes,
    warnings: parseWarnings,
    boardSizeHint,
  } = extractMainlineBwMoves(args.sgfText);
  const warnings: SgfPlaybackWarningV1[] = [...parseWarnings];
  const firstMovePlayer = mainline[0]?.color ?? null;
  const initialContractInvalid =
    initialPositionIssueCodes.length > 0 ||
    (initialPlayerHint != null &&
      firstMovePlayer != null &&
      initialPlayerHint !== firstMovePlayer);
  const initialPlayer =
    (initialContractInvalid ? null : initialPlayerHint) ??
    firstMovePlayer ??
    (!initialContractInvalid && handicapHint != null && handicapHint >= 2
      ? "W"
      : "B");

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

  for (const setupStone of initialStones) {
    const pt = setupStone.sgfPoint.trim().toLowerCase();
    if (pt.length !== 2) {
      warnings.push({ code: "coord_len_error", params: { turnIndex: 0, point: setupStone.sgfPoint } });
      continue;
    }
    const x = sgfLetterToCoordIndex(pt[0]!, boardSize);
    const y = sgfLetterToCoordIndex(pt[1]!, boardSize);
    if (x == null || y == null) {
      warnings.push({ code: "coord_out_of_range", params: { turnIndex: 0, point: setupStone.sgfPoint } });
      continue;
    }
    board.set(cellKey(x, y), { color: setupStone.color, turnIndex: 0 });
  }

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
    currentPlayer: nextPlayerAfterMoves(mainline, sel, initialPlayer),
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
