export type AnalysisEngineName = "mock" | "katago";

export function getAnalysisEngineName(): AnalysisEngineName {
  const raw = process.env.ANALYSIS_ENGINE?.trim().toLowerCase();
  if (raw === "katago") {
    return "katago";
  }
  return "mock";
}

/** ANALYSIS_ENGINE=katago 일 때 worker 기동 전 검증 */
export function assertKatagoPathsConfiguredOrThrow(): void {
  const bin = process.env.KATAGO_BINARY_PATH?.trim();
  const cfg = process.env.KATAGO_CONFIG_PATH?.trim();
  const model = process.env.KATAGO_MODEL_PATH?.trim();
  if (!bin || !cfg || !model) {
    throw new Error(
      "운영/워커 기동 실패: ANALYSIS_ENGINE=katago 인데 KATAGO_BINARY_PATH, KATAGO_CONFIG_PATH, KATAGO_MODEL_PATH 중 일부가 비어 있습니다."
    );
  }
}

export function readKatagoMaxVisitsFrom(env: NodeJS.ProcessEnv): number {
  const raw = env.KATAGO_MAX_VISITS?.trim();
  const n = raw != null && raw !== "" ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 200;
}

export function readKatagoTimeoutMsFrom(env: NodeJS.ProcessEnv): number {
  const raw = env.KATAGO_ANALYSIS_TIMEOUT_MS?.trim();
  const n = raw != null && raw !== "" ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 120_000;
}

export function readKatagoMaxVisits(): number {
  return readKatagoMaxVisitsFrom(process.env);
}

export function readKatagoTimeoutMs(): number {
  return readKatagoTimeoutMsFrom(process.env);
}

/** multi-turn 후보 최대 개수 (0이면 multi-turn 생략). 기본 6 */
export function readKatagoMultiTurnMaxFrom(env: NodeJS.ProcessEnv): number {
  const raw = env.KATAGO_MULTI_TURN_MAX?.trim();
  const n = raw != null && raw !== "" ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 6;
}

/** 미설정 시 `readKatagoMaxVisitsFrom` 과 동일 */
export function readKatagoMultiTurnMaxVisitsFrom(env: NodeJS.ProcessEnv, fallbackMax: number): number {
  const raw = env.KATAGO_MULTI_TURN_MAX_VISITS?.trim();
  const n = raw != null && raw !== "" ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallbackMax;
}

/** 한 줄(한 수순) 분석에 쓰는 타임아웃. 미설정 시 전체 분석과 동일 */
export function readKatagoMultiTurnQueryTimeoutMsFrom(env: NodeJS.ProcessEnv): number {
  const raw = env.KATAGO_MULTI_TURN_QUERY_TIMEOUT_MS?.trim();
  const n = raw != null && raw !== "" ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : readKatagoTimeoutMsFrom(env);
}

/**
 * stdin 에 여러 JSON 줄을 한 번에 보낼 때의 배치 타임아웃.
 * 미설정 시 `max(KATAGO_ANALYSIS_TIMEOUT_MS, perQuery * 줄수)` 상한 900000ms.
 */
export function readKatagoMultiTurnBatchTimeoutMsFrom(env: NodeJS.ProcessEnv, lineCount: number): number {
  const explicit = env.KATAGO_MULTI_TURN_BATCH_TIMEOUT_MS?.trim();
  if (explicit) {
    const n = Number.parseInt(explicit, 10);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  const per = readKatagoTimeoutMsFrom(env);
  const scaled = per * Math.max(1, lineCount);
  return Math.min(900_000, Math.max(per, scaled));
}
