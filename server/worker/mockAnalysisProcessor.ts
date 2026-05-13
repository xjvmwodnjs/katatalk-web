import type { AnalysisJobLanguage } from "../analysisJobStore.types";
import { refundCreditIfJobFailedByProfileId } from "../creditService";
import { runMockAnalysisDbPipeline } from "../mockAnalysisDbPipeline";

const SUPPORTED = new Set<AnalysisJobLanguage>(["ko", "en", "zh", "ja"]);

function coerceLanguage(raw: string | null | undefined): AnalysisJobLanguage {
  if (raw && SUPPORTED.has(raw as AnalysisJobLanguage)) {
    return raw as AnalysisJobLanguage;
  }
  return "ko";
}

/** Claim 된 running 행을 mock 완료까지 진행한다. */
export async function processMockAnalysisJob(row: {
  id: string;
  user_id: string;
  file_name: string | null;
  language: string | null;
  credit_cost: number;
}): Promise<void> {
  const fileName = row.file_name?.trim() || "uploaded.sgf";
  const language = coerceLanguage(row.language);
  await runMockAnalysisDbPipeline({
    jobId: row.id,
    fileName,
    language,
    onJobFailed: () => refundCreditIfJobFailedByProfileId(row.user_id, row.id, row.credit_cost),
  });
}
