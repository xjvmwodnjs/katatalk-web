import type { AnalysisJobLanguage } from "../analysisJobStore.types";
import type { AnalysisJobDbRow } from "../creditService";
import { refundCreditIfJobFailedByProfileId } from "../creditService";
import { runMockAnalysisDbPipeline } from "../mockAnalysisDbPipeline";
import { getAnalysisEngineName } from "./analysisEngines";
import { runKatagoAnalysisDbPipeline } from "./katagoAnalysisDbPipeline";

const SUPPORTED = new Set<AnalysisJobLanguage>(["ko", "en", "zh", "ja"]);

function coerceLanguage(raw: string | null | undefined): AnalysisJobLanguage {
  if (raw && SUPPORTED.has(raw as AnalysisJobLanguage)) {
    return raw as AnalysisJobLanguage;
  }
  return "ko";
}

/** Claim 된 `analysis_jobs` 행을 `ANALYSIS_ENGINE` 에 따라 처리한다. */
export async function processClaimedAnalysisJob(row: AnalysisJobDbRow): Promise<void> {
  const engine = getAnalysisEngineName();
  const fileName = row.file_name?.trim() || "uploaded.sgf";
  const language = coerceLanguage(row.language);
  const onFail = () => refundCreditIfJobFailedByProfileId(row.user_id, row.id, row.credit_cost);

  if (engine === "katago") {
    await runKatagoAnalysisDbPipeline({
      jobId: row.id,
      row,
      fileName,
      language,
      onJobFailed: onFail,
    });
    return;
  }

  await runMockAnalysisDbPipeline({
    jobId: row.id,
    fileName,
    language,
    onJobFailed: onFail,
  });
}
