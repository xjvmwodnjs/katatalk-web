export type KatagoResultQualitySeverity = "fail" | "warn";

export type KatagoResultQualityCode =
  | "RESULT_NOT_OBJECT"
  | "RESULT_NOT_OK"
  | "SOURCE_NOT_KATAGO_WORKER_V1"
  | "RESULT_MARKED_MOCK"
  | "ENGINE_INVALID"
  | "KATAGO_WINRATE_PERSPECTIVE_UNVERIFIED"
  | "INPUT_HASH_INVALID"
  | "INPUT_SIZE_INVALID"
  | "KATAGO_ROOT_INFO_MISSING"
  | "KATAGO_MOVE_INFOS_MISSING"
  | "KATAGO_WINRATE_MISSING"
  | "KATAGO_TOP_MOVE_MISSING"
  | "GAME_TOTAL_MOVES_INVALID"
  | "ANALYSIS_PLAN_MISSING"
  | "ANALYSIS_PLAN_TOTAL_MOVES_MISMATCH"
  | "SCORE_LEAD_MISSING"
  | "NO_TURN_ANALYSIS_OK"
  | "NO_BSI_SIGNALS"
  | "NO_ADI_SIGNALS"
  | "DEEP_SEARCH_ENABLED_WITHOUT_COMPLETION";

export type KatagoResultQualityIssue = {
  severity: KatagoResultQualitySeverity;
  code: KatagoResultQualityCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
};

