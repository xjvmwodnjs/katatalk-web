import type { AnalysisPlanV1 } from "./analysisPlanV1";
import type { AdiV1Result, AdiV1Signal } from "./adiV1";
import type { BsiV1Result, BsiV1Signal } from "./bsiV1";
import type { DeepSearchPlanV1Result } from "./deepSearchPlanV1";
import type { DeepSearchResultsV1Result, DeepSearchSingleResultOkV1 } from "./deepSearchResultsV1";
import type { TurnAnalysisEntrySuccessV1, TurnAnalysisEntryV1 } from "./multiTurnKatagoAnalysisV1";
import type { WinrateTimelineV1 } from "./winrateTimelineV1";
import { resolvePerTurnMoveLossV1 } from "./perTurnLossPerspectiveV1";

export const ANALYSIS_LEARNING_EVENTS_V1_VERSION = "learning-events-v1" as const;

export type AnalysisLearningEventTypeV1 =
  | "review_candidate"
  | "flow_shift_candidate"
  | "response_candidate"
  | "high_adi_candidate"
  | "high_bsi_candidate"
  | "deep_search_candidate"
  | "winrate_shift_candidate"
  | "score_lead_shift_candidate";

export type AnalysisLearningEventConfidenceV1 = "low" | "medium" | "high";

export type AnalysisLearningEventSourceV1 =
  | "turnAnalyses"
  | "deepSearchPlan"
  | "deepSearchResults"
  | "adiV1"
  | "bsiV1"
  | "winrateTimelineV1"
  | "learningEventsV1"
  | "embedded";

export type AnalysisLearningEventV1 = {
  id: string;
  turnIndex: number;
  playedMove: string | null;
  candidateMove: string | null;
  labelKey: string;
  eventType: AnalysisLearningEventTypeV1;
  confidence: AnalysisLearningEventConfidenceV1;
  score: number;
  signals: {
    bsiScore?: number | null;
    adiScore?: number | null;
    winrateDelta?: number | null;
    scoreLeadDelta?: number | null;
    deepSearchSelected?: boolean;
    deepSearchCompleted?: boolean;
    deepSearchChangedTop?: boolean;
  };
  evidence: {
    source: AnalysisLearningEventSourceV1[];
    pv?: string[];
    deepSearchPv?: string[];
    notes?: string[];
  };
};

export type AnalysisLearningEventsV1 = {
  version: typeof ANALYSIS_LEARNING_EVENTS_V1_VERSION;
  events: AnalysisLearningEventV1[];
};

export type BuildAnalysisLearningEventsV1Input = {
  analysisPlan?: AnalysisPlanV1;
  turnAnalyses?: TurnAnalysisEntryV1[];
  bsi?: BsiV1Result;
  adi?: AdiV1Result;
  deepSearchPlan?: DeepSearchPlanV1Result;
  deepSearchResults?: DeepSearchResultsV1Result;
  winrateTimeline?: WinrateTimelineV1;
};

type Candidate = {
  turnIndex: number;
  playedMove: string | null;
  candidateMove: string | null;
  score: number;
  signals: AnalysisLearningEventV1["signals"];
  source: Set<AnalysisLearningEventSourceV1>;
  pv: string[];
  deepSearchPv: string[];
  notes: Set<string>;
};

const LEARNING_EVENT_TYPES = new Set<AnalysisLearningEventTypeV1>([
  "review_candidate",
  "flow_shift_candidate",
  "response_candidate",
  "high_adi_candidate",
  "high_bsi_candidate",
  "deep_search_candidate",
  "winrate_shift_candidate",
  "score_lead_shift_candidate",
]);

const LEARNING_EVENT_CONFIDENCE = new Set<AnalysisLearningEventConfidenceV1>(["low", "medium", "high"]);

const LEARNING_EVENT_LABEL_KEYS = new Set([
  "ar_label_review_candidate",
  "ar_label_flow_shift_candidate",
  "ar_label_response_candidate",
  "ar_label_high_adi_candidate",
  "ar_label_high_bsi_candidate",
  "ar_label_deep_search_candidate",
]);

