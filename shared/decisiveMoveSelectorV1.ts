import type { AdiV1Result } from "./adiV1";
import type { AnalysisLearningEventsV1 } from "./analysisLearningEventsV1";
import type { BsiV1Result } from "./bsiV1";
import type { DeepSearchResultsV1Result } from "./deepSearchResultsV1";
import type { ProductColorV1, ProductDecisiveMoveV1, ProductEventConfidenceV1, ProductEventEvidenceSourceV1, ProductGameResultV1 } from "./analysisProductEventsV1";
import { isProductDecisiveMoveV1 } from "./analysisProductEventsV1";
import type { TurnAnalysisEntryV1, TurnAnalysisEntrySuccessV1 } from "./multiTurnKatagoAnalysisV1";
import type { WinrateTimelineV1 } from "./winrateTimelineV1";

export type BuildProductDecisiveMoveV1Input = {
  gameResult: ProductGameResultV1 | null | undefined;
  learningEvents?: AnalysisLearningEventsV1 | null;
  turnAnalyses?: TurnAnalysisEntryV1[] | null;
  bsi?: BsiV1Result | null;
  adi?: AdiV1Result | null;
  deepSearchResults?: DeepSearchResultsV1Result | null;
  winrateTimeline?: WinrateTimelineV1 | null;
  totalMoves?: number | null;
};

type Candidate = {
  turnIndex: number;
  player: ProductColorV1 | null;
  playedMove: string | null;
  recommendedMove: string | null;
  scoreLoss: number | null;
  winrateLoss: number | null;
  sourceEventId: string | null;
  evidenceSource: Set<ProductEventEvidenceSourceV1>;
  notes: Set<string>;
  pv: string[];
  score: number;
  signalCount: number;
  finalPosition: boolean;
};

