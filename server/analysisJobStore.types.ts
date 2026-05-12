/**
 * Server-side mock 분석 파이프라인 페이로드.
 * 상태·결과의 근원은 Supabase `analysis_jobs` 이다.
 */

export type AnalysisJobLanguage = "ko" | "en" | "zh" | "ja";

/** Mock 파이프라인에 필요한 최소 필드 (SGF 원문은 저장하지 않음). */
export type AnalysisJobEnqueuePayload = {
  fileName: string;
  language: AnalysisJobLanguage;
};

export interface AnalysisJobStore {
  createAndEnqueueMock(args: {
    jobId: string;
    payload: AnalysisJobEnqueuePayload;
    onJobFailed?: () => void | Promise<void>;
  }): void;
}
