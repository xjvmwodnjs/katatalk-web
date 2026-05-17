import type { AdiV1Result } from "./adiV1";
import type { AnalysisLearningEventsV1, AnalysisLearningEventV1 } from "./analysisLearningEventsV1";
import type { BsiV1Result } from "./bsiV1";
import type { DeepSearchResultsV1Result } from "./deepSearchResultsV1";
import type {
  ProductColorV1,
  ProductDecisiveMoveV1,
  ProductEventConfidenceV1,
  ProductEventEvidenceSourceV1,
  ProductEvidenceTypeV25,
  ProductKeyMoveTaxonomyV25,
  ProductGameResultV1,
  ProductReviewMoveCategoryV1,
  ProductReviewMoveV1,
} from "./analysisProductEventsV1";
import { isProductReviewMoveV1 } from "./analysisProductEventsV1";
import type { TurnAnalysisEntrySuccessV1, TurnAnalysisEntryV1 } from "./multiTurnKatagoAnalysisV1";
import type { WinrateTimelineV1 } from "./winrateTimelineV1";

export type BuildProductReviewMovesV1Input = {
  gameResult?: ProductGameResultV1 | null;
  decisiveMove?: ProductDecisiveMoveV1 | null;
  learningEvents?: AnalysisLearningEventsV1 | null;
  turnAnalyses?: TurnAnalysisEntryV1[] | null;
  bsi?: BsiV1Result | null;
  adi?: AdiV1Result | null;
  deepSearchResults?: DeepSearchResultsV1Result | null;
  winrateTimeline?: WinrateTimelineV1 | null;
  totalMoves?: number | null;
  maxMoves?: number | null;
};

type Candidate = {
  turnIndex: number;
  player: ProductColorV1 | null;
  playedMove: string | null;
  recommendedMove: string | null;
  scoreLoss: number | null;
  winrateLoss: number | null;
  category: ProductReviewMoveCategoryV1;
  sourceEventId: string | null;
  evidenceSource: Set<ProductEventEvidenceSourceV1>;
  notes: Set<string>;
  pv: string[];
  score: number;
  ranking: RankingBreakdown;
  evidenceTypes: Set<ProductEvidenceTypeV25>;
  signalCount: number;
  finalPosition: boolean;
};

type RankingBreakdown = {
  scoreLoss: number;
  winrateLoss: number;
  playedMoveRank: number;
  bsi: number;
  adi: number;
  deepSearch: number;
  volatility: number;
  explainability: number;
  openingPenalty: number;
  duplicatePenalty: number;
};

function asProductColor(v: unknown): ProductColorV1 | null {
  return v === "B" || v === "W" ? v : null;
}

