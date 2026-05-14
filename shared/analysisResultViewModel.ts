/**
 * Analysis result → UI-friendly ViewModel v1.
 * 바둑판 렌더·승률 그래프 컴포넌트·LLM·top_mistakes 생성 없음.
 */

import type { AnalysisPlanCandidateReasonV1, AnalysisPlanV1 } from "./analysisPlanV1";
import type { AdiV1Result, AdiV1Signal } from "./adiV1";
import type { BsiV1Result, BsiV1Signal } from "./bsiV1";
import type { DeepSearchPlanCandidateV1, DeepSearchPlanV1Result } from "./deepSearchPlanV1";
import type { DeepSearchResultsV1Result, DeepSearchSingleResultOkV1 } from "./deepSearchResultsV1";
import type { TurnAnalysisEntryV1, TurnAnalysisEntrySuccessV1 } from "./multiTurnKatagoAnalysisV1";

const NEUTRAL_LABELS = [
  "검토 후보",
  "추가 분석 후보",
  "변화가 큰 장면",
  "실전수와 후보수 차이가 큰 장면",
] as const;

const DEFAULT_WARNINGS_KO = [
  "현재 결과는 KataGo 수치 기반 베타 분석이며 패착 확정 해설이 아닙니다.",
] as const;

const MOCK_WARNING_KO =
  "이 결과는 mock/데모용 JSON일 수 있으며, 운영 KataGo 분석과 다릅니다. 패착·악수·정답으로 해석하지 마세요.";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function isKatagoWorkerV1Payload(data: unknown): data is Record<string, unknown> {
  return isPlainObject(data) && data.source === "katago-worker-v1";
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function labelForIndex(i: number): string {
  return NEUTRAL_LABELS[i % NEUTRAL_LABELS.length]!;
}

function turnReasonFromPlan(analysisPlan: AnalysisPlanV1 | undefined, turnIndex: number): AnalysisPlanCandidateReasonV1 | null {
  if (!analysisPlan?.candidateTurns) {
    return null;
  }
  const row = analysisPlan.candidateTurns.find((c) => c.turnIndex === turnIndex);
  return row?.reason ?? null;
}

function turnReasonFromTurnAnalyses(turnAnalyses: TurnAnalysisEntryV1[] | undefined, turnIndex: number): AnalysisPlanCandidateReasonV1 | null {
  if (!turnAnalyses) {
    return null;
  }
  const row = turnAnalyses.find((t) => t.turnIndex === turnIndex);
  return row && "reason" in row ? row.reason : null;
}

function isFinalPositionTurn(
  turnIndex: number,
  analysisPlan: AnalysisPlanV1 | undefined,
  turnAnalyses: TurnAnalysisEntryV1[] | undefined
): boolean {
  return (
    turnReasonFromPlan(analysisPlan, turnIndex) === "final_position" ||
    turnReasonFromTurnAnalyses(turnAnalyses, turnIndex) === "final_position"
  );
}

function extractPvFromTopMove(topMove: unknown): string[] {
  if (!isPlainObject(topMove)) {
    return [];
  }
  const pv = topMove.pv;
  if (!Array.isArray(pv)) {
    return [];
  }
  const out: string[] = [];
  for (const x of pv) {
    if (typeof x === "string") {
      const t = x.trim();
      if (t) {
        out.push(t);
      }
    }
  }
  return out;
}

function extractPvFromCandidateMoves(entry: TurnAnalysisEntrySuccessV1): string[] {
  const first = entry.candidateMoves?.[0];
  if (!first || typeof first.move !== "string") {
    return [];
  }
  /** pv 배열이 없을 때는 후보만 반환(길이 정보는 pvLength 로만 표현됨) */
  return [first.move];
}

function getTurnAnalysisOk(turnAnalyses: TurnAnalysisEntryV1[] | undefined, turnIndex: number): TurnAnalysisEntrySuccessV1 | null {
  if (!turnAnalyses) {
    return null;
  }
  const row = turnAnalyses.find((t) => t.turnIndex === turnIndex);
  if (!row || row.status !== "ok") {
    return null;
  }
  return row;
}

function getDeepOkRow(
  deep: DeepSearchResultsV1Result | undefined,
  turnIndex: number
): DeepSearchSingleResultOkV1 | null {
  if (!deep?.enabled || !deep.results) {
    return null;
  }
  const r = deep.results.find((x) => x.turnIndex === turnIndex && x.status === "ok");
  return r && r.status === "ok" ? r : null;
}

function findBsi(bsi: BsiV1Result | undefined, turnIndex: number): BsiV1Signal | null {
  return bsi?.signals?.find((s) => s.turnIndex === turnIndex) ?? null;
}

function findAdi(adi: AdiV1Result | undefined, turnIndex: number): AdiV1Signal | null {
  return adi?.signals?.find((s) => s.turnIndex === turnIndex) ?? null;
}

export type AnalysisResultWinratePointV1 = {
  turnIndex: number;
  player: "B" | "W";
  /** KataGo 원시 0~1 (없으면 null) */
  rawWinrate: number | null;
  /** 0~100 표시용 (raw*100 반올림); 추후 흑/백 토글 UI에서 재해석 예정 — docs/TODO */
  displayWinrate: number | null;
  displayPerspective: "katago_output";
  /** 추후 시점에서 착수한 색 — 흑/백 승률 단정 변환 없음 */
  currentPlayer: "B" | "W";
  /** 동일: 해당 수를 둔 player */
  playerToMove: "B" | "W";
  confidence: "provisional" | "verified";
};

export type AnalysisResultKeyMoveCandidateV1 = {
  turnIndex: number;
  player: "B" | "W";
  playedMove: string;
  bestMove: string | null;
  label: string;
  bsiScore: number | null;
  adiScore: number | null;
  deepSearchSelected: boolean;
  deepSearchCompleted: boolean;
  reasons: string[];
};

export type AnalysisResultVariationPreviewV1 = {
  turnIndex: number;
  playedMove: string;
  bestMove: string | null;
  pv: string[];
  source: "deep-search" | "multi-turn";
};

export type KatagoWorkerV1AnalysisViewModel = {
  kind: "katago-worker-v1";
  summary: {
    engine: "KataGo";
    isMock: false;
    source: "katago-worker-v1";
    totalMoves: number;
    hasMultiTurn: boolean;
    hasBsi: boolean;
    hasAdi: boolean;
    hasDeepSearchPlan: boolean;
    hasDeepSearchResults: boolean;
    deepSearchEnabled: boolean;
  };
  graph: {
    winrateSeries: AnalysisResultWinratePointV1[];
  };
  keyMoveCandidates: AnalysisResultKeyMoveCandidateV1[];
  variationPreview: AnalysisResultVariationPreviewV1[];
  warnings: string[];
  /** 보드 복원·SGF 재생은 후속 — 구조만 유지 */
  sgfPlayback: {
    placeholder: true;
    note: "SGF 기반 바둑판 복원은 미구현. 원문은 job 메타/스토리지에서 별도 로드.";
    totalMovesHint: number | null;
  };
};

export type MockLegacyAnalysisViewModel = {
  kind: "mock-legacy";
  summary: {
    engine: "mock";
    isMock: true;
    source: "mock-legacy";
    totalMoves: number | null;
    hasMultiTurn: false;
    hasBsi: false;
    hasAdi: false;
    hasDeepSearchPlan: false;
    hasDeepSearchResults: false;
    deepSearchEnabled: false;
  };
  graph: { winrateSeries: [] };
  keyMoveCandidates: [];
  variationPreview: [];
  warnings: string[];
  sgfPlayback: {
    placeholder: true;
    note: string;
    totalMovesHint: number | null;
  };
};

export type UnknownAnalysisViewModel = {
  kind: "unknown";
  summary: {
    engine: "unknown";
    isMock: boolean;
    source: string | null;
    totalMoves: null;
    hasMultiTurn: false;
    hasBsi: false;
    hasAdi: false;
    hasDeepSearchPlan: false;
    hasDeepSearchResults: false;
    deepSearchEnabled: false;
  };
  graph: { winrateSeries: [] };
  keyMoveCandidates: [];
  variationPreview: [];
  warnings: string[];
  sgfPlayback: {
    placeholder: true;
    note: string;
    totalMovesHint: null;
  };
};

export type AnalysisResultViewModel = KatagoWorkerV1AnalysisViewModel | MockLegacyAnalysisViewModel | UnknownAnalysisViewModel;

function buildWinrateSeries(
  turnAnalyses: TurnAnalysisEntryV1[] | undefined,
  bsi: BsiV1Result | undefined
): AnalysisResultWinratePointV1[] {
  const out: AnalysisResultWinratePointV1[] = [];
  if (!turnAnalyses) {
    return out;
  }
  const okRows = turnAnalyses.filter((t): t is TurnAnalysisEntrySuccessV1 => t.status === "ok");
  const sorted = [...okRows].sort((a, b) => a.turnIndex - b.turnIndex);
  for (const t of sorted) {
    const wr = t.moveSummary?.played?.winrate;
    const raw = typeof wr === "number" && Number.isFinite(wr) ? wr : null;
    const bsiRow = findBsi(bsi, t.turnIndex);
    const conf = bsiRow?.interpretationStatus === "verified" ? "verified" : "provisional";
    out.push({
      turnIndex: t.turnIndex,
      player: t.player,
      rawWinrate: raw,
      displayWinrate: raw == null ? null : Math.round(raw * 10_000) / 100,
      displayPerspective: "katago_output",
      currentPlayer: t.player,
      playerToMove: t.player,
      confidence: conf,
    });
  }
  return out;
}

function mergeReasons(planReasons: string[] | undefined, extras: string[]): string[] {
  const base = planReasons?.filter((s) => typeof s === "string" && s.trim()) ?? [];
  const seen = new Set(base.map((s) => s.trim().toLowerCase()));
  const add: string[] = [];
  for (const e of extras) {
    const k = e.trim().toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      add.push(e);
    }
  }
  return [...base, ...add];
}

