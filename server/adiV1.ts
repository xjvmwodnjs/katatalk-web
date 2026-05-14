import type { AdiV1Band, AdiV1Result, AdiV1Signal, AdiV1SignalComponents, AdiV1SignalStatus } from "@shared/adiV1";
import { ADI_V1_COMPUTED_FROM, ADI_V1_VERSION } from "@shared/adiV1";
import type { BsiV1Result, BsiV1Signal } from "@shared/bsiV1";
import type { TurnAnalysisCandidateMoveSummaryV1, TurnAnalysisEntrySuccessV1, TurnAnalysisEntryV1 } from "@shared/multiTurnKatagoAnalysisV1";

const W_VISIT = 0.25;
const W_RANK = 0.2;
const W_TACTICAL = 0.2;
const W_OWN = 0.15;
const W_BSI = 0.1;
const W_RARE = 0.1;

const DEEP_SEARCH_SCORE_THRESHOLD = 0.5;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) {
    return 0;
  }
  return Math.min(1, Math.max(0, x));
}

export function adiBandFromScore(s: number): AdiV1Band {
  if (s < 0.25) {
    return "low";
  }
  if (s < 0.5) {
    return "medium";
  }
  if (s < 0.75) {
    return "high";
  }
  return "very_high";
}

function softmaxEntropy01(weights: readonly number[]): number | null {
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    return null;
  }
  const p = w.map((x) => x / sum);
  const used = p.filter((x) => x > 0);
  const n = used.length;
  if (n < 2) {
    return 0;
  }
  let h = 0;
  for (const x of used) {
    h -= x * Math.log(x);
  }
  const hMax = Math.log(n);
  return hMax > 0 ? clamp01(h / hMax) : 0;
}

function visitEntropyFromCandidates(cands: readonly TurnAnalysisCandidateMoveSummaryV1[]): number | null {
  if (cands.length < 2) {
    return null;
  }
  const visits = cands.map((c) => (typeof c.visits === "number" && c.visits > 0 ? c.visits : 0));
  const sumV = visits.reduce((a, b) => a + b, 0);
  if (sumV > 0) {
    return softmaxEntropy01(visits);
  }
  const wrs = cands
    .map((c) => (typeof c.winrate === "number" && c.winrate > 0 && c.winrate < 1 ? c.winrate : 0))
    .filter((x) => x > 0);
  if (wrs.length >= 2) {
    return softmaxEntropy01(wrs);
  }
  return null;
}

function rankInstabilityFromCandidates(cands: readonly TurnAnalysisCandidateMoveSummaryV1[]): number | null {
  if (cands.length < 2) {
    return null;
  }
  const c0 = cands[0];
  const c1 = cands[1];
  const v0 = typeof c0?.visits === "number" && c0.visits > 0 ? c0.visits : 0;
  const v1 = typeof c1?.visits === "number" && c1.visits > 0 ? c1.visits : 0;
  let fromVisits = 0;
  let hasVisits = false;
  if (v0 > 0 && v1 > 0) {
    hasVisits = true;
    /** 비율이 1에 가까울수록(탐색량이 비슷할수록) 순위 불안정성이 크다 */
    fromVisits = clamp01(Math.min(v0, v1) / Math.max(v0, v1));
  }
  const w0 = typeof c0?.winrate === "number" && Number.isFinite(c0.winrate) ? c0.winrate : null;
  const w1 = typeof c1?.winrate === "number" && Number.isFinite(c1.winrate) ? c1.winrate : null;
  let fromWr = 0;
  let hasWr = false;
  if (w0 != null && w1 != null) {
    hasWr = true;
    fromWr = clamp01(Math.exp(-Math.abs(w0 - w1) * 80));
  }
  if (hasVisits && hasWr) {
    return clamp01(0.5 * fromVisits + 0.5 * fromWr);
  }
  if (hasVisits) {
    return clamp01(fromVisits);
  }
  if (hasWr) {
    return clamp01(fromWr);
  }
  return null;
}

function tacticalPvRiskFromCandidates(cands: readonly TurnAnalysisCandidateMoveSummaryV1[]): number {
  if (cands.length === 0) {
    return 0;
  }
  const maxLen = Math.max(
    0,
    ...cands.map((c) => (typeof c.pvLength === "number" && c.pvLength > 0 ? c.pvLength : 0))
  );
  return clamp01(maxLen / 12);
}

function rareUserMoveRisk(
  playedMove: string,
  playedInCandidates: boolean,
  cands: readonly TurnAnalysisCandidateMoveSummaryV1[]
): number | null {
  if (cands.length === 0) {
    return null;
  }
  if (!playedInCandidates) {
    return clamp01(0.92);
  }
  const row = cands.find((c) => c.move === playedMove);
  const vmax = Math.max(0, ...cands.map((c) => (typeof c.visits === "number" && c.visits > 0 ? c.visits : 0)));
  const vp = typeof row?.visits === "number" && row.visits > 0 ? row.visits : 0;
  if (vmax <= 0) {
    return clamp01(0.82);
  }
  return clamp01(1 - Math.sqrt((vp + 1) / (vmax + 1)));
}

function bsiNormFromSignal(bsi: BsiV1Signal | undefined): number | null {
  if (!bsi) {
    return null;
  }
  if (typeof bsi.bsiScore === "number" && Number.isFinite(bsi.bsiScore)) {
    return clamp01(bsi.bsiScore / 100);
  }
  return null;
}

