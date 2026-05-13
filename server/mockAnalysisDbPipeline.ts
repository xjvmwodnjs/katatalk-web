import type { AnalysisJobLanguage } from "./analysisJobStore.types";
import { buildMockAnalysisReport } from "./mockAnalysisResult";
import { updateAnalysisJobRow } from "./creditService";

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Supabase analysis_jobs 행을 단계적으로 갱신하는 mock 파이프라인.
 * Express 인라인(inline)과 별도 worker 가 동일 로직을 공유한다.
 */
export async function runMockAnalysisDbPipeline(args: {
  jobId: string;
  fileName: string;
  language: AnalysisJobLanguage;
  onJobFailed?: () => void | Promise<void>;
}): Promise<void> {
  const { jobId, fileName, language, onJobFailed } = args;
  try {
    await sleep(350);
    await updateAnalysisJobRow(jobId, { status: "running", progress: 25 });

    await sleep(450);
    await updateAnalysisJobRow(jobId, { status: "running", progress: 55 });

    await sleep(400);
    await updateAnalysisJobRow(jobId, { status: "running", progress: 85 });

    await sleep(300);

    const data = buildMockAnalysisReport({ fileName, language });
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
      console.error("[mockAnalysisDbPipeline] failed to persist failure state", patchErr);
    }
    try {
      await onJobFailed?.();
    } catch (refundErr) {
      console.error("[mockAnalysisDbPipeline] onJobFailed refund error", refundErr);
    }
  }
}
