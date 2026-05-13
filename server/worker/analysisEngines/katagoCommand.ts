import { basename } from "node:path";

export type KatagoPaths = {
  binary: string;
  config: string;
  model: string;
};

const MSG = {
  binary:
    "환경 변수 KATAGO_BINARY_PATH 가 비어 있습니다. 로컬에 설치한 KataGo 실행 파일의 절대 경로를 .env 에 설정하세요.",
  config:
    "환경 변수 KATAGO_CONFIG_PATH 가 비어 있습니다. KataGo 분석용 config 파일(.cfg 등)의 절대 경로를 .env 에 설정하세요.",
  model:
    "환경 변수 KATAGO_MODEL_PATH 가 비어 있습니다. 모델 파일(.bin.gz 등)의 절대 경로를 .env 에 설정하세요.",
} as const;

/** 로컬 smoke 전용 — 친절한 한국어 메시지. worker 의 assertKatagoPathsConfiguredOrThrow 와 별도. */
export function assertKatagoSmokePathsFromEnv(env: NodeJS.ProcessEnv = process.env): KatagoPaths {
  const binary = env.KATAGO_BINARY_PATH?.trim();
  const config = env.KATAGO_CONFIG_PATH?.trim();
  const model = env.KATAGO_MODEL_PATH?.trim();
  if (!binary) {
    throw new Error(`[katago-smoke] ${MSG.binary}`);
  }
  if (!config) {
    throw new Error(`[katago-smoke] ${MSG.config}`);
  }
  if (!model) {
    throw new Error(`[katago-smoke] ${MSG.model}`);
  }
  return { binary, config, model };
}

/**
 * `katago analysis` CLI 인자 — SGF 는 `-sgf` 가 아니라 **stdin JSON query 한 줄**로 전달한다.
 * (KataGo 버전에 따라 플래그가 다를 수 있음 — 로컬에서 `katago analysis --help` 로 확인.)
 * @see README「KataGo 로컬 smoke test」
 */
export function buildKatagoAnalysisArgv(paths: KatagoPaths): string[] {
  return ["analysis", "-config", paths.config, "-model", paths.model];
}

/** SGF 원문·secret 을 넣지 않는 요약 문자열(로그·normalized 용). */
export function formatKatagoSmokeCommandPreview(binary: string, argv: readonly string[]): string {
  const redacted = argv.map((a) => basename(a));
  return [basename(binary), ...redacted].join(" ");
}
