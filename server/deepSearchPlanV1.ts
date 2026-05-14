import type { AnalysisPlanV1 } from "@shared/analysisPlanV1";
import type { AdiV1Result, AdiV1Signal } from "@shared/adiV1";
import type { BsiV1Result, BsiV1Signal } from "@shared/bsiV1";
import {
  DEEP_SEARCH_PLAN_V1_COMPUTED_FROM,
  DEEP_SEARCH_PLAN_V1_VERSION,
  type DeepSearchPlanCandidateV1,
  type DeepSearchPlanNotSelectedV1,
  type DeepSearchPlanPolicyV1,
  type DeepSearchPlanSelectionBandV1,
  type DeepSearchPlanV1Result,
} from "@shared/deepSearchPlanV1";
import type { TurnAnalysisEntryV1 } from "@shared/multiTurnKatagoAnalysisV1";

const W_ADI = 0.45;
const W_BSI = 0.3;
const W_PRI = 0.1;
const W_RARE = 0.1;
const W_RANK = 0.05;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) {
    return 0;
  }
  return Math.min(1, Math.max(0, x));
}

export function readDeepSearchPlanPolicyFromEnv(env: NodeJS.ProcessEnv): DeepSearchPlanPolicyV1 {
  const maxC = Number.parseInt(env.DEEP_SEARCH_PLAN_MAX_CANDIDATES?.trim() ?? "", 10);
  const minAdi = Number.parseFloat(env.DEEP_SEARCH_PLAN_MIN_ADI_SCORE?.trim() ?? "");
  const minBsi = Number.parseFloat(env.DEEP_SEARCH_PLAN_MIN_BSI_SCORE?.trim() ?? "");
  return {
    mode: "standard",
    maxCandidates: Number.isFinite(maxC) && maxC > 0 ? maxC : 3,
    minAdiScore: Number.isFinite(minAdi) ? minAdi : 0.5,
    minBsiScore: Number.isFinite(minBsi) ? minBsi : 30,
  };
}

export function selectionBandFromSelectionScore(s: number): DeepSearchPlanSelectionBandV1 {
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

function normalizePlanPriority(plan: AnalysisPlanV1, rawPriority: number): number {
  const maxP = Math.max(1e-9, ...plan.candidateTurns.map((c) => c.priority));
  return clamp01(rawPriority / maxP);
}

function computeSelectionScore(args: {
  adiScore: number;
  bsiScore?: number;
  planPriorityNorm: number;
  rare: number | null;
  rank: number | null;
}): number {
  let sumW = 0;
  let sum = 0;
  const add = (w: number, v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) {
      return;
    }
    sumW += w;
    sum += w * clamp01(v);
  };
  add(W_ADI, args.adiScore);
  add(W_BSI, args.bsiScore != null && Number.isFinite(args.bsiScore) ? args.bsiScore / 100 : undefined);
  add(W_PRI, args.planPriorityNorm);
  add(W_RARE, args.rare);
  add(W_RANK, args.rank);
  if (sumW <= 0) {
    return 0;
  }
  return clamp01(sum / sumW);
}

function buildReasonStrings(
  adi: AdiV1Signal,
  bsi: BsiV1Signal | undefined,
  policy: DeepSearchPlanPolicyV1
): string[] {
  const out: string[] = [];
  if (adi.adiScore != null && adi.adiScore >= 0.65) {
    out.push("high_adi");
  }
  if (adi.deepSearchCandidate) {
    out.push("deep_search_flag");
  }
  if (typeof bsi?.bsiScore === "number" && Number.isFinite(bsi.bsiScore) && bsi.bsiScore >= policy.minBsiScore) {
    out.push("meaningful_bsi");
  }
  const rare = adi.components.rareUserMoveRisk;
  if (rare != null && rare >= 0.65) {
    out.push("rare_user_move");
  }
  if (adi.status === "partial") {
    out.push("partial_signal");
  }
  const rk = adi.components.rankInstability;
  if (rk != null && rk >= 0.6) {
    out.push("high_rank_instability");
  }
  if (out.length === 0) {
    out.push("qualified");
  }
  return out;
}

type PoolRow = {
  turnIndex: number;
  adi: AdiV1Signal;
  bsi?: BsiV1Signal;
  planTurn: AnalysisPlanV1["candidateTurns"][number];
  selectionScore: number;
  deepSearchCandidate: boolean;
};

/**
 * ADI/BSI/analysisPlan·multi-turn `ok` 턴만 사용. **추가 KataGo·Deep Search 실행 없음.**
 */