export type KatagoResultQualityReport = {
  ok: boolean;
  failureCount: number;
  warningCount: number;
  issues: KatagoResultQualityIssue[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function addIssue(
  issues: KatagoResultQualityIssue[],
  issue: KatagoResultQualityIssue
): void {
  issues.push(issue);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function nonEmptyObject(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && Object.keys(value).length > 0;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function countOkTurnAnalyses(value: unknown): number {
  if (!Array.isArray(value)) {
    return 0;
  }
  return value.filter(row => isPlainObject(row) && row.status === "ok").length;
}

function countSignals(value: unknown): number {
  if (!isPlainObject(value) || !Array.isArray(value.signals)) {
    return 0;
  }
  return value.signals.length;
}

function readAnalysisPlanTotalMoves(value: unknown): number | null {
  if (!isPlainObject(value)) {
    return null;
  }
  if (value.version !== "analysis-plan-v1") {
    return null;
  }
  return integerValue(value.totalMoves);
}

function readGameTotalMoves(value: unknown): number | null {
  if (!isPlainObject(value)) {
    return null;
  }
  return integerValue(value.total_moves);
}

export function evaluateKatagoResultQuality(
  result: unknown
): KatagoResultQualityReport {
  const issues: KatagoResultQualityIssue[] = [];

  if (!isPlainObject(result)) {
    addIssue(issues, {
      severity: "fail",
      code: "RESULT_NOT_OBJECT",
      message: "KataGo result must be a JSON object.",
    });
    return finish(issues);
  }

  if (result.ok !== true) {
    addIssue(issues, {
      severity: "fail",
      code: "RESULT_NOT_OK",
      message: "KataGo result must have ok=true.",
    });
  }

  if (result.source !== "katago-worker-v1") {
    addIssue(issues, {
      severity: "fail",
      code: "SOURCE_NOT_KATAGO_WORKER_V1",
      message: "KataGo result source must be katago-worker-v1.",
    });
  }

  if (result.isMock === true) {
    addIssue(issues, {
      severity: "fail",
      code: "RESULT_MARKED_MOCK",
      message: "KataGo result must not be marked as mock.",
    });
  }

  const engine = isPlainObject(result.engine) ? result.engine : null;
  if (
    engine?.name !== "katago" ||
    numberValue(engine?.maxVisits) == null ||
    numberValue(engine?.maxVisits)! <= 0
  ) {
    addIssue(issues, {
      severity: "fail",
      code: "ENGINE_INVALID",
      message:
        "KataGo result must include engine.name=katago and positive maxVisits.",
    });
  }
  if (
    engine?.winratePerspective !== "black" &&
    engine?.winratePerspective !== "white" &&
    engine?.winratePerspective !== "side_to_move"
  ) {
    addIssue(issues, {
      severity: "fail",
      code: "KATAGO_WINRATE_PERSPECTIVE_UNVERIFIED",
      message:
        "KataGo result must record a verified reportAnalysisWinratesAs perspective.",
    });
  }

  const input = isPlainObject(result.input) ? result.input : null;
  const hash = nonEmptyString(input?.sgfSha256);
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
    addIssue(issues, {
      severity: "fail",
      code: "INPUT_HASH_INVALID",
      message: "KataGo result must include a valid SGF SHA-256 hash.",
    });
  }
  const sizeBytes = numberValue(input?.sgfSizeBytes);
  if (sizeBytes == null || sizeBytes <= 0) {
    addIssue(issues, {
      severity: "fail",
      code: "INPUT_SIZE_INVALID",
      message: "KataGo result must include a positive SGF byte length.",
    });
  }

  const katago = isPlainObject(result.katago) ? result.katago : null;
  if (!nonEmptyObject(katago?.rootInfo)) {
    addIssue(issues, {
      severity: "fail",
      code: "KATAGO_ROOT_INFO_MISSING",
      message: "KataGo result must include non-empty rootInfo.",
    });
  }
  const moveInfosCount = integerValue(katago?.moveInfosCount);
  if (moveInfosCount == null || moveInfosCount <= 0) {
    addIssue(issues, {
      severity: "fail",
      code: "KATAGO_MOVE_INFOS_MISSING",
      message: "KataGo result must include at least one moveInfo row.",
    });
  }
  if (katago?.hasWinrate !== true) {
    addIssue(issues, {
      severity: "fail",
      code: "KATAGO_WINRATE_MISSING",
      message: "KataGo result must include winrate evidence.",
    });
  }
  const topMove = isPlainObject(katago?.topMove) ? katago?.topMove : null;
  if (!topMove || !nonEmptyString(topMove.move)) {
    addIssue(issues, {
      severity: "fail",
      code: "KATAGO_TOP_MOVE_MISSING",
      message: "KataGo result must include topMove.move.",
    });
  }
  if (katago?.hasScoreLead !== true) {
    addIssue(issues, {
      severity: "warn",
      code: "SCORE_LEAD_MISSING",
      message:
        "KataGo result has no score lead evidence; some explanations will be weaker.",
    });
  }

  const gameTotalMoves = readGameTotalMoves(result.game_info);
  if (gameTotalMoves == null || gameTotalMoves <= 0) {
    addIssue(issues, {
      severity: "fail",
      code: "GAME_TOTAL_MOVES_INVALID",
      message: "KataGo result must include game_info.total_moves > 0.",
    });
  }

  const planTotalMoves = readAnalysisPlanTotalMoves(result.analysisPlan);
  if (planTotalMoves == null || planTotalMoves <= 0) {
    addIssue(issues, {
      severity: "fail",
      code: "ANALYSIS_PLAN_MISSING",
      message:
        "KataGo result must include analysisPlan v1 with totalMoves > 0.",
    });
  } else if (
    gameTotalMoves != null &&
    gameTotalMoves > 0 &&
    planTotalMoves !== gameTotalMoves
  ) {
    addIssue(issues, {
      severity: "fail",
      code: "ANALYSIS_PLAN_TOTAL_MOVES_MISMATCH",
      message: "analysisPlan.totalMoves must match game_info.total_moves.",
      details: { gameTotalMoves, planTotalMoves },
    });
  }

  const okTurnCount = countOkTurnAnalyses(result.turnAnalyses);
  if (okTurnCount === 0) {
    addIssue(issues, {
      severity: "warn",
      code: "NO_TURN_ANALYSIS_OK",
      message: "No successful multi-turn analysis rows were found.",
    });
  }
  if (countSignals(result.bsiV1) === 0) {
    addIssue(issues, {
      severity: "warn",
      code: "NO_BSI_SIGNALS",
      message: "No BSI signals were found.",
    });
  }
  if (countSignals(result.adiV1) === 0) {
    addIssue(issues, {
      severity: "warn",
      code: "NO_ADI_SIGNALS",
      message: "No ADI signals were found.",
    });
  }

  const deep = isPlainObject(result.deepSearchResults)
    ? result.deepSearchResults
    : null;
  if (deep?.enabled === true && numberValue(deep.completedCount) === 0) {
    addIssue(issues, {
      severity: "warn",
      code: "DEEP_SEARCH_ENABLED_WITHOUT_COMPLETION",
      message: "Deep Search was enabled but no candidate completed.",
    });
  }

  return finish(issues);
}

function finish(issues: KatagoResultQualityIssue[]): KatagoResultQualityReport {
  const failureCount = issues.filter(issue => issue.severity === "fail").length;
  const warningCount = issues.filter(issue => issue.severity === "warn").length;
  return {
    ok: failureCount === 0,
    failureCount,
    warningCount,
    issues,
  };
}

export function assertKatagoResultQualityForCompletion(
  result: unknown
): KatagoResultQualityReport {
  const report = evaluateKatagoResultQuality(result);
  if (!report.ok) {
    const codes = report.issues
      .filter(issue => issue.severity === "fail")
      .map(issue => issue.code);
    throw new Error(`KATAGO_RESULT_QUALITY_FAILED: ${codes.join(",")}`);
  }
  return report;
}
