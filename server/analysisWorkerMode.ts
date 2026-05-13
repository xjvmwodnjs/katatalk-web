/**
 * 분석 mock 실행 위치: Express 인라인 타이머 vs 별도 worker 프로세스.
 * production 기본값 external — Railway 등에서 Web + Worker 서비스 분리 권장.
 */

export type AnalysisWorkerMode = "inline" | "external";

export function getAnalysisWorkerMode(): AnalysisWorkerMode {
  const raw = process.env.ANALYSIS_WORKER_MODE?.trim().toLowerCase();
  if (raw === "inline" || raw === "external") {
    return raw;
  }
  if (process.env.NODE_ENV === "production") {
    return "external";
  }
  return "inline";
}