function extrasFromSignals(adi?: AdiV1Signal | null, bsi?: BsiV1Signal | null): string[] {
  const r: string[] = [];
  if (adi?.adiScore != null && adi.adiScore >= 0.65) {
    r.push("높은 ADI");
  }
  if (bsi?.bsiScore != null && bsi.bsiScore >= 45) {
    r.push("BSI 신호");
  }
  if (bsi?.playedMoveRank != null && bsi.playedMoveRank > 3) {
    r.push("실전수 후보 순위 낮음");
  }
  return r;
}

type CandidateAcc = {
  turnIndex: number;
  player: "B" | "W";
  playedMove: string;
  bestMove: string | null;
  selectionScore?: number;
  adiScore: number | null;
  bsiScore: number | null;
  planReasons?: string[];
  fromPlan: boolean;
};

function buildCandidateAccumulator(
  analysisPlan: AnalysisPlanV1 | undefined,
  turnAnalyses: TurnAnalysisEntryV1[] | undefined,
  plan: DeepSearchPlanV1Result | undefined,
  adi: AdiV1Result | undefined,
  bsi: BsiV1Result | undefined,
  max: number
): CandidateAcc[] {
  const byTurn = new Map<number, CandidateAcc>();
  const push = (acc: CandidateAcc) => {
    if (isFinalPositionTurn(acc.turnIndex, analysisPlan, turnAnalyses)) {
      return;
    }
    if (!byTurn.has(acc.turnIndex)) {
      byTurn.set(acc.turnIndex, acc);
    }
  };

  const planCands = plan?.candidates;
  if (Array.isArray(planCands)) {
    for (const c of planCands as DeepSearchPlanCandidateV1[]) {
      if (byTurn.size >= max) {
        break;
      }
      if (!c || typeof c.turnIndex !== "number") {
        continue;
      }
      const adiRow = findAdi(adi, c.turnIndex);
      const bsiRow = findBsi(bsi, c.turnIndex);
      push({
        turnIndex: c.turnIndex,
        player: c.player,
        playedMove: c.playedMove,
        bestMove: c.bestMove,
        selectionScore: c.selectionScore,
        adiScore: typeof c.adiScore === "number" ? c.adiScore : adiRow?.adiScore ?? null,
        bsiScore: typeof c.bsiScore === "number" ? c.bsiScore : bsiRow?.bsiScore ?? null,
        planReasons: Array.isArray(c.reasons) ? (c.reasons as string[]) : undefined,
        fromPlan: true,
      });
    }
  }

  const adiSignals = [...(adi?.signals ?? [])].filter((s) => s.status === "scored" && typeof s.adiScore === "number");
  adiSignals.sort((a, b) => (b.adiScore ?? 0) - (a.adiScore ?? 0));
  for (const s of adiSignals) {
    if (byTurn.size >= max) {
      break;
    }
    if (byTurn.has(s.turnIndex)) {
      continue;
    }
    if (isFinalPositionTurn(s.turnIndex, analysisPlan, turnAnalyses)) {
      continue;
    }
    const bsiRow = findBsi(bsi, s.turnIndex);
    push({
      turnIndex: s.turnIndex,
      player: s.player,
      playedMove: s.playedMove,
      bestMove: s.bestMove,
      selectionScore: undefined,
      adiScore: s.adiScore ?? null,
      bsiScore: bsiRow?.bsiScore ?? null,
      fromPlan: false,
    });
  }

  const bsiSignals = [...(bsi?.signals ?? [])].filter((s) => s.status === "scored" && typeof s.bsiScore === "number");
  bsiSignals.sort((a, b) => (b.bsiScore ?? 0) - (a.bsiScore ?? 0));
  for (const s of bsiSignals) {
    if (byTurn.size >= max) {
      break;
    }
    if (byTurn.has(s.turnIndex)) {
      continue;
    }
    if (isFinalPositionTurn(s.turnIndex, analysisPlan, turnAnalyses)) {
      continue;
    }
    const adiRow = findAdi(adi, s.turnIndex);
    push({
      turnIndex: s.turnIndex,
      player: s.player,
      playedMove: s.playedMove,
      bestMove: s.bestMove,
      selectionScore: undefined,
      adiScore: adiRow?.adiScore ?? null,
      bsiScore: s.bsiScore ?? null,
      fromPlan: false,
    });
  }

  const rows = Array.from(byTurn.values());
  rows.sort((a, b) => {
    const sa = a.selectionScore ?? a.adiScore ?? 0;
    const sb = b.selectionScore ?? b.adiScore ?? 0;
    if (sb !== sa) {
      return sb - sa;
    }
    const aa = a.adiScore ?? 0;
    const ab = b.adiScore ?? 0;
    if (ab !== aa) {
      return ab - aa;
    }
    const ba = a.bsiScore ?? 0;
    const bb = b.bsiScore ?? 0;
    return bb - ba;
  });
  return rows.slice(0, max);
}

