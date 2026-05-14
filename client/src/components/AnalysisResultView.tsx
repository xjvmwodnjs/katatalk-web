import { useEffect, useMemo, useState } from "react";
import { buildAnalysisResultViewModel } from "@/lib/analysisResultViewModel";
import type { Language } from "@/lib/mockData";
import AnalysisWinratePanel from "@/components/AnalysisWinratePanel";
import AnalysisCandidateList from "@/components/AnalysisCandidateList";
import AnalysisVariationPreview from "@/components/AnalysisVariationPreview";

type Props = {
  data: unknown;
  lang: Language;
};

const COPY: Record<
  Language,
  {
    beta: string;
    mockBanner: string;
    unknownBanner: string;
    boardPh: string;
    boardBadge: string;
    summaryTitle: string;
    engine: string;
    moves: string;
    flags: string;
    dsOn: string;
    dsOff: string;
  }
> = {
  ko: {
    beta: "현재 결과는 KataGo 수치 기반 베타 참고 정보이며, 수순에 대한 최종 판단이나 해설은 제공하지 않습니다.",
    mockBanner: "데모용 예시 결과입니다. 실제 KataGo 분석 결과가 아닙니다.",
    unknownBanner: "지원하지 않는 결과 형식입니다.",
    boardPh: "바둑판 재생은 다음 단계에서 제공됩니다.",
    boardBadge: "준비 중 · 다음 단계 제공 예정",
    summaryTitle: "분석 요약",
    engine: "엔진",
    moves: "총 수순",
    flags: "신호·플랜",
    dsOn: "Deep Search 실행됨",
    dsOff: "Deep Search 미실행(요약만)",
  },
  en: {
    beta: "Beta numeric reference from KataGo — no final judgment or move-by-move teaching text.",
    mockBanner: "Demo sample result — not a live KataGo analysis output.",
    unknownBanner: "Unsupported result format.",
    boardPh: "Board replay will arrive in a later release.",
    boardBadge: "Coming soon — next release",
    summaryTitle: "Analysis summary",
    engine: "Engine",
    moves: "Total moves",
    flags: "Signals / plan",
    dsOn: "Deep Search ran",
    dsOff: "Deep Search off (summary only)",
  },
  zh: {
    beta: "当前为 KataGo 数值型内测参考信息，不提供对每手的最终判断或讲解文本。",
    mockBanner: "演示用示例，不是真实 KataGo 分析结果。",
    unknownBanner: "不支持的结果格式。",
    boardPh: "棋盘回放将在后续版本提供。",
    boardBadge: "准备中 · 下阶段提供",
    summaryTitle: "分析摘要",
    engine: "引擎",
    moves: "总手数",
    flags: "信号与计划",
    dsOn: "已运行 Deep Search",
    dsOff: "Deep Search 关闭（仅摘要）",
  },
  ja: {
    beta: "KataGo 数値ベータの参考情報であり、各手の最終判断や解説テキストは提供しません。",
    mockBanner: "デモ用のサンプルで、本番の KataGo 解析ではありません。",
    unknownBanner: "未対応の結果形式です。",
    boardPh: "盤面再生は次の段階で提供予定です。",
    boardBadge: "準備中 · 次段階で提供予定",
    summaryTitle: "分析サマリ",
    engine: "エンジン",
    moves: "総手数",
    flags: "シグナル/プラン",
    dsOn: "Deep Search 実行",
    dsOff: "Deep Search オフ（要約のみ）",
  },
};

