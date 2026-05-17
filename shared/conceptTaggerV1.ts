import type {
  ProductConceptTagEvidenceV1,
  ProductConceptTagV1,
  ProductDecisiveMoveV1,
  ProductEventConfidenceV1,
  ProductForbiddenConceptClaimV1,
  ProductReviewMoveV1,
} from "./analysisProductEventsV1";
import { buildSgfPlaybackStateV1, gtpCoordToBoardXY, type SgfPlaybackStoneV1 } from "./sgfPlaybackV1";

export const CONCEPT_TAGGER_V1_VERSION = "concept-tagger-v1" as const;

export type ConceptTaggerOwnershipSummaryV1 = {
  available: boolean;
  pattern?: "invasion" | "reduction" | "territory_defense";
};

export type ConceptTaggerBoardStoneV1 = Pick<SgfPlaybackStoneV1, "x" | "y" | "color">;

export type ConceptTaggerInputV1 = {
  boardSize: number;
  stonesBefore: ConceptTaggerBoardStoneV1[];
  turnIndex: number;
  totalMoves: number | null;
  player: "B" | "W";
  playedMove: string | null;
  recommendedMove: string | null;
  pv?: string[];
  scoreLoss: number | null;
  winrateLoss: number | null;
  bsiScore?: number | null;
  adiScore?: number | null;
  ownershipSummary?: ConceptTaggerOwnershipSummaryV1 | null;
  ladderEvidence?: boolean;
};

export type ConceptTaggerOutputV1 = {
  version: typeof CONCEPT_TAGGER_V1_VERSION;
  conceptTagsV1: ProductConceptTagEvidenceV1[];
  forbiddenConceptClaims: ProductForbiddenConceptClaimV1[];
};

type ProductMoveWithConceptsV1 = (ProductDecisiveMoveV1 | ProductReviewMoveV1) & {
  conceptTagsV1?: ProductConceptTagEvidenceV1[];
  forbiddenConceptClaims?: ProductForbiddenConceptClaimV1[];
};

type GroupInfo = {
  color: "B" | "W";
  stones: string[];
  liberties: Set<string>;
};