function finiteNonNegative(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function finiteWinrateLoss(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

function positiveContribution(v: number | null, cap: number): number {
  if (v == null || cap <= 0) {
    return 0;
  }
  return Math.min(1, v / cap);
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function asProductColor(v: unknown): ProductColorV1 | null {
  return v === "B" || v === "W" ? v : null;
}

function pushUnique(target: string[], values: readonly string[] | undefined): void {
  if (!Array.isArray(values)) {
    return;
  }
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0 && !target.includes(v)) {
      target.push(v);
    }
  }
}

function candidateFor(map: Map<number, Candidate>, turnIndex: number): Candidate {
  let candidate = map.get(turnIndex);
  if (candidate == null) {
    candidate = {
      turnIndex,
      player: null,
      playedMove: null,
      recommendedMove: null,
      scoreLoss: null,
      winrateLoss: null,
      sourceEventId: null,
      evidenceSource: new Set(),
      notes: new Set(),
      pv: [],
      score: 0,
      signalCount: 0,
      finalPosition: false,
    };
    map.set(turnIndex, candidate);
  }
  return candidate;
}

function addSource(candidate: Candidate, source: ProductEventEvidenceSourceV1): void {
  candidate.evidenceSource.add(source);
}

function addScoreLoss(candidate: Candidate, value: unknown): void {
  const loss = finiteNonNegative(value);
  if (loss == null) {
    return;
  }
  candidate.scoreLoss = maxNullable(candidate.scoreLoss, loss);
  candidate.score += positiveContribution(loss, 10) * 40;
  candidate.signalCount += 1;
}

function addWinrateLoss(candidate: Candidate, value: unknown): void {
  const loss = finiteWinrateLoss(value);
  if (loss == null) {
    return;
  }
  candidate.winrateLoss = maxNullable(candidate.winrateLoss, loss);
  candidate.score += positiveContribution(loss, 0.2) * 35;
  candidate.signalCount += 1;
}

function addBsi(candidate: Candidate, value: unknown): void {
  const bsi = finiteNonNegative(value);
  if (bsi == null) {
    return;
  }
  candidate.score += positiveContribution(bsi, 100) * 25;
  candidate.signalCount += 1;
  addSource(candidate, "bsiV1");
}

function addAdi(candidate: Candidate, value: unknown): void {
  const adi = finiteNonNegative(value);
  if (adi == null) {
    return;
  }
  candidate.score += positiveContribution(adi, 1) * 20;
  candidate.signalCount += 1;
  addSource(candidate, "adiV1");
}

function setCandidateIdentity(
  candidate: Candidate,
  fields: { player?: ProductColorV1 | null; playedMove?: string | null; recommendedMove?: string | null }
): void {
  if (candidate.player == null && fields.player != null) {
    candidate.player = fields.player;
  }
  if (candidate.playedMove == null && typeof fields.playedMove === "string") {
    candidate.playedMove = fields.playedMove;
  }
  if (candidate.recommendedMove == null && typeof fields.recommendedMove === "string") {
    candidate.recommendedMove = fields.recommendedMove;
  }
}

function scoreLossFromTurn(turn: TurnAnalysisEntrySuccessV1): number | null {
  const best = turn.moveSummary?.best;
  const played = turn.moveSummary?.played;
  if (typeof best?.scoreLead === "number" && Number.isFinite(best.scoreLead) && typeof played?.scoreLead === "number" && Number.isFinite(played.scoreLead)) {
    return Math.max(0, best.scoreLead - played.scoreLead);
  }
  if (typeof best?.scoreMean === "number" && Number.isFinite(best.scoreMean) && typeof played?.scoreMean === "number" && Number.isFinite(played.scoreMean)) {
    return Math.max(0, best.scoreMean - played.scoreMean);
  }
  return null;
}

function winrateLossFromTurn(turn: TurnAnalysisEntrySuccessV1): number | null {
  const best = turn.moveSummary?.best?.winrate;
  const played = turn.moveSummary?.played?.winrate;
  if (typeof best !== "number" || !Number.isFinite(best) || typeof played !== "number" || !Number.isFinite(played)) {
    return null;
  }
  return Math.max(0, Math.min(1, best - played));
}

function confidenceFor(candidate: Candidate): ProductEventConfidenceV1 {
  const sources = candidate.evidenceSource.size;
  if (candidate.score >= 75 || (sources >= 4 && candidate.signalCount >= 4)) {
    return "high";
  }
  if (candidate.score >= 35 || sources >= 2 || candidate.signalCount >= 2) {
    return "medium";
  }
  return "low";
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.evidenceSource.size !== a.evidenceSource.size) return b.evidenceSource.size - a.evidenceSource.size;
  if (b.signalCount !== a.signalCount) return b.signalCount - a.signalCount;
  return b.turnIndex - a.turnIndex;
}

function isFinalPosition(candidate: Candidate, totalMoves: number | null | undefined): boolean {
  return candidate.finalPosition || (typeof totalMoves === "number" && Number.isInteger(totalMoves) && totalMoves > 0 && candidate.turnIndex === totalMoves);
}

