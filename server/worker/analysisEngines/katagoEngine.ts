import type { AnalyzeSgfInput, NormalizedAnalysisResult } from "./types";

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const n = raw != null && raw !== "" ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * KataGo 실 binary 실행은 아직 연결하지 않는다.
 * 경로 env 가 모두 있어도 이 스tub 은 `KATAGO_NOT_IMPLEMENTED` 로 거절한다.
 */
export async function analyzeSgfKatagoStub(input: AnalyzeSgfInput): Promise<NormalizedAnalysisResult> {
  const bin = process.env.KATAGO_BINARY_PATH?.trim();
  const cfg = process.env.KATAGO_CONFIG_PATH?.trim();
  const model = process.env.KATAGO_MODEL_PATH?.trim();
  if (!bin || !cfg || !model) {
    throw new Error(
      "KATAGO_ENV_MISSING: KATAGO_BINARY_PATH, KATAGO_CONFIG_PATH, KATAGO_MODEL_PATH 가 모두 필요합니다."
    );
  }
  if (!input.sgfContent?.trim()) {
    throw new Error("KATAGO_INPUT_MISSING: sgf_content 가 비어 있습니다.");
  }
  void readIntEnv("KATAGO_MAX_VISITS", 200);
  void readIntEnv("KATAGO_ANALYSIS_TIMEOUT_MS", 120_000);
  throw new Error(
    "KATAGO_NOT_IMPLEMENTED: worker 에서 KataGo 프로세스 실행은 아직 연결하지 않습니다. 로컬에서 raw JSON 수집은 `corepack pnpm katago:smoke -- <sgf>` 로 검증한 뒤 katagoEngine 에 붙일 예정입니다. (adapter stub)"
  );
}