function buildKeyMoveVmList(
  acc: CandidateAcc[],
  plan: DeepSearchPlanV1Result | undefined,
  deep: DeepSearchResultsV1Result | undefined,
  adi: AdiV1Result | undefined,
  bsi: BsiV1Result | undefined
): AnalysisResultKeyMoveCandidateV1[] {
  const planTurns = new Set((plan?.candidates ?? []).map((c) => c.turnIndex));
  const out: AnalysisResultKeyMoveCandidateV1[] = [];
  let i = 0;
  for (const row of acc) {
    const adiRow = findAdi(adi, row.turnIndex);
    const bsiRow = findBsi(bsi, row.turnIndex);
    const deepOk = getDeepOkRow(deep, row.turnIndex);
    const extras = extrasFromSignals(adiRow, bsiRow);
    const reasons = mergeReasons(row.planReasons, extras);
    const label = labelForIndex(i);
    i += 1;
    out.push({
      turnIndex: row.turnIndex,
      player: row.player,
      playedMove: row.playedMove,
      bestMove: row.bestMove,
      label,
      bsiScore: row.bsiScore,
      adiScore: row.adiScore,
      deepSearchSelected: planTurns.has(row.turnIndex),
      deepSearchCompleted: deepOk != null,
      reasons,
    });
  }
  return out;
}