export function buildProductDecisiveMoveV1(input: BuildProductDecisiveMoveV1Input): ProductDecisiveMoveV1 | null {
  const loserColor = input.gameResult?.loserColor;
  if (loserColor !== "B" && loserColor !== "W") {
    return null;
  }

  const candidates = new Map<number, Candidate>();

  for (const event of input.learningEvents?.events ?? []) {
    const candidate = candidateFor(candidates, event.turnIndex);
    setCandidateIdentity(candidate, {
      playedMove: event.playedMove,
      recommendedMove: event.candidateMove,
    });
    addSource(candidate, "learningEventsV1");
    candidate.sourceEventId ??= event.id;
    addBsi(candidate, event.signals.bsiScore);
    addAdi(candidate, event.signals.adiScore);
    addWinrateLoss(candidate, event.signals.winrateDelta == null ? null : Math.abs(event.signals.winrateDelta));
    addScoreLoss(candidate, event.signals.scoreLeadDelta == null ? null : Math.abs(event.signals.scoreLeadDelta));
    if (event.signals.deepSearchCompleted === true || event.signals.deepSearchChangedTop === true) {
      addSource(candidate, "deepSearchResultsV1");
      candidate.score += event.signals.deepSearchChangedTop === true ? 18 : 10;
      candidate.signalCount += 1;
    }
    pushUnique(candidate.pv, event.evidence.pv);
    pushUnique(candidate.pv, event.evidence.deepSearchPv);
  }

  for (const turn of input.turnAnalyses ?? []) {
    const candidate = candidateFor(candidates, turn.turnIndex);
    const player = asProductColor(turn.player);
    setCandidateIdentity(candidate, {
      player,
      playedMove: turn.playedMove,
      recommendedMove: turn.status === "ok" ? turn.comparisonReady.bestMove : null,
    });
    if (turn.reason === "final_position") {
      candidate.finalPosition = true;
    }
    if (turn.status === "ok") {
      addSource(candidate, "turnAnalyses");
      addScoreLoss(candidate, scoreLossFromTurn(turn));
      addWinrateLoss(candidate, winrateLossFromTurn(turn));
    }
  }

  for (const signal of input.bsi?.signals ?? []) {
    const candidate = candidateFor(candidates, signal.turnIndex);
    setCandidateIdentity(candidate, {
      player: asProductColor(signal.player),
      playedMove: signal.playedMove,
      recommendedMove: signal.bestMove,
    });
    addBsi(candidate, signal.bsiScore);
    addScoreLoss(candidate, signal.scoreBestMinusPlayed ?? signal.scoreDelta);
    addWinrateLoss(candidate, signal.winrateBestMinusPlayed ?? signal.winrateDelta);
  }

  for (const signal of input.adi?.signals ?? []) {
    const candidate = candidateFor(candidates, signal.turnIndex);
    setCandidateIdentity(candidate, {
      player: asProductColor(signal.player),
      playedMove: signal.playedMove,
      recommendedMove: signal.bestMove,
    });
    addAdi(candidate, signal.adiScore);
    if (signal.deepSearchCandidate) {
      candidate.score += 8;
      candidate.signalCount += 1;
    }
  }

  for (const result of input.deepSearchResults?.results ?? []) {
    const candidate = candidateFor(candidates, result.turnIndex);
    setCandidateIdentity(candidate, {
      player: asProductColor(result.player),
      playedMove: result.playedMove,
      recommendedMove: result.status === "ok" ? result.comparison.deepBestMove ?? result.plannedBestMove : result.plannedBestMove,
    });
    if (result.status === "ok") {
      addSource(candidate, "deepSearchResultsV1");
      candidate.score += result.comparison.plannedBestMoveStillTop === false ? 18 : 10;
      candidate.signalCount += 1;
    }
  }

  const points = input.winrateTimeline?.points ?? [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const point = points[i]!;
    if (point.status !== "ok" || prev.status !== "ok" || typeof point.rawWinrate !== "number" || typeof prev.rawWinrate !== "number") {
      continue;
    }
    const candidate = candidateFor(candidates, point.turnIndex);
    setCandidateIdentity(candidate, {
      player: asProductColor(point.player),
      playedMove: point.playedMove,
    });
    addSource(candidate, "winrateTimelineV1");
    addWinrateLoss(candidate, Math.abs(point.rawWinrate - prev.rawWinrate));
  }

  const eligible = Array.from(candidates.values())
    .filter((candidate) => candidate.player === loserColor)
    .filter((candidate) => !isFinalPosition(candidate, input.totalMoves))
    .filter((candidate) => candidate.evidenceSource.size > 0)
    .sort(compareCandidates);

  const selected = eligible[0];
  if (selected == null) {
    return null;
  }

  const output: ProductDecisiveMoveV1 = {
    turnIndex: selected.turnIndex,
    player: loserColor,
    playedMove: selected.playedMove,
    recommendedMove: selected.recommendedMove,
    scoreLoss: selected.scoreLoss,
    winrateLoss: selected.winrateLoss,
    confidence: confidenceFor(selected),
    sourceEventId: selected.sourceEventId,
    evidence: {
      source: Array.from(selected.evidenceSource).sort(),
      notes: Array.from(selected.notes),
      pv: selected.pv,
    },
  };

  return isProductDecisiveMoveV1(output) ? output : null;
}