function finitePositive(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function finitePositiveWinrate(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1 ? v : null;
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function contribution(value: number | null, cap: number): number {
  if (value == null || cap <= 0) return 0;
  return Math.min(1, value / cap);
}

function pushUnique(target: string[], values: readonly string[] | undefined): void {
  if (!Array.isArray(values)) return;
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
      category: "learning_candidate",
      sourceEventId: null,
      evidenceSource: new Set(),
      notes: new Set(),
      pv: [],
      score: 0,
      ranking: {
        scoreLoss: 0,
        winrateLoss: 0,
        playedMoveRank: 0,
        bsi: 0,
        adi: 0,
        deepSearch: 0,
        volatility: 0,
        explainability: 0,
        openingPenalty: 0,
        duplicatePenalty: 0,
      },
      evidenceTypes: new Set(),
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

function addEvidenceType(candidate: Candidate, type: ProductEvidenceTypeV25): void {
  candidate.evidenceTypes.add(type);
}

function addRanking(candidate: Candidate, key: keyof RankingBreakdown, value: number): void {
  candidate.ranking[key] += value;
  candidate.score += value;
}

function setIdentity(
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

function preferCategory(candidate: Candidate, category: ProductReviewMoveCategoryV1, priority: number): void {
  const currentPriority = categoryPriority(candidate.category);
  if (priority >= currentPriority) {
    candidate.category = category;
  }
}

function taxonomyFor(candidate: Candidate): ProductKeyMoveTaxonomyV25 {
  switch (candidate.category) {
    case "score_shift_candidate":
    case "winrate_shift_candidate":
    case "flow_shift_candidate":
    case "response_candidate":
      return candidate.scoreLoss != null || candidate.winrateLoss != null ? "swing_candidate" : "learning_candidate";
    case "shape_review_candidate":
      return "shape_review_candidate";
    case "direction_candidate":
      return "direction_candidate";
    case "deep_search_candidate":
      return "deep_search_candidate";
    case "volatility_candidate":
      return "volatility_candidate";
    case "learning_candidate":
      return "learning_candidate";
  }
}

function categoryPriority(category: ProductReviewMoveCategoryV1): number {
  switch (category) {
    case "score_shift_candidate":
      return 80;
    case "winrate_shift_candidate":
      return 75;
    case "deep_search_candidate":
      return 65;
    case "volatility_candidate":
      return 55;
    case "flow_shift_candidate":
      return 50;
    case "response_candidate":
      return 45;
    case "direction_candidate":
      return 40;
    case "shape_review_candidate":
      return 35;
    case "learning_candidate":
      return 10;
  }
}

function addScoreLoss(candidate: Candidate, value: unknown): void {
  const loss = finitePositive(value);
  if (loss == null) return;
  candidate.scoreLoss = maxNullable(candidate.scoreLoss, loss);
  addEvidenceType(candidate, "loss_evidence");
  addRanking(candidate, "scoreLoss", contribution(loss, 10) * 35);
  candidate.signalCount += 1;
  preferCategory(candidate, "score_shift_candidate", 80);
}

function addWinrateLoss(candidate: Candidate, value: unknown): void {
  const loss = finitePositiveWinrate(value);
  if (loss == null) return;
  candidate.winrateLoss = maxNullable(candidate.winrateLoss, loss);
  addEvidenceType(candidate, "loss_evidence");
  addRanking(candidate, "winrateLoss", contribution(loss, 0.2) * 30);
  candidate.signalCount += 1;
  preferCategory(candidate, "winrate_shift_candidate", 75);
}

function addBsi(candidate: Candidate, value: unknown): void {
  const score = finitePositive(value);
  if (score == null) return;
  addSource(candidate, "bsiV1");
  addEvidenceType(candidate, "search_evidence");
  addRanking(candidate, "bsi", contribution(score, 100) * 20);
  candidate.signalCount += 1;
}

function addAdi(candidate: Candidate, value: unknown): void {
  const score = finitePositive(value);
  if (score == null) return;
  addSource(candidate, "adiV1");
  addEvidenceType(candidate, "learning_context");
  addRanking(candidate, "adi", contribution(score, 1) * 24);
  candidate.signalCount += 1;
  preferCategory(candidate, "learning_candidate", 30);
}

function addPlayedMoveRank(candidate: Candidate, value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 1) return;
  addEvidenceType(candidate, "search_evidence");
  addRanking(candidate, "playedMoveRank", contribution(value - 1, 6) * 10);
}

function addExplainability(candidate: Candidate): void {
  if (candidate.playedMove != null && candidate.recommendedMove != null && candidate.playedMove !== candidate.recommendedMove) {
    addRanking(candidate, "explainability", 3);
  }
}

function applyOpeningNoisePenalty(candidate: Candidate): void {
  if (candidate.turnIndex > 0 && candidate.turnIndex <= 6 && candidate.scoreLoss == null && candidate.winrateLoss == null) {
    addRanking(candidate, "openingPenalty", -8);
  }
}

function isPassOrInvalidMove(move: string | null): boolean {
  if (move == null) return false;
  const normalized = move.trim().toLowerCase();
  return normalized === "" || normalized === "pass" || normalized === "tt";
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

function learningCategory(event: AnalysisLearningEventV1): ProductReviewMoveCategoryV1 {
  switch (event.eventType) {
    case "response_candidate":
      return "response_candidate";
    case "flow_shift_candidate":
      return "flow_shift_candidate";
    case "deep_search_candidate":
      return "deep_search_candidate";
    case "winrate_shift_candidate":
      return "winrate_shift_candidate";
    case "score_lead_shift_candidate":
      return "score_shift_candidate";
    default:
      return "learning_candidate";
  }
}

function confidenceFor(candidate: Candidate): ProductEventConfidenceV1 {
  if (candidate.score >= 70 || candidate.evidenceSource.size >= 4) return "high";
  if (candidate.score >= 30 || candidate.evidenceSource.size >= 2 || candidate.signalCount >= 2) return "medium";
  return "low";
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.evidenceSource.size !== a.evidenceSource.size) return b.evidenceSource.size - a.evidenceSource.size;
  if (b.signalCount !== a.signalCount) return b.signalCount - a.signalCount;
  return b.turnIndex - a.turnIndex;
}

function isFinal(candidate: Candidate, totalMoves: number | null | undefined): boolean {
  return candidate.finalPosition || (typeof totalMoves === "number" && Number.isInteger(totalMoves) && totalMoves > 0 && candidate.turnIndex === totalMoves);
}

function normalizeMaxMoves(v: number | null | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 5;
  return Math.max(0, Math.min(5, Math.trunc(v)));
}

function diversify(sorted: Candidate[], maxMoves: number): Candidate[] {
  if (maxMoves <= 0) return [];
  const selected: Candidate[] = [];
  const used = new Set<number>();
  const first = sorted[0];
  if (first != null) {
    selected.push(first);
    used.add(first.turnIndex);
  }
  const hasBothColors = sorted.some((c) => c.player === "B") && sorted.some((c) => c.player === "W");
  if (hasBothColors && selected.length < maxMoves) {
    const selectedColors = new Set(selected.map((c) => c.player));
    const other = sorted.find((c) => !used.has(c.turnIndex) && !selectedColors.has(c.player));
    if (other != null) {
      selected.push(other);
      used.add(other.turnIndex);
    }
  }
  for (const candidate of sorted) {
    if (selected.length >= maxMoves) break;
    if (used.has(candidate.turnIndex)) continue;
    selected.push(candidate);
    used.add(candidate.turnIndex);
  }
  return selected.sort(compareCandidates);
}

export function buildProductReviewMovesV1(input: BuildProductReviewMovesV1Input): ProductReviewMoveV1[] {
  const maxMoves = normalizeMaxMoves(input.maxMoves);
  if (maxMoves <= 0) return [];

  const candidates = new Map<number, Candidate>();
  const decisiveTurnIndex = input.decisiveMove?.turnIndex ?? null;

  for (const event of input.learningEvents?.events ?? []) {
    const candidate = candidateFor(candidates, event.turnIndex);
    setIdentity(candidate, {
      playedMove: event.playedMove,
      recommendedMove: event.candidateMove,
    });
    candidate.sourceEventId ??= event.id;
    addSource(candidate, "learningEventsV1");
    addEvidenceType(candidate, "learning_context");
    addRanking(candidate, "explainability", contribution(event.score, 100) * 15);
    candidate.signalCount += 1;
    preferCategory(candidate, learningCategory(event), categoryPriority(learningCategory(event)));
    addScoreLoss(candidate, event.signals.scoreLeadDelta == null ? null : Math.abs(event.signals.scoreLeadDelta));
    addBsi(candidate, event.signals.bsiScore);
    addAdi(candidate, event.signals.adiScore);
    if (event.signals.winrateDelta != null) {
      candidate.notes.add("learningEvents winrateDelta is context only in reviewMovesV1");
    }
    if (event.signals.deepSearchCompleted === true || event.signals.deepSearchChangedTop === true) {
      addSource(candidate, "deepSearchResultsV1");
      addEvidenceType(candidate, "deep_search_context");
      addRanking(candidate, "deepSearch", event.signals.deepSearchChangedTop === true ? 18 : 10);
      candidate.signalCount += 1;
      preferCategory(candidate, "deep_search_candidate", 65);
    }
    pushUnique(candidate.pv, event.evidence.pv);
    pushUnique(candidate.pv, event.evidence.deepSearchPv);
  }

  for (const turn of input.turnAnalyses ?? []) {
    const candidate = candidateFor(candidates, turn.turnIndex);
    setIdentity(candidate, {
      player: asProductColor(turn.player),
      playedMove: turn.playedMove,
      recommendedMove: turn.status === "ok" ? turn.comparisonReady?.bestMove ?? null : null,
    });
    if (turn.reason === "final_position") {
      candidate.finalPosition = true;
    }
    if (turn.status === "ok") {
      addSource(candidate, "turnAnalyses");
      addScoreLoss(candidate, scoreLossFromTurn(turn));
      addWinrateLoss(candidate, winrateLossFromTurn(turn));
      addPlayedMoveRank(candidate, turn.comparisonReady?.playedMoveRank);
      addExplainability(candidate);
    }
  }

  for (const signal of input.bsi?.signals ?? []) {
    const candidate = candidateFor(candidates, signal.turnIndex);
    setIdentity(candidate, {
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
    setIdentity(candidate, {
      player: asProductColor(signal.player),
      playedMove: signal.playedMove,
      recommendedMove: signal.bestMove,
    });
    addAdi(candidate, signal.adiScore);
    if (signal.deepSearchCandidate) {
      addRanking(candidate, "deepSearch", 6);
      candidate.signalCount += 1;
    }
  }

  for (const result of input.deepSearchResults?.results ?? []) {
    const candidate = candidateFor(candidates, result.turnIndex);
    setIdentity(candidate, {
      player: asProductColor(result.player),
      playedMove: result.playedMove,
      recommendedMove: result.status === "ok" ? result.comparison.deepBestMove ?? result.plannedBestMove : result.plannedBestMove,
    });
    if (result.status === "ok") {
      addSource(candidate, "deepSearchResultsV1");
      addEvidenceType(candidate, "deep_search_context");
      addRanking(candidate, "deepSearch", result.comparison.plannedBestMoveStillTop === false ? 24 : 16);
      addPlayedMoveRank(candidate, result.comparison.playedMoveRank);
      candidate.signalCount += 1;
      preferCategory(candidate, "deep_search_candidate", 65);
    }
  }

  const points = input.winrateTimeline?.points ?? [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const point = points[i]!;
    if (point.status !== "ok") continue;
    const candidate = candidateFor(candidates, point.turnIndex);
    setIdentity(candidate, {
      player: asProductColor(point.player),
      playedMove: point.playedMove,
    });
    addSource(candidate, "winrateTimelineV1");
    addEvidenceType(candidate, "volatility_context");
    candidate.notes.add("raw timeline delta is volatility context, not product winrateLoss");
    preferCategory(candidate, "volatility_candidate", 55);
    if (prev.status === "ok" && typeof point.rawWinrate === "number" && Number.isFinite(point.rawWinrate) && typeof prev.rawWinrate === "number" && Number.isFinite(prev.rawWinrate)) {
      addRanking(candidate, "volatility", contribution(Math.abs(point.rawWinrate - prev.rawWinrate), 0.2) * 18);
      candidate.signalCount += 1;
    }
  }

  for (const candidate of Array.from(candidates.values())) {
    applyOpeningNoisePenalty(candidate);
    if (candidate.pv.length === 0) {
      candidate.notes.add("reference PV is unavailable; keep review wording provisional");
    }
  }

  const sorted = Array.from(candidates.values())
    .filter((candidate) => candidate.player === "B" || candidate.player === "W")
    .filter((candidate) => !isPassOrInvalidMove(candidate.playedMove))
    .filter((candidate) => candidate.turnIndex !== decisiveTurnIndex)
    .filter((candidate) => !isFinal(candidate, input.totalMoves))
    .filter((candidate) => candidate.evidenceSource.size > 0)
    .sort(compareCandidates);

  return diversify(sorted, maxMoves)
    .map((candidate): ProductReviewMoveV1 => ({
      turnIndex: candidate.turnIndex,
      player: candidate.player as ProductColorV1,
      category: candidate.category,
      playedMove: candidate.playedMove,
      recommendedMove: candidate.recommendedMove,
      scoreLoss: candidate.scoreLoss,
      winrateLoss: candidate.winrateLoss,
      confidence: confidenceFor(candidate),
      sourceEventId: candidate.sourceEventId,
      evidence: {
        source: Array.from(candidate.evidenceSource).sort(),
        notes: Array.from(candidate.notes),
        pv: candidate.pv,
        v25: {
          taxonomy: taxonomyFor(candidate),
          evidenceTypes: Array.from(candidate.evidenceTypes).sort(),
          rankingScore: candidate.score,
          ranking: candidate.ranking,
        },
      },
    }))
    .filter(isProductReviewMoveV1);
}