function buildVariationPreview(
  keys: AnalysisResultKeyMoveCandidateV1[],
  turnAnalyses: TurnAnalysisEntryV1[] | undefined,
  deep: DeepSearchResultsV1Result | undefined
): AnalysisResultVariationPreviewV1[] {
  const previews: AnalysisResultVariationPreviewV1[] = [];
  for (const k of keys) {
    const deepOk = getDeepOkRow(deep, k.turnIndex);
    if (deepOk) {
      const pv = extractPvFromTopMove(deepOk.katago.topMove);
      previews.push({
        turnIndex: k.turnIndex,
        playedMove: k.playedMove,
        bestMove: deepOk.comparison.deepBestMove ?? k.bestMove,
        pv,
        source: "deep-search",
      });
      continue;
    }
    const ta = getTurnAnalysisOk(turnAnalyses, k.turnIndex);
    if (ta) {
      let pv = extractPvFromTopMove(ta.katago.topMove);
      if (pv.length === 0) {
        pv = extractPvFromCandidateMoves(ta);
      }
      previews.push({
        turnIndex: k.turnIndex,
        playedMove: k.playedMove,
        bestMove: ta.comparisonReady.bestMove ?? k.bestMove,
        pv,
        source: "multi-turn",
      });
      continue;
    }
    previews.push({
      turnIndex: k.turnIndex,
      playedMove: k.playedMove,
      bestMove: k.bestMove,
      pv: [],
      source: "multi-turn",
    });
  }
  return previews;
}

