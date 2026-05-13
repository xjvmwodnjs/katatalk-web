/**
 * 분석 엔진 공통 결과 — mock 과 동일한 JSON shape 를 유지한다.
 * (프론트 폴링·`X-KataTalk-Mock` 등 기존 동작 호환)
 */
export type NormalizedAnalysisResult = Record<string, unknown>;

import type { ChildProcess, StdioOptions } from "node:child_process";

export type KatagoTestSpawnFn = (
  command: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; stdio: StdioOptions }
) => ChildProcess;

export type AnalyzeSgfInput = {
  jobId: string;
  /** 검증된 SGF UTF-8 텍스트 (mock 은 참조만, katago 는 필수) */
  sgfContent: string | null;
  language: string;
  maxVisits: number;
  /** mock 리포트용 표시 파일명 */
  fileName: string;
  /** 단위 테스트 전용 — `runKatagoWorkerAnalysisV1` spawn 주입 (운영에서는 미사용) */
  __testSpawnFn?: KatagoTestSpawnFn;
};

export type AnalysisEngine = {
  analyzeSgf(input: AnalyzeSgfInput): Promise<NormalizedAnalysisResult>;
};