const LEARNING_EVENT_SOURCES = new Set<AnalysisLearningEventSourceV1>([
  "turnAnalyses",
  "deepSearchPlan",
  "deepSearchResults",
  "adiV1",
  "bsiV1",
  "winrateTimelineV1",
  "learningEventsV1",
  "embedded",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isFiniteNumber(v: unknown): v is number {
  return finiteNumber(v) != null;
}

function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function isOptionalFiniteNumberOrNull(v: unknown): boolean {
  return v === undefined || v === null || isFiniteNumber(v);
}

function isOptionalBoolean(v: unknown): boolean {
  return v === undefined || typeof v === "boolean";
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isLearningEventSourceArray(v: unknown): v is AnalysisLearningEventSourceV1[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string" && LEARNING_EVENT_SOURCES.has(x as AnalysisLearningEventSourceV1));
}

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v * 100) / 100));
}

function extractPvFromTopMove(topMove: unknown): string[] {
  if (!isPlainObject(topMove) || !Array.isArray(topMove.pv)) {
    return [];
  }
  return topMove.pv.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function isFinalPositionTurn(
  turnIndex: number,
  analysisPlan: AnalysisPlanV1 | undefined,
  turnAnalyses: TurnAnalysisEntryV1[] | undefined
): boolean {
  if (analysisPlan?.candidateTurns?.some((c) => c.turnIndex === turnIndex && c.reason === "final_position")) {
    return true;
  }
  return turnAnalyses?.some((t) => t.turnIndex === turnIndex && "reason" in t && t.reason === "final_position") ?? false;
}

function isAnalysisLearningEventV1(v: unknown): v is AnalysisLearningEventV1 {
  if (!isPlainObject(v)) {
    return false;
  }
  if (typeof v.id !== "string" || !isNonNegativeInteger(v.turnIndex)) {
    return false;
  }
  if (!isStringOrNull(v.playedMove) || !isStringOrNull(v.candidateMove)) {
    return false;
  }
  if (typeof v.labelKey !== "string" || !LEARNING_EVENT_LABEL_KEYS.has(v.labelKey)) {
    return false;
  }
  if (typeof v.eventType !== "string" || !LEARNING_EVENT_TYPES.has(v.eventType as AnalysisLearningEventTypeV1)) {
    return false;
  }
  if (v.labelKey !== learningEventLabelKeyV1(v.eventType as AnalysisLearningEventTypeV1)) {
    return false;
  }
  if (typeof v.confidence !== "string" || !LEARNING_EVENT_CONFIDENCE.has(v.confidence as AnalysisLearningEventConfidenceV1)) {
    return false;
  }
  if (!isFiniteNumber(v.score) || !isPlainObject(v.signals) || !isPlainObject(v.evidence)) {
    return false;
  }
  if (
    !isOptionalFiniteNumberOrNull(v.signals.bsiScore) ||
    !isOptionalFiniteNumberOrNull(v.signals.adiScore) ||
    !isOptionalFiniteNumberOrNull(v.signals.winrateDelta) ||
    !isOptionalFiniteNumberOrNull(v.signals.scoreLeadDelta) ||
    !isOptionalBoolean(v.signals.deepSearchSelected) ||
    !isOptionalBoolean(v.signals.deepSearchCompleted) ||
    !isOptionalBoolean(v.signals.deepSearchChangedTop)
  ) {
    return false;
  }
  return (
    isLearningEventSourceArray(v.evidence.source) &&
    (v.evidence.pv === undefined || isStringArray(v.evidence.pv)) &&
    (v.evidence.deepSearchPv === undefined || isStringArray(v.evidence.deepSearchPv)) &&
    (v.evidence.notes === undefined || isStringArray(v.evidence.notes))
  );
}

function okTurnAnalyses(turnAnalyses: TurnAnalysisEntryV1[] | undefined): TurnAnalysisEntrySuccessV1[] {
  return (turnAnalyses ?? []).filter((t): t is TurnAnalysisEntrySuccessV1 => t.status === "ok");
}

function getCandidate(map: Map<number, Candidate>, turnIndex: number): Candidate {
  let row = map.get(turnIndex);
  if (!row) {
    row = {
      turnIndex,
      playedMove: null,
      candidateMove: null,
      score: 0,
      signals: {},
      source: new Set<AnalysisLearningEventSourceV1>(),
      pv: [],
      deepSearchPv: [],
      notes: new Set<string>(),
    };
    map.set(turnIndex, row);
    return row;
  }
  return row;
}

function addScore(row: Candidate, score: number, source: AnalysisLearningEventSourceV1, note?: string) {
  row.score += score;
  row.source.add(source);
  if (note) {
    row.notes.add(note);
  }
}

function mergeMoveInfo(row: Candidate, playedMove?: string | null, candidateMove?: string | null) {
  if (row.playedMove == null && playedMove) {
    row.playedMove = playedMove;
  }
  if (row.candidateMove == null && candidateMove) {
    row.candidateMove = candidateMove;
  }
}

function mergePv(row: Candidate, pv: string[]) {
  if (row.pv.length === 0 && pv.length > 0) {
    row.pv = pv;
  }
}

function mergeDeepPv(row: Candidate, pv: string[]) {
  if (row.deepSearchPv.length === 0 && pv.length > 0) {
    row.deepSearchPv = pv;
  }
}

function deepOkByTurn(deep: DeepSearchResultsV1Result | undefined): Map<number, DeepSearchSingleResultOkV1> {
  const out = new Map<number, DeepSearchSingleResultOkV1>();
  for (const r of deep?.results ?? []) {
    if (r.status === "ok" && !out.has(r.turnIndex)) {
      out.set(r.turnIndex, r);
    }
  }
  return out;
}

function eventTypeFor(row: Candidate): AnalysisLearningEventTypeV1 {
  if (row.signals.deepSearchCompleted || row.signals.deepSearchSelected) {
    return "deep_search_candidate";
  }
  if ((row.signals.adiScore ?? 0) >= 0.65) {
    return "high_adi_candidate";
  }
  if ((row.signals.bsiScore ?? 0) >= 45) {
    return "high_bsi_candidate";
  }
  if ((row.signals.scoreLeadDelta ?? 0) >= 4) {
    return "score_lead_shift_candidate";
  }
  if ((row.signals.winrateDelta ?? 0) >= 10) {
    return "winrate_shift_candidate";
  }
  if (row.source.has("turnAnalyses")) {
    return "response_candidate";
  }
  return "review_candidate";
}

export function learningEventLabelKeyV1(eventType: AnalysisLearningEventTypeV1): string {
  switch (eventType) {
    case "flow_shift_candidate":
    case "winrate_shift_candidate":
    case "score_lead_shift_candidate":
      return "ar_label_flow_shift_candidate";
    case "response_candidate":
      return "ar_label_response_candidate";
    case "high_adi_candidate":
      return "ar_label_high_adi_candidate";
    case "high_bsi_candidate":
      return "ar_label_high_bsi_candidate";
    case "deep_search_candidate":
      return "ar_label_deep_search_candidate";
    case "review_candidate":
    default:
      return "ar_label_review_candidate";
  }
}

function confidenceFor(row: Candidate): AnalysisLearningEventConfidenceV1 {
  const signalCount = row.source.size;
  if (row.score >= 70 && signalCount >= 3) {
    return "high";
  }
  if (row.score >= 45 || signalCount >= 2) {
    return "medium";
  }
  return "low";
}

function buildEvent(row: Candidate): AnalysisLearningEventV1 {
  const eventType = eventTypeFor(row);
  const source = Array.from(row.source).sort();
  return {
    id: `lev1-${row.turnIndex}`,
    turnIndex: row.turnIndex,
    playedMove: row.playedMove,
    candidateMove: row.candidateMove,
    labelKey: learningEventLabelKeyV1(eventType),
    eventType,
    confidence: confidenceFor(row),
    score: clampScore(row.score),
    signals: { ...row.signals },
    evidence: {
      source,
      ...(row.pv.length > 0 ? { pv: row.pv } : {}),
      ...(row.deepSearchPv.length > 0 ? { deepSearchPv: row.deepSearchPv } : {}),
      ...(row.notes.size > 0 ? { notes: Array.from(row.notes).sort() } : {}),
    },
  };
}

export function buildAnalysisLearningEventsV1(input: BuildAnalysisLearningEventsV1Input): AnalysisLearningEventsV1 {
  const map = new Map<number, Candidate>();
  const okTurns = okTurnAnalyses(input.turnAnalyses);
  const deepOk = deepOkByTurn(input.deepSearchResults);

  for (const t of okTurns) {
    if (isFinalPositionTurn(t.turnIndex, input.analysisPlan, input.turnAnalyses)) {
      continue;
    }
    const row = getCandidate(map, t.turnIndex);
    const candidateMove = t.comparisonReady?.bestMove ?? t.candidateMoves?.[0]?.move ?? null;
    mergeMoveInfo(row, t.playedMove, candidateMove);
    mergePv(row, extractPvFromTopMove(t.katago?.topMove));
    addScore(row, 4, "turnAnalyses");

    const verifiedLoss = resolvePerTurnMoveLossV1(t);
    if (verifiedLoss.winrateBestMinusPlayed != null) {
      const delta = verifiedLoss.winrateBestMinusPlayed * 100;
      row.signals.winrateDelta = Math.max(row.signals.winrateDelta ?? 0, Math.round(delta * 100) / 100);
      if (delta >= 6) {
        addScore(row, Math.min(16, delta * 0.9), "turnAnalyses", "move_summary_winrate_gap");
      }
    }

    if (verifiedLoss.scoreBestMinusPlayed != null) {
      const delta = verifiedLoss.scoreBestMinusPlayed;
      row.signals.scoreLeadDelta = Math.max(row.signals.scoreLeadDelta ?? 0, Math.round(delta * 100) / 100);
      if (delta >= 3) {
        addScore(row, Math.min(14, delta * 1.7), "turnAnalyses", "move_summary_score_gap");
      }
    }
  }

  for (const p of input.deepSearchPlan?.candidates ?? []) {
    if (isFinalPositionTurn(p.turnIndex, input.analysisPlan, input.turnAnalyses)) {
      continue;
    }
    const row = getCandidate(map, p.turnIndex);
    mergeMoveInfo(row, p.playedMove, p.bestMove);
    row.signals.deepSearchSelected = true;
    row.signals.adiScore = Math.max(row.signals.adiScore ?? 0, p.adiScore);
    row.signals.bsiScore = Math.max(row.signals.bsiScore ?? 0, p.bsiScore ?? 0);
    addScore(row, 24 + Math.min(10, p.selectionScore * 10), "deepSearchPlan");
  }

  for (const r of Array.from(deepOk.values())) {
    if (isFinalPositionTurn(r.turnIndex, input.analysisPlan, input.turnAnalyses)) {
      continue;
    }
    const row = getCandidate(map, r.turnIndex);
    mergeMoveInfo(row, r.playedMove, r.comparison.deepBestMove ?? r.plannedBestMove);
    const pv = extractPvFromTopMove(r.katago.topMove);
    mergeDeepPv(row, pv);
    mergePv(row, pv);
    row.signals.deepSearchCompleted = true;
    row.signals.deepSearchChangedTop = r.comparison.plannedBestMoveStillTop === false;
    addScore(row, r.comparison.plannedBestMoveStillTop === false ? 22 : 18, "deepSearchResults");
  }

  for (const s of input.adi?.signals ?? []) {
    if (s.status !== "scored" || isFinalPositionTurn(s.turnIndex, input.analysisPlan, input.turnAnalyses)) {
      continue;
    }
    const row = getCandidate(map, s.turnIndex);
    mergeMoveInfo(row, s.playedMove, s.bestMove);
    const score = s.adiScore ?? 0;
    row.signals.adiScore = Math.max(row.signals.adiScore ?? 0, score);
    if (score >= 0.65) {
      addScore(row, 22 + Math.min(12, (score - 0.65) * 40), "adiV1");
    } else if (score >= 0.5 || s.deepSearchCandidate) {
      addScore(row, 12, "adiV1");
    }
  }

  for (const s of input.bsi?.signals ?? []) {
    if (s.interpretationStatus !== "verified") continue;
    if (s.status !== "scored" || isFinalPositionTurn(s.turnIndex, input.analysisPlan, input.turnAnalyses)) {
      continue;
    }
    const row = getCandidate(map, s.turnIndex);
    mergeMoveInfo(row, s.playedMove, s.bestMove);
    const score = s.bsiScore ?? 0;
    row.signals.bsiScore = Math.max(row.signals.bsiScore ?? 0, score);
    if (s.winrateBestMinusPlayed != null || s.winrateDelta != null) {
      row.signals.winrateDelta = Math.max(row.signals.winrateDelta ?? 0, (s.winrateBestMinusPlayed ?? s.winrateDelta ?? 0) * 100);
    }
    if (s.scoreBestMinusPlayed != null || s.scoreDelta != null) {
      row.signals.scoreLeadDelta = Math.max(row.signals.scoreLeadDelta ?? 0, s.scoreBestMinusPlayed ?? s.scoreDelta ?? 0);
    }
    if (score >= 60) {
      addScore(row, s.interpretationStatus === "verified" ? 27 : 22, "bsiV1");
    } else if (score >= 45) {
      addScore(row, 15, "bsiV1");
    } else if (score >= 30) {
      addScore(row, 8, "bsiV1");
    }
  }

  const timeline = input.winrateTimeline;
  if (timeline?.enabled && timeline.points.length > 1) {
    const okPoints = [...timeline.points].filter((p) => p.status === "ok").sort((a, b) => a.turnIndex - b.turnIndex);
    for (let i = 1; i < okPoints.length; i += 1) {
      const prev = okPoints[i - 1]!;
      const cur = okPoints[i]!;
      if (isFinalPositionTurn(cur.turnIndex, input.analysisPlan, input.turnAnalyses)) {
        continue;
      }
      const row = getCandidate(map, cur.turnIndex);
      mergeMoveInfo(row, cur.playedMove, null);

      if (prev.displayWinrate != null && cur.displayWinrate != null) {
        const delta = Math.abs(cur.displayWinrate - prev.displayWinrate);
        row.signals.winrateDelta = Math.max(row.signals.winrateDelta ?? 0, Math.round(delta * 100) / 100);
        if (delta >= 10) {
          addScore(row, Math.min(24, 10 + delta * 0.8), "winrateTimelineV1");
        }
      }
      if (prev.scoreLead != null && cur.scoreLead != null) {
        const delta = Math.abs(cur.scoreLead - prev.scoreLead);
        row.signals.scoreLeadDelta = Math.max(row.signals.scoreLeadDelta ?? 0, Math.round(delta * 100) / 100);
        if (delta >= 4) {
          addScore(row, Math.min(22, 8 + delta * 1.5), "winrateTimelineV1");
        }
      }
    }
  }

  const events = Array.from(map.values())
    .filter((row) => row.score > 0 && !isFinalPositionTurn(row.turnIndex, input.analysisPlan, input.turnAnalyses))
    .map(buildEvent)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.turnIndex - b.turnIndex;
    })
    .slice(0, 5);

  return { version: ANALYSIS_LEARNING_EVENTS_V1_VERSION, events };
}

