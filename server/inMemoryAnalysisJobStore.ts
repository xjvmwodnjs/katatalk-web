import type { AnalysisJobEnqueuePayload } from "./analysisJobStore.types";
import { runMockAnalysisDbPipeline } from "./mockAnalysisDbPipeline";

/**
 * Mock 분석 인라인 스케줄러(Express 프로세스 내).
 * `ANALYSIS_WORKER_MODE=external` 이면 POST /api/analyze 는 이 경로를 쓰지 않고,
 * 별도 worker 가 Supabase `claim_next_analysis_job`(lease·stale 재claim, 007+) + 동일 파이프라인으로 처리한다.
 */
export class InMemoryAnalysisJobStore {
  createAndEnqueueMock(args: {
    jobId: string;
    payload: AnalysisJobEnqueuePayload;
    onJobFailed?: () => void | Promise<void>;
  }): void {
    void runMockAnalysisDbPipeline({
      jobId: args.jobId,
      fileName: args.payload.fileName,
      language: args.payload.language,
      onJobFailed: args.onJobFailed,
    });
  }
}

/** Singleton for the Express app until DI / queue wiring exists. */
export const analysisJobStore = new InMemoryAnalysisJobStore();
