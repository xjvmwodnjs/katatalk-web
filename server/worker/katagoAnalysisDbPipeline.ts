import type { AnalysisJobDbRow } from "../creditService";
import { updateAnalysisJobRow } from "../creditService";
import { analyzeSgfKatagoStub, readKatagoMaxVisits, readKatagoTimeoutMs } from "./analysisEngines";

/**
 * KataGo 분석용 DB 파이프라인 (현재 엔진은 stub — 완료 전까지 failed + 환불 위주).
 */
export async function runKatagoAnalysisDbPipeline(args: {
  jobId: string;
  row: AnalysisJobDbRow;
  fileName: string;
  language: string;
  onJobFailed?: () => void | Promise<void>;
}): Promise<void> {
  const { jobId, row, fileName, language, onJobFailed } = args;
  try {
    const content = typeof row.sgf_content === "string" ? row.sgf_content : null;
    if (!content?.trim()) {
      await updateAnalysisJobRow(jobId, {
        status: "failed",
        progress: null,
        error_message: "MISSING_SGF_CONTENT: KataGo 분석에는 저장된 SGF 원문이 필요합니다.",
        completed_at: new Date().toISOString(),
      });
      await onJobFailed?.();
      return;
    }

    await updateAnalysisJobRow(jobId, { status: "running", progress: 15 });

    void readKatagoTimeoutMs;
    const result = await analyzeSgfKatagoStub({
      jobId,
      sgfContent: content,
      language,
      maxVisits: readKatagoMaxVisits(),
      fileName,
    });

    await updateAnalysisJobRow(jobId, {
      status: "completed",
      progress: 100,
      result,
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
      console.error("[katagoAnalysisDbPipeline] failed to persist failure state", patchErr);
    }
    try {
      await onJobFailed?.();
    } catch (refundErr) {
      console.error("[katagoAnalysisDbPipeline] onJobFailed refund error", refundErr);
    }
  }
}