function readGameTotalMoves(result: Record<string, unknown>): number {
  const gi = result.game_info;
  if (isPlainObject(gi) && typeof gi.total_moves === "number" && Number.isFinite(gi.total_moves)) {
    return Math.trunc(gi.total_moves);
  }
  const ap = result.analysisPlan;
  if (isPlainObject(ap) && typeof ap.totalMoves === "number" && Number.isFinite(ap.totalMoves)) {
    return Math.trunc(ap.totalMoves);
  }
  return 0;
}

function isMockLegacyResult(data: unknown): boolean {
  if (!isPlainObject(data)) {
    return false;
  }
  const src = data.source;
  if (isPlainObject(src) && src.mock === true) {
    return true;
  }
  return false;
}

/**
 * `GET /api/analyze/:jobId` 의 `data`(또는 `analysis_jobs.result`)를 ViewModel 로 변환.
 */
export function buildAnalysisResultViewModel(data: unknown): AnalysisResultViewModel {
  if (isKatagoWorkerV1Payload(data)) {
    const result = data;
    const analysisPlan = (isPlainObject(result.analysisPlan) ? (result.analysisPlan as AnalysisPlanV1) : undefined) ?? undefined;
    const turnAnalyses = asArray(result.turnAnalyses) as TurnAnalysisEntryV1[];
    const plan = isPlainObject(result.deepSearchPlan) ? (result.deepSearchPlan as DeepSearchPlanV1Result) : undefined;
    const deep = isPlainObject(result.deepSearchResults) ? (result.deepSearchResults as DeepSearchResultsV1Result) : undefined;
    const adi = isPlainObject(result.adiV1) ? (result.adiV1 as AdiV1Result) : undefined;
    const bsi = isPlainObject(result.bsiV1) ? (result.bsiV1 as BsiV1Result) : undefined;

    const totalMoves = readGameTotalMoves(result);
    const multi = result.multiTurnAnalysis;
    const hasMulti = isPlainObject(multi) && typeof multi.attemptedCount === "number" && multi.attemptedCount > 0;

    const acc = buildCandidateAccumulator(analysisPlan, turnAnalyses, plan, adi, bsi, 5);
    const keyMoveCandidates = buildKeyMoveVmList(acc, plan, deep, adi, bsi);
    const variationPreview = buildVariationPreview(keyMoveCandidates, turnAnalyses, deep);

    const vm: KatagoWorkerV1AnalysisViewModel = {
      kind: "katago-worker-v1",
      summary: {
        engine: "KataGo",
        isMock: false,
        source: "katago-worker-v1",
        totalMoves,
        hasMultiTurn: hasMulti,
        hasBsi: (bsi?.signals?.length ?? 0) > 0,
        hasAdi: (adi?.signals?.length ?? 0) > 0,
        hasDeepSearchPlan: (plan?.candidates?.length ?? 0) > 0,
        hasDeepSearchResults: deep != null,
        deepSearchEnabled: deep?.enabled === true,
      },
      graph: {
        winrateSeries: buildWinrateSeries(turnAnalyses, bsi),
      },
      keyMoveCandidates,
      variationPreview,
      warnings: [...DEFAULT_WARNINGS_KO],
      sgfPlayback: {
        placeholder: true,
        note: "SGF 기반 바둑판 복원은 미구현. 원문은 job 메타/스토리지에서 별도 로드.",
        totalMovesHint: totalMoves > 0 ? totalMoves : null,
      },
    };
    return vm;
  }

  if (isMockLegacyResult(data) && isPlainObject(data)) {
    const gi = data.game_info;
    const tm =
      isPlainObject(gi) && typeof gi.total_moves === "number" && Number.isFinite(gi.total_moves) ? Math.trunc(gi.total_moves) : null;
    const vm: MockLegacyAnalysisViewModel = {
      kind: "mock-legacy",
      summary: {
        engine: "mock",
        isMock: true,
        source: "mock-legacy",
        totalMoves: tm,
        hasMultiTurn: false,
        hasBsi: false,
        hasAdi: false,
        hasDeepSearchPlan: false,
        hasDeepSearchResults: false,
        deepSearchEnabled: false,
      },
      graph: { winrateSeries: [] },
      keyMoveCandidates: [],
      variationPreview: [],
      warnings: [MOCK_WARNING_KO, ...DEFAULT_WARNINGS_KO],
      sgfPlayback: {
        placeholder: true,
        note: "mock 결과에서는 ViewModel 이 후보/PV 를 노출하지 않습니다.",
        totalMovesHint: tm,
      },
    };
    return vm;
  }

  const src = isPlainObject(data) && data.source != null ? String(data.source) : null;
  return {
    kind: "unknown",
    summary: {
      engine: "unknown",
      isMock: false,
      source: src,
      totalMoves: null,
      hasMultiTurn: false,
      hasBsi: false,
      hasAdi: false,
      hasDeepSearchPlan: false,
      hasDeepSearchResults: false,
      deepSearchEnabled: false,
    },
    graph: { winrateSeries: [] },
    keyMoveCandidates: [],
    variationPreview: [],
    warnings: ["알 수 없는 분석 결과 형식입니다.", ...DEFAULT_WARNINGS_KO],
    sgfPlayback: {
      placeholder: true,
      note: "형식을 확인한 뒤 파서를 확장하세요.",
      totalMovesHint: null,
    },
  };
}