export function isAnalysisLearningEventsV1(v: unknown): v is AnalysisLearningEventsV1 {
  return (
    isPlainObject(v) &&
    v.version === ANALYSIS_LEARNING_EVENTS_V1_VERSION &&
    Array.isArray(v.events) &&
    v.events.every(isAnalysisLearningEventV1)
  );
}

export function normalizeAnalysisLearningEventsV1(
  value: AnalysisLearningEventsV1,
  context?: Pick<BuildAnalysisLearningEventsV1Input, "analysisPlan" | "turnAnalyses">
): AnalysisLearningEventsV1 {
  const byTurn = new Map<number, AnalysisLearningEventV1>();
  const normalized = value.events
    .map((event) => ({
      ...event,
      turnIndex: event.turnIndex,
      score: clampScore(event.score),
      signals: { ...event.signals },
      evidence: {
        source: [...event.evidence.source],
        ...(event.evidence.pv ? { pv: [...event.evidence.pv] } : {}),
        ...(event.evidence.deepSearchPv ? { deepSearchPv: [...event.evidence.deepSearchPv] } : {}),
        ...(event.evidence.notes ? { notes: [...event.evidence.notes] } : {}),
      },
    }));
  const sorted = normalized
    .filter((event) => !isFinalPositionTurn(event.turnIndex, context?.analysisPlan, context?.turnAnalyses))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.turnIndex - b.turnIndex;
    });

  for (const event of sorted) {
    if (byTurn.has(event.turnIndex)) {
      continue;
    }
    byTurn.set(event.turnIndex, event);
    if (byTurn.size >= 5) {
      break;
    }
  }

  return {
    version: ANALYSIS_LEARNING_EVENTS_V1_VERSION,
    events: Array.from(byTurn.values()),
  };
}