export function computeDeepSearchPlanV1(opts: {
  analysisPlan: AnalysisPlanV1;
  turnAnalyses: readonly TurnAnalysisEntryV1[];
  bsiV1: BsiV1Result;
  adiV1: AdiV1Result;
  env?: NodeJS.ProcessEnv;
}): DeepSearchPlanV1Result {
  const env = opts.env ?? process.env;
  const policy = readDeepSearchPlanPolicyFromEnv(env);
  const planByTurn = new Map(opts.analysisPlan.candidateTurns.map((c) => [c.turnIndex, c]));
  const bsiByTurn = new Map(opts.bsiV1.signals.map((s) => [s.turnIndex, s]));
  const okTurn = new Set(
    opts.turnAnalyses.filter((t) => t.status === "ok").map((t) => t.turnIndex)
  );

  const notSelected: DeepSearchPlanNotSelectedV1[] = [];
  const pool: PoolRow[] = [];

  for (const adi of opts.adiV1.signals) {
    if (adi.status === "insufficient_data") {
      notSelected.push({ turnIndex: adi.turnIndex, reason: "insufficient_adi_status" });
      continue;
    }
    if (adi.status !== "scored" && adi.status !== "partial") {
      continue;
    }
    if (typeof adi.adiScore !== "number" || !Number.isFinite(adi.adiScore)) {
      notSelected.push({ turnIndex: adi.turnIndex, reason: "missing_adi_score" });
      continue;
    }
    if (!okTurn.has(adi.turnIndex)) {
      notSelected.push({ turnIndex: adi.turnIndex, reason: "turn_analysis_not_ok" });
      continue;
    }

    const planTurn = planByTurn.get(adi.turnIndex);
    if (!planTurn) {
      notSelected.push({ turnIndex: adi.turnIndex, reason: "missing_plan_turn" });
      continue;
    }
    if (planTurn.reason === "final_position") {
      notSelected.push({ turnIndex: adi.turnIndex, reason: "excluded_final_position" });
      continue;
    }

    const bsi = bsiByTurn.get(adi.turnIndex);
    const bsiScore = bsi?.bsiScore;
    if (typeof bsiScore === "number" && Number.isFinite(bsiScore)) {
      if (bsiScore < policy.minBsiScore) {
        notSelected.push({ turnIndex: adi.turnIndex, reason: "below_min_bsi_score" });
        continue;
      }
    }

    if (adi.adiScore < policy.minAdiScore) {
      notSelected.push({ turnIndex: adi.turnIndex, reason: "below_min_adi_score" });
      continue;
    }

    const priNorm = normalizePlanPriority(opts.analysisPlan, planTurn.priority);
    const selectionScore = computeSelectionScore({
      adiScore: adi.adiScore,
      bsiScore: typeof bsiScore === "number" ? bsiScore : undefined,
      planPriorityNorm: priNorm,
      rare: adi.components.rareUserMoveRisk,
      rank: adi.components.rankInstability,
    });

    pool.push({
      turnIndex: adi.turnIndex,
      adi,
      bsi,
      planTurn,
      selectionScore,
      deepSearchCandidate: adi.deepSearchCandidate === true,
    });
  }

  const seen = new Set<number>();
  const uniq: PoolRow[] = [];
  for (const r of pool) {
    if (seen.has(r.turnIndex)) {
      notSelected.push({ turnIndex: r.turnIndex, reason: "duplicate_turn_index" });
      continue;
    }
    seen.add(r.turnIndex);
    uniq.push(r);
  }

  uniq.sort((a, b) => {
    if (a.deepSearchCandidate !== b.deepSearchCandidate) {
      return a.deepSearchCandidate ? -1 : 1;
    }
    return b.selectionScore - a.selectionScore;
  });

  const candidates: DeepSearchPlanCandidateV1[] = [];
  for (const r of uniq) {
    if (candidates.length >= policy.maxCandidates) {
      notSelected.push({ turnIndex: r.turnIndex, reason: "not_top_rank" });
      continue;
    }
    const bsi = bsiByTurn.get(r.turnIndex);
    candidates.push({
      turnIndex: r.turnIndex,
      player: r.planTurn.player,
      playedMove: r.adi.playedMove,
      bestMove: r.adi.bestMove,
      selectionScore: r.selectionScore,
      selectionBand: selectionBandFromSelectionScore(r.selectionScore),
      reasons: buildReasonStrings(r.adi, bsi, policy),
      adiScore: r.adi.adiScore!,
      ...(typeof bsi?.bsiScore === "number" ? { bsiScore: bsi.bsiScore } : {}),
      priority: r.planTurn.priority,
      candidateReason: r.planTurn.reason,
      status: "selected",
    });
  }

  return {
    version: DEEP_SEARCH_PLAN_V1_VERSION,
    computedFrom: DEEP_SEARCH_PLAN_V1_COMPUTED_FROM,
    policy,
    candidateCount: candidates.length,
    candidates,
    notSelected,
  };
}