export default function AnalysisResultView({ data, lang }: Props) {
  const vm = useMemo(() => buildAnalysisResultViewModel(data), [data]);
  const t = COPY[lang];
  const [selectedTurnIndex, setSelectedTurnIndex] = useState<number | null>(null);

  useEffect(() => {
    if (vm.kind === "katago-worker-v1") {
      const first = vm.keyMoveCandidates[0]?.turnIndex ?? vm.graph.winrateSeries[0]?.turnIndex ?? null;
      setSelectedTurnIndex(first);
    } else {
      setSelectedTurnIndex(null);
    }
  }, [vm]);

  if (vm.kind === "mock-legacy") {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-6 md:p-8 mb-8">
        <p className="text-amber-100 font-medium mb-2" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
          {t.mockBanner}
        </p>
        <p className="text-sm text-slate-400">{t.beta}</p>
      </div>
    );
  }

  if (vm.kind === "unknown") {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-6 md:p-8 mb-8">
        <p className="text-red-100 font-medium">{t.unknownBanner}</p>
      </div>
    );
  }

  const s = vm.summary;
  return (
    <div className="space-y-6 mb-8">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-8">
        <div className="mb-2 text-xs font-medium uppercase tracking-widest text-amber-400/80 font-mono">v1</div>
        <h1
          className="text-2xl md:text-3xl font-bold text-amber-100 mb-2"
          style={{ fontFamily: "'Noto Serif KR', serif" }}
        >
          {t.summaryTitle}
        </h1>
        <p className="text-sm text-amber-50/90 mb-4 border-l-2 border-amber-400/50 pl-3">{t.beta}</p>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <div className="rounded-lg bg-black/20 px-3 py-2 border border-white/5">
            <dt className="text-slate-500 text-xs">{t.engine}</dt>
            <dd className="text-amber-100 font-mono">{s.engine}</dd>
          </div>
          <div className="rounded-lg bg-black/20 px-3 py-2 border border-white/5">
            <dt className="text-slate-500 text-xs">{t.moves}</dt>
            <dd className="text-amber-100 font-mono">{s.totalMoves}</dd>
          </div>
          <div className="rounded-lg bg-black/20 px-3 py-2 border border-white/5 sm:col-span-2 lg:col-span-1">
            <dt className="text-slate-500 text-xs">{t.flags}</dt>
            <dd className="text-amber-100 font-mono text-xs leading-relaxed">
              MT:{s.hasMultiTurn ? "Y" : "N"} · BSI:{s.hasBsi ? "Y" : "N"} · ADI:{s.hasAdi ? "Y" : "N"} · DSP:
              {s.hasDeepSearchPlan ? "Y" : "N"} · DSR:{s.hasDeepSearchResults ? "Y" : "N"}
            </dd>
          </div>
          <div className="rounded-lg bg-black/20 px-3 py-2 border border-white/5 sm:col-span-2 lg:col-span-3">
            <dt className="text-slate-500 text-xs">Deep Search</dt>
            <dd className="text-amber-100 text-sm">{s.deepSearchEnabled ? t.dsOn : t.dsOff}</dd>
          </div>
        </dl>
        {/* TODO(i18n): ViewModel warnings are Korean-only strings — move to locale packs with EN/ZH/JA. */}
        {vm.warnings.length > 0 ? (
          <ul className="mt-4 text-xs text-slate-400 space-y-1 list-disc pl-5">
            {vm.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <AnalysisWinratePanel
        series={vm.graph.winrateSeries}
        selectedTurnIndex={selectedTurnIndex}
        onSelectTurnIndex={setSelectedTurnIndex}
        lang={lang}
      />

      <AnalysisCandidateList
        raw={data}
        candidates={vm.keyMoveCandidates}
        selectedTurnIndex={selectedTurnIndex}
        onSelectTurnIndex={setSelectedTurnIndex}
        lang={lang}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <AnalysisVariationPreview
          previews={vm.variationPreview}
          selectedTurnIndex={selectedTurnIndex}
          lang={lang}
        />
        <section className="rounded-2xl border border-dashed border-white/15 bg-black/15 p-6 flex flex-col justify-center min-h-[200px]">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">
              {lang === "ko" ? "바둑판" : lang === "en" ? "Board" : lang === "zh" ? "棋盘" : "碁盤"}
            </h3>
            <span
              className="text-[10px] px-2 py-0.5 rounded-full border border-white/15 text-slate-500 font-mono uppercase tracking-wide"
              aria-label={t.boardBadge}
            >
              {t.boardBadge}
            </span>
          </div>
          <p className="text-sm text-slate-500">{t.boardPh}</p>
        </section>
      </div>
    </div>
  );
}