function resolveAdiStatus(args: {
  playedInCandidates: boolean;
  bsiStatus: BsiV1Signal["status"] | undefined;
}): AdiV1SignalStatus {
  if (args.playedInCandidates && args.bsiStatus === "scored") {
    return "scored";
  }
  return "partial";
}

function blendAdiScore(components: Omit<AdiV1SignalComponents, "availableWeightSum">): {
  adiScore: number;
  availableWeightSum: number;
} | null {
  let sumW = 0;
  let sumWC = 0;
  const add = (w: number, c: number | null) => {
    if (c == null) {
      return;
    }
    sumW += w;
    sumWC += w * clamp01(c);
  };
  add(W_VISIT, components.visitEntropy);
  add(W_RANK, components.rankInstability);
  add(W_TACTICAL, components.tacticalPvRisk);
  add(W_OWN, components.ownershipVolatility);
  add(W_BSI, components.bsiNorm);
  add(W_RARE, components.rareUserMoveRisk);
  if (sumW <= 0) {
    return null;
  }
  return { adiScore: clamp01(sumWC / sumW), availableWeightSum: sumW };
}

/**
 * `turnAnalyses`(ok + `candidateMoves`)와 `bsiV1.signals`만 사용. 추가 KataGo·Deep Search 없음.
 */
export function computeAdiV1FromTurnAnalysesAndBsi(
  turnAnalyses: readonly TurnAnalysisEntryV1[],
  bsiV1: BsiV1Result
): AdiV1Result {
  const ok = turnAnalyses.filter((t): t is TurnAnalysisEntrySuccessV1 => t.status === "ok");
  const bsiByTurn = new Map<number, BsiV1Signal>();
  for (const s of bsiV1.signals) {
    bsiByTurn.set(s.turnIndex, s);
  }

  const signals: AdiV1Signal[] = [];
  let scoredCount = 0;
  let partialCount = 0;
  let insufficientCount = 0;

  for (const t of ok) {
    const bestMove = t.comparisonReady.bestMove;
    const playedInCandidates = t.comparisonReady.playedMoveFoundInCandidates;
    const cands = t.candidateMoves ?? [];
    const bsiSig = bsiByTurn.get(t.turnIndex);

    if (!bsiSig || cands.length < 2) {
      insufficientCount += 1;
      signals.push({
        turnIndex: t.turnIndex,
        player: t.player,
        playedMove: t.playedMove,
        bestMove,
        status: "insufficient_data",
        deepSearchCandidate: false,
        components: {
          visitEntropy: null,
          rankInstability: null,
          tacticalPvRisk: null,
          ownershipVolatility: null,
          bsiNorm: null,
          rareUserMoveRisk: null,
          availableWeightSum: 0,
        },
        interpretationStatus: "provisional",
      });
      continue;
    }

    const visitEntropy = visitEntropyFromCandidates(cands);
    const rankInstability = rankInstabilityFromCandidates(cands);
    const tacticalPvRisk = tacticalPvRiskFromCandidates(cands);
    const ownershipVolatility: number | null = null;
    const bsiNorm = bsiNormFromSignal(bsiSig);
    const rareRisk = rareUserMoveRisk(t.playedMove, playedInCandidates, cands);

    const baseComponents = {
      visitEntropy,
      rankInstability,
      tacticalPvRisk,
      ownershipVolatility,
      bsiNorm,
      rareUserMoveRisk: rareRisk,
    };

    if (visitEntropy == null || rankInstability == null || rareRisk == null) {
      insufficientCount += 1;
      signals.push({
        turnIndex: t.turnIndex,
        player: t.player,
        playedMove: t.playedMove,
        bestMove,
        status: "insufficient_data",
        deepSearchCandidate: false,
        components: {
          ...baseComponents,
          availableWeightSum: 0,
        },
        interpretationStatus: "provisional",
      });
      continue;
    }

    const blended = blendAdiScore(baseComponents);
    if (!blended) {
      insufficientCount += 1;
      signals.push({
        turnIndex: t.turnIndex,
        player: t.player,
        playedMove: t.playedMove,
        bestMove,
        status: "insufficient_data",
        deepSearchCandidate: false,
        components: {
          ...baseComponents,
          availableWeightSum: 0,
        },
        interpretationStatus: "provisional",
      });
      continue;
    }

    const { adiScore, availableWeightSum } = blended;
    const adiBand = adiBandFromScore(adiScore);
    const status = resolveAdiStatus({ playedInCandidates, bsiStatus: bsiSig.status });
    if (status === "scored") {
      scoredCount += 1;
    } else {
      partialCount += 1;
    }

    const fullComponents: AdiV1SignalComponents = {
      ...baseComponents,
      availableWeightSum,
    };

    signals.push({
      turnIndex: t.turnIndex,
      player: t.player,
      playedMove: t.playedMove,
      bestMove,
      status,
      adiScore,
      adiBand,
      deepSearchCandidate: adiScore >= DEEP_SEARCH_SCORE_THRESHOLD,
      components: fullComponents,
      interpretationStatus: "provisional",
    });
  }

  return {
    version: ADI_V1_VERSION,
    computedFrom: ADI_V1_COMPUTED_FROM,
    candidateCount: ok.length,
    scoredCount,
    partialCount,
    insufficientCount,
    signals,
  };
}
