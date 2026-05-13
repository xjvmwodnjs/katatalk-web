import type { AnalysisJobLanguage } from "../../analysisJobStore.types";
import { buildMockAnalysisReport } from "../../mockAnalysisResult";
import type { AnalyzeSgfInput, NormalizedAnalysisResult } from "./types";

const SUPPORTED = new Set<AnalysisJobLanguage>(["ko", "en", "zh", "ja"]);

function coerceLanguage(raw: string): AnalysisJobLanguage {
  if (raw && SUPPORTED.has(raw as AnalysisJobLanguage)) {
    return raw as AnalysisJobLanguage;
  }
  return "ko";
}

/** mock 엔진 — SGF 내용 없이도 기존 mock 리포트 shape 유지 (sgf_content 는 KataGo 전 단계 검증용으로만 전달). */
export async function analyzeSgfMock(input: AnalyzeSgfInput): Promise<NormalizedAnalysisResult> {
  const language = coerceLanguage(input.language);
  return buildMockAnalysisReport({
    fileName: input.fileName,
    language,
  }) as NormalizedAnalysisResult;
}
