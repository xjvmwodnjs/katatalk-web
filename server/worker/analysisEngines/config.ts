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