function other(color: "B" | "W"): "B" | "W" {
  return color === "B" ? "W" : "B";
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function neighbors(x: number, y: number, boardSize: number): Array<{ x: number; y: number }> {
  return [
    { x: x - 1, y },
    { x: x + 1, y },
    { x, y: y - 1 },
    { x, y: y + 1 },
  ].filter((p) => p.x >= 0 && p.y >= 0 && p.x < boardSize && p.y < boardSize);
}

function moveToXy(move: string | null, boardSize: number): { x: number; y: number } | null {
  if (move == null || move.trim().length === 0 || /^pass$/i.test(move)) {
    return null;
  }
  return gtpCoordToBoardXY(move, boardSize);
}

function buildBoard(stones: ConceptTaggerBoardStoneV1[]): Map<string, "B" | "W"> {
  const board = new Map<string, "B" | "W">();
  for (const stone of stones) {
    board.set(key(stone.x, stone.y), stone.color);
  }
  return board;
}

function collectGroup(board: Map<string, "B" | "W">, boardSize: number, start: { x: number; y: number }): GroupInfo | null {
  const color = board.get(key(start.x, start.y));
  if (color == null) {
    return null;
  }
  const seen = new Set<string>();
  const stack = [start];
  const liberties = new Set<string>();
  while (stack.length > 0) {
    const p = stack.pop()!;
    const k = key(p.x, p.y);
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    for (const n of neighbors(p.x, p.y, boardSize)) {
      const nk = key(n.x, n.y);
      const c = board.get(nk);
      if (c == null) {
        liberties.add(nk);
      } else if (c === color && !seen.has(nk)) {
        stack.push(n);
      }
    }
  }
  return { color, stones: Array.from(seen).sort(), liberties };
}

function uniqueAdjacentGroups(board: Map<string, "B" | "W">, boardSize: number, xy: { x: number; y: number }, color: "B" | "W"): GroupInfo[] {
  const out: GroupInfo[] = [];
  const seen = new Set<string>();
  for (const n of neighbors(xy.x, xy.y, boardSize)) {
    if (board.get(key(n.x, n.y)) !== color) {
      continue;
    }
    const group = collectGroup(board, boardSize, n);
    if (group == null) {
      continue;
    }
    const sig = group.stones.join("|");
    if (!seen.has(sig)) {
      seen.add(sig);
      out.push(group);
    }
  }
  return out;
}

function addTag(tags: ProductConceptTagEvidenceV1[], tag: ProductConceptTagV1, confidence: ProductEventConfidenceV1, evidence: string[], caveats: string[]): void {
  if (tags.some((t) => t.tag === tag)) {
    return;
  }
  tags.push({ tag, confidence, evidence, caveats });
}

function addForbidden(claims: ProductForbiddenConceptClaimV1[], concept: ProductConceptTagV1, reason: string): void {
  if (claims.some((c) => c.concept === concept && c.reason === reason)) {
    return;
  }
  claims.push({ concept, reason });
}

function hasLossContext(input: ConceptTaggerInputV1): boolean {
  return (input.scoreLoss ?? 0) > 0 || (input.winrateLoss ?? 0) > 0;
}

export function tagConceptsV1(input: ConceptTaggerInputV1): ConceptTaggerOutputV1 {
  const tags: ProductConceptTagEvidenceV1[] = [];
  const forbiddenConceptClaims: ProductForbiddenConceptClaimV1[] = [];
  const boardSize = Number.isInteger(input.boardSize) && input.boardSize >= 2 ? input.boardSize : 19;
  const targetMove = input.recommendedMove ?? input.playedMove;
  const xy = moveToXy(targetMove, boardSize);
  const board = buildBoard(input.stonesBefore);
  const ownershipAvailable = input.ownershipSummary?.available === true;

  if (!ownershipAvailable) {
    addForbidden(forbiddenConceptClaims, "invasion", "ownership_evidence_unavailable");
    addForbidden(forbiddenConceptClaims, "reduction", "ownership_evidence_unavailable");
  }
  if (input.ladderEvidence !== true) {
    addForbidden(forbiddenConceptClaims, "ladder_risk", "ladder_reading_unavailable");
  }

  if (xy == null || board.has(key(xy.x, xy.y))) {
    addForbidden(forbiddenConceptClaims, "life_and_death_context", "insufficient_liberty_evidence");
  } else {
    const ownGroups = uniqueAdjacentGroups(board, boardSize, xy, input.player);
    const opponentGroups = uniqueAdjacentGroups(board, boardSize, xy, other(input.player));
    const ownGroupCount = ownGroups.length;
    const opponentGroupCount = opponentGroups.length;
    const adjacentEvidence = [`targetMove=${targetMove}`, `ownAdjacentGroups=${ownGroupCount}`, `opponentAdjacentGroups=${opponentGroupCount}`];

    if (ownGroupCount >= 2) {
      addTag(tags, "connection", "medium", adjacentEvidence, ["adjacency_heuristic_only"]);
    }
    if (opponentGroupCount >= 2 && ownGroupCount >= 1) {
      addTag(tags, "cut", "medium", adjacentEvidence, ["adjacency_heuristic_only"]);
    }

    const opponentWithTargetLiberty = opponentGroups.filter((g) => g.liberties.has(key(xy.x, xy.y)));
    if (opponentWithTargetLiberty.some((g) => g.liberties.size === 1)) {
      addTag(tags, "capture", "medium", [`targetMove=${targetMove}`, "adjacent_opponent_group_last_liberty"], ["capture_reading_is_local_only"]);
    } else if (opponentWithTargetLiberty.some((g) => g.liberties.size === 2)) {
      addTag(tags, "atari", "low", [`targetMove=${targetMove}`, "adjacent_opponent_group_two_liberties"], ["atari_reading_is_local_only"]);
    }

    const lowLibertyGroups = [...ownGroups, ...opponentGroups].filter((g) => g.liberties.size <= 2);
    if (lowLibertyGroups.length > 0 && hasLossContext(input)) {
      addTag(tags, "life_and_death_context", "low", [`targetMove=${targetMove}`, `lowLibertyAdjacentGroups=${lowLibertyGroups.length}`], ["not_a_life_and_death_reading"]);
    } else {
      addForbidden(forbiddenConceptClaims, "life_and_death_context", "insufficient_liberty_evidence");
    }
  }

  if (ownershipAvailable && input.ownershipSummary?.pattern === "invasion") {
    addTag(tags, "invasion", "medium", ["ownership_pattern=invasion"], ["ownership_summary_only"]);
  }
  if (ownershipAvailable && input.ownershipSummary?.pattern === "reduction") {
    addTag(tags, "reduction", "medium", ["ownership_pattern=reduction"], ["ownership_summary_only"]);
  }
  if (ownershipAvailable && input.ownershipSummary?.pattern === "territory_defense") {
    addTag(tags, "territory_defense", "medium", ["ownership_pattern=territory_defense"], ["ownership_summary_only"]);
  }
  if (input.ladderEvidence === true) {
    addTag(tags, "ladder_risk", "medium", ["ladder_evidence=true"], ["ladder_high_confidence_disabled_v1"]);
  }

  if (input.totalMoves != null && input.totalMoves > 0) {
    const phase = input.turnIndex / input.totalMoves;
    if (input.turnIndex >= 180 || phase >= 0.75) {
      addTag(tags, "endgame", input.turnIndex >= 220 || phase >= 0.85 ? "medium" : "low", [`turnIndex=${input.turnIndex}`, `totalMoves=${input.totalMoves}`], ["phase_only"]);
    }
  }

  return { version: CONCEPT_TAGGER_V1_VERSION, conceptTagsV1: tags, forbiddenConceptClaims };
}

export function buildConceptTaggerInputFromMoveV1(args: {
  move: ProductDecisiveMoveV1 | ProductReviewMoveV1;
  sgfText?: string | null;
  totalMoves?: number | null;
  boardSize?: number | null;
  ownershipSummary?: ConceptTaggerOwnershipSummaryV1 | null;
  ladderEvidence?: boolean;
}): ConceptTaggerInputV1 {
  const boardSize = args.boardSize ?? 19;
  const playback =
    args.sgfText != null && args.sgfText.trim().length > 0
      ? buildSgfPlaybackStateV1({ sgfText: args.sgfText, selectedTurnIndex: Math.max(0, args.move.turnIndex - 1), totalMovesHint: args.totalMoves ?? null })
      : null;
  return {
    boardSize: playback?.boardSize ?? boardSize,
    stonesBefore: playback?.stones ?? [],
    turnIndex: args.move.turnIndex,
    totalMoves: args.totalMoves ?? playback?.totalMoves ?? null,
    player: args.move.player,
    playedMove: args.move.playedMove,
    recommendedMove: args.move.recommendedMove,
    pv: args.move.evidence.pv ?? [],
    scoreLoss: args.move.scoreLoss,
    winrateLoss: args.move.winrateLoss,
    ownershipSummary: args.ownershipSummary,
    ladderEvidence: args.ladderEvidence,
  };
}

export function attachConceptTagsToProductMoveV1<T extends ProductMoveWithConceptsV1>(
  move: T,
  input: Omit<Parameters<typeof buildConceptTaggerInputFromMoveV1>[0], "move">
): T {
  const result = tagConceptsV1(buildConceptTaggerInputFromMoveV1({ ...input, move }));
  return {
    ...move,
    conceptTagsV1: result.conceptTagsV1,
    forbiddenConceptClaims: result.forbiddenConceptClaims,
  };
}
