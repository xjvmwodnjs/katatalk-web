import type {
  AnalysisPlanCandidateReasonV1,
  AnalysisPlanCandidateTurnV1,
  AnalysisPlanV1,
  BuildAnalysisPlanV1Options,
} from "@shared/analysisPlanV1";
import { ANALYSIS_PLAN_V1_VERSION } from "@shared/analysisPlanV1";
import {
  parseMinimalSgfForSmoke,
  sgfPointToGtp,
  type ParsedMinimalSgf,
} from "./worker/analysisEngines/katagoSgfQuery";

export type { AnalysisPlanV1, BuildAnalysisPlanV1Options } from "@shared/analysisPlanV1";

/** 전체 수순 메타 (후보 선정·추후 파이프라인용) */
export type EnrichedMoveV1 = {
  turnIndex: number;
  player: "B" | "W";
  move: string;
  gtpMove: string;
  sgfPoint: string;
};

export function buildEnrichedMovesFromParsed(parsed: ParsedMinimalSgf): EnrichedMoveV1[] {
  const { boardSize, moves } = parsed;
  return moves.map((mv, idx) => {
    const gtp = sgfPointToGtp(mv.sgfPoint, boardSize);
    return {
      turnIndex: idx + 1,
      player: mv.color,
      move: gtp,
      gtpMove: gtp,
      sgfPoint: mv.sgfPoint,
    };
  });
}

/**
 * 간격 샘플 + 마지막 국면 필수. openingTurnCutoff 이하이면 `opening_sample`·낮은 priority.
 * 후보 수가 maxTurns 를 넘으면 priority 가 낮은 것부터 제거(단 `final_position` 은 유지).
 */
export function buildCandidateTurnsV1(
  parsed: ParsedMinimalSgf,
  opts: BuildAnalysisPlanV1Options = {}
): AnalysisPlanCandidateTurnV1[] {
  const maxTurns = opts.maxTurns ?? 20;
  const includeFinal = opts.includeFinalPosition !== false;
  const intervalStep = opts.intervalStep ?? 20;
  const openingCutoff = opts.openingTurnCutoff ?? 20;
  const n = parsed.moves.length;
  const moves = parsed.moves;
  const boardSize = parsed.boardSize;

  const byTurn = new Map<number, AnalysisPlanCandidateTurnV1>();

  function upsert(turnIndex: number, reason: AnalysisPlanCandidateReasonV1, priority: number): void {
    if (turnIndex < 1 || turnIndex > n) {
      return;
    }
    const mv = moves[turnIndex - 1]!;
    const gtp = sgfPointToGtp(mv.sgfPoint, boardSize);
    const row: AnalysisPlanCandidateTurnV1 = {
      turnIndex,
      player: mv.color,
      move: gtp,
      gtpMove: gtp,
      reason,
      priority,
    };
    const prev = byTurn.get(turnIndex);
    if (prev == null || prev.priority < priority) {
      byTurn.set(turnIndex, row);
    }
  }

  if (includeFinal && n > 0) {
    upsert(n, "final_position", 1.0);
  }

  for (let k = intervalStep; k <= n; k += intervalStep) {
    if (includeFinal && k === n) {
      continue;
    }
    const reason: AnalysisPlanCandidateReasonV1 =
      k <= openingCutoff ? "opening_sample" : "interval_sample";
    const priority = k <= openingCutoff ? 0.25 : 0.5;
    upsert(k, reason, priority);
  }

  const finals = Array.from(byTurn.values()).filter(c => c.reason === "final_position");
  const nonFinal = Array.from(byTurn.values()).filter(c => c.reason !== "final_position");
  let combined = [...finals, ...nonFinal];

  if (combined.length > maxTurns) {
    nonFinal.sort((a, b) => a.priority - b.priority || a.turnIndex - b.turnIndex);
    while (finals.length + nonFinal.length > maxTurns) {
      nonFinal.shift();
    }
    combined = [...finals, ...nonFinal];
  }

  combined.sort((a, b) => a.turnIndex - b.turnIndex);
  return combined;
}

export function buildAnalysisPlanV1FromParsed(
  parsed: ParsedMinimalSgf,
  opts: BuildAnalysisPlanV1Options = {}
): AnalysisPlanV1 {
  const intervalStep = opts.intervalStep ?? 20;
  const openingCutoff = opts.openingTurnCutoff ?? 20;
  const maxTurns = opts.maxTurns ?? 20;
  const includeFinal = opts.includeFinalPosition !== false;
  return {
    version: ANALYSIS_PLAN_V1_VERSION,
    totalMoves: parsed.moves.length,
    boardSize: parsed.boardSize,
    komi: parsed.komi,
    candidateTurns: buildCandidateTurnsV1(parsed, opts),
    strategy: {
      mode: opts.mode ?? "light",
      maxTurns,
      includeFinalPosition: includeFinal,
      intervalStep,
      openingTurnCutoff: openingCutoff,
    },
  };
}

export function buildAnalysisPlanV1FromSgf(
  sgf: string,
  opts: BuildAnalysisPlanV1Options = {}
): AnalysisPlanV1 {
  return buildAnalysisPlanV1FromParsed(parseMinimalSgfForSmoke(sgf), opts);
}
