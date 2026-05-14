import AnalysisResultView from "@/components/AnalysisResultView";
import type { Language } from "@/lib/mockData";

export type KatagoWorkerV1ResultData = Record<string, unknown>;

interface KatagoWorkerV1ResultPanelProps {
  data: KatagoWorkerV1ResultData;
  lang: Language;
}

/** @deprecated Prefer `AnalysisResultView` — thin wrapper for legacy import sites */
export default function KatagoWorkerV1ResultPanel({ data, lang }: KatagoWorkerV1ResultPanelProps) {
  return <AnalysisResultView data={data} lang={lang} />;
}
