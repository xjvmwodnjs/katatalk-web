/**
 * SGF mainline → board snapshot ViewModel v1 (no renderer, no capture rules).
 * 변화도·접바·handicap·setup stones 완전 지원 없음 — 경고만.
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
  | "duplicate_move";

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

function readBoardSizeFromFlat(flat: string): { boardSize: number; warn: SgfPlaybackWarningV1 | null } {
  const szMatch = flat.match(/SZ\[(\d+)\]/i);
  const n = szMatch ? Number.parseInt(szMatch[1]!, 10) : 19;
  if (!Number.isFinite(n) || n < 2 || n > 25) {
    return {
      boardSize: 19,
      warn: { code: "invalid_sz", params: { raw: String(szMatch?.[1] ?? "") } },
    };
  }
  const warn: SgfPlaybackWarningV1 | null = n !== 19 ? { code: "sz_not_19", params: { size: n } } : null;
  return { boardSize: n, warn };
}

/**
 * 루트 컬렉션 `(; … )` 안에서 변화도 `( … )` 블록을 건너뛰고 `;B[]` / `;W[]` 만 메인라인으로 수집.
 */
export function extractMainlineBwMoves(sgf: string): { moves: ParsedMainlineMoveV1[]; warnings: SgfPlaybackWarningV1[] } {
  const warnings: SgfPlaybackWarningV1[] = [];
  const flat = sgf.replace(/\r\n|\r|\n/g, " ");
  const rootIdx = flat.indexOf("(;");
  if (rootIdx < 0) {
    warnings.push({ code: "no_root" });
    return { moves: [], warnings };
  }
  if (/\bAB\[/i.test(flat) || /\bAW\[/i.test(flat) || /\bAE\[/i.test(flat)) {
    warnings.push({ code: "setup_markers_ignored" });
  }
  let i = rootIdx + 2;
  let depth = 0;
  const moves: ParsedMainlineMoveV1[] = [];
  while (i < flat.length) {
    const c = flat[i]!;
    if (c === ")") {
      if (depth === 0) {
        break;
      }
      depth -= 1;
      i += 1;
      continue;
    }
    if (c === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (depth === 0 && c === ";") {
      const slice = flat.slice(i);
      const m = /^;([BW])\[([^\]]*)\]/i.exec(slice);
      if (m) {
        const color = m[1]!.toUpperCase() as "B" | "W";
        const inner = (m[2] ?? "").trim();
        moves.push({ color, sgfPoint: inner.toLowerCase() });
        i += m[0].length;
        continue;
      }
    }
    i += 1;
  }
  if (depth > 0) {
    warnings.push({ code: "unbalanced_parens" });
  }
  return { moves, warnings };
}

function nextPlayerAfterMoves(moveCount: number): "B" | "W" {
  return moveCount % 2 === 0 ? "B" : "W";
}

export type BuildSgfPlaybackStateV1Args = {
  sgfText: string;
  /** null = 마지막 수까지 */
  selectedTurnIndex: number | null;
  /** game_info 등 힌트 (placeholder totalMovesHint 용, 선택) */
  totalMovesHint?: number | null;
};

/**
 * 메인라인 기준 보드 스냅샷. 실패·빈 SGF 시 placeholder 가 아닌 active + warnings 로 비울 수 있음 —
 * placeholder 는 호출측(`sgf_content` 없음)에서 유지.
 */
export function buildSgfPlaybackStateV1(args: BuildSgfPlaybackStateV1Args): SgfPlaybackActiveV1 {
  const flat = args.sgfText.replace(/\r\n|\r|\n/g, " ");
  const { boardSize, warn: szWarn } = readBoardSizeFromFlat(flat);
  const { moves: mainline, warnings: parseWarnings } = extractMainlineBwMoves(args.sgfText);
  const warnings: SgfPlaybackWarningV1[] = [...parseWarnings];
  if (szWarn) {
    warnings.push(szWarn);
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

  const grid = new Map<string, { color: "B" | "W"; turnIndex: number }>();
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
    const key = `${x},${y}`;
    if (grid.has(key)) {
      warnings.push({ code: "duplicate_move", params: { turnIndex, point: mv.sgfPoint } });
      continue;
    }
    grid.set(key, { color: mv.color, turnIndex });
    lastNonPass = { x, y, color: mv.color, turnIndex, gtp };
  }

  const stones: SgfPlaybackStoneV1[] = Array.from(grid.entries())
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
