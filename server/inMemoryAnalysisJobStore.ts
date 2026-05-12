import type { AnalysisJobEnqueuePayload } from "./analysisJobStore.types";
import { buildMockAnalysisReport } from "./mockAnalysisResult";
import { updateAnalysisJobRow } from "./creditService";

/**
 * Mock 분석 파이프라인 스케줄러.
 * 상태·결과의 authoritative source 는 Supabase `analysis_jobs` 이며,
 * 이 모듈은 비동기 타이머로 DB 행만 갱신한다 (인스턴스 간 공유 데이터 없음).
 *
 * 운영(Vercel/serverless)에서는 프로세스 내 타이머가 불안정할 수 있어,
 * 추후 queue/worker 로 교체해야 한다.
 */
export class InMemoryAnalysisJobStore {
  createAndEnqueueMock(args: {
    jobId: string;
    payload: AnalysisJobEnqueuePayload;
    onJobFailed?: () => void | Promise<void>;
  }): void {
    void this.runMockPipeline(args.jobId, args.payload, args.onJobFailed);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async runMockPipeline(
    jobId: string,
    payload: AnalysisJobEnqueuePayload,
    onJobFailed?: () => void | Promise<void>
  ): Promise<void> {
    try {
      await this.sleep(350);
      await updateAnalysisJobRow(jobId, { status: "running", progress: 25 });

      await this.sleep(450);
      await updateAnalysisJobRow(jobId, { status: "running", progress: 55 });

      await this.sleep(400);
      await updateAnalysisJobRow(jobId, { status: "running", progress: 85 });

      await this.sleep(300);

      const data = buildMockAnalysisReport(payload);
      await updateAnalysisJobRow(jobId, {
        status: "completed",
        progress: 100,
        result: data,
        completed_at: new Date().toISOString(),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      try {
        await updateAnalysisJobRow(jobId, {
          status: "failed",
          progress: null,
          error_message: message,
          completed_at: new Date().toISOString(),
        });
      } catch (patchErr) {
        console.error("[inMemoryAnalysisJobStore] failed to persist failure state", patchErr);
      }
      try {
        await onJobFailed?.();
      } catch (refundErr) {
        console.error("[inMemoryAnalysisJobStore] onJobFailed refund error", refundErr);
      }
    }
  }
}

/** Singleton for the Express app until DI / queue wiring exists. */
export const analysisJobStore = new InMemoryAnalysisJobStore();
