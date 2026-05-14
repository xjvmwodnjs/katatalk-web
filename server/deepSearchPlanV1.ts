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

const DEFAULT_MAX_CANDIDATES = 3;
const DEFAULT_MIN_ADI_SCORE = 0.5;
const DEFAULT_MIN_BSI_SCORE = 30;
const MAX_CANDIDATES_CAP = 10;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) {
    return 0;
  }
  return Math.min(1, Math.max(0, x));
}

function clampBsiMinScore(x: number): number {
  return Math.min(100, Math.max(0, x));
}

/**
 * 환경변수 기반 정책. 잘못된 값은 기본값, 범위는 clamp.
 * - `maxCandidates`: 비어 있거나 NaN·0 이하 → 기본 3; 유효하면 1~10 clamp
 * - `minAdiScore`: 비어 있거나 NaN → 기본 0.5; 유효하면 0~1 clamp
 * - `minBsiScore`: 비어 있거나 NaN → 기본 30; 유효하면 0~100 clamp
 */
export function readDeepSearchPlanPolicyFromEnv(env: NodeJS.ProcessEnv): DeepSearchPlanPolicyV1 {
  const maxRaw = env.DEEP_SEARCH_PLAN_MAX_CANDIDATES?.trim();
  let maxCandidates = DEFAULT_MAX_CANDIDATES;
  if (maxRaw) {
    const n = Number.parseInt(maxRaw, 10);
    if (Number.isFinite(n) && n > 0) {
      maxCandidates = Math.min(MAX_CANDIDATES_CAP, Math.max(1, n));
    }
  }

  const minAdiRaw = env.DEEP_SEARCH_PLAN_MIN_ADI_SCORE?.trim();
  let minAdiScore = DEFAULT_MIN_ADI_SCORE;
  if (minAdiRaw) {
    const v = Number.parseFloat(minAdiRaw);
    if (Number.isFinite(v)) {
      minAdiScore = clamp01(v);
    }
  }

  const minBsiRaw = env.DEEP_SEARCH_PLAN_MIN_BSI_SCORE?.trim();
  let minBsiScore = DEFAULT_MIN_BSI_SCORE;
  if (minBsiRaw) {
    const v = Number.parseFloat(minBsiRaw);
    if (Number.isFinite(v)) {
      minBsiScore = clampBsiMinScore(v);
    }
  }

  return {
    mode: "standard",
    maxCandidates,
    minAdiScore,
    minBsiScore,
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

/** `final_position` 제외한 plan 후보만으로 priority 정규화 분모 계산 */
function eligiblePriorityDenominator(plan: AnalysisPlanV1): number {
  const eligible = plan.candidateTurns.filter((c) => c.reason !== "final_position");
  if (eligible.length === 0) {
    return 1e-9;
  }
  return Math.max(1e-9, ...eligible.map((c) => c.priority));
}

function normalizePlanPriority(rawPriority: number, eligibleDenom: number): number {
  return clamp01(rawPriority / eligibleDenom);
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

/** 동일 turnIndex 중 보존 행 선택: selectionScore → deepSearchCandidate → adiScore */
function comparePoolRowsForKeeper(a: PoolRow, b: PoolRow): number {
  if (b.selectionScore !== a.selectionScore) {
    return b.selectionScore - a.selectionScore;
  }
  if (Boolean(b.deepSearchCandidate) !== Boolean(a.deepSearchCandidate)) {
    return b.deepSearchCandidate ? 1 : -1;
  }
  const ae = a.adi.adiScore ?? 0;
  const be = b.adi.adiScore ?? 0;
  return be - ae;
}

function mergeDuplicateTurnRows(pool: PoolRow[], notSelected: DeepSearchPlanNotSelectedV1[]): PoolRow[] {
  const byTurn = new Map<number, PoolRow[]>();
  for (const r of pool) {
    const arr = byTurn.get(r.turnIndex) ?? [];
    arr.push(r);
    byTurn.set(r.turnIndex, arr);
  }
  const out: PoolRow[] = [];
  for (const [turnIndex, rows] of Array.from(byTurn.entries())) {
    if (rows.length === 1) {
      out.push(rows[0]!);
      continue;
    }
    const sorted = [...rows].sort(comparePoolRowsForKeeper);
    const keeper = sorted[0]!;
    out.push(keeper);
    for (let i = 1; i < sorted.length; i++) {
      notSelected.push({ turnIndex, reason: "replaced_duplicate_turn_index" });
    }
  }
  return out;
}

/**
 * ADI/BSI/analysisPlan·multi-turn `ok` 턴만 사용. **추가 KataGo·Deep Search 실행 없음.**
 * `bsiScore` 가 없으면 `minBsiScore` 필터를 적용하지 않는다(ADI-only 후보 v1 허용).
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
  const eligiblePriDenom = eligiblePriorityDenominator(opts.analysisPlan);

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

    const priNorm = normalizePlanPriority(planTurn.priority, eligiblePriDenom);
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

  const uniq = mergeDuplicateTurnRows(pool, notSelected);

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
