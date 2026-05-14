import type { AnalysisResultKeyMoveCandidateV1 } from "@shared/analysisResultViewModel";
import type { Language } from "@/lib/mockData";
import { isFinalPositionTurnFromRaw, mapReasonPhraseForUi, uiTextContainsForbiddenLabel } from "@shared/analysisResultUiHelpers";

type Props = {
  raw: unknown;
  candidates: AnalysisResultKeyMoveCandidateV1[];
  selectedTurnIndex: number | null;
  onSelectTurnIndex: (turnIndex: number) => void;
  lang: Language;
};

export default function AnalysisCandidateList({
  raw,
  candidates,
  selectedTurnIndex,
  onSelectTurnIndex,
  lang,
}: Props) {
  const langKey: "ko" | "en" | "zh" | "ja" = lang;
  const visible = candidates.filter((c) => !isFinalPositionTurnFromRaw(raw, c.turnIndex));

  const title =
    lang === "ko"
      ? "핵심 검토 후보"
      : lang === "en"
        ? "Key review candidates"
        : lang === "zh"
          ? "重点复核候选"
          : "主要な検討候補";

  const emptyMsg =
    lang === "ko"
      ? "표시할 검토 후보가 없습니다."
      : lang === "en"
        ? "No review candidates to show."
        : lang === "zh"
          ? "没有可显示的复核候选。"
          : "表示する検討候補がありません。";

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 mb-6">
      <h2 className="text-lg font-bold text-amber-100 mb-4" style={{ fontFamily: "'Noto Serif KR', serif" }}>
        {title}
      </h2>
      {visible.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyMsg}</p>
      ) : (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((c) => {
          const sel = selectedTurnIndex === c.turnIndex;
          return (
            <button
              key={c.turnIndex}
              type="button"
              onClick={() => onSelectTurnIndex(c.turnIndex)}
              className={`text-left rounded-xl border p-4 transition-colors ${
                sel ? "border-amber-400/60 bg-amber-950/30" : "border-white/10 bg-black/20 hover:border-white/20"
              }`}
            >
              <div className="text-xs font-mono text-amber-400/90 mb-1">
                #{c.turnIndex} · {c.player}
              </div>
              <div className="text-sm text-amber-50 mb-2 font-medium">{c.label}</div>
              <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-slate-300">
                <dt className="text-slate-500">{lang === "ko" ? "실전수" : "Played"}</dt>
                <dd className="font-mono">{c.playedMove}</dd>
                <dt className="text-slate-500">{lang === "ko" ? "후보수" : "Best"}</dt>
                <dd className="font-mono">{c.bestMove ?? "—"}</dd>
                <dt className="text-slate-500">BSI</dt>
                <dd>{c.bsiScore != null ? c.bsiScore.toFixed(0) : "—"}</dd>
                <dt className="text-slate-500">ADI</dt>
                <dd>{c.adiScore != null ? c.adiScore.toFixed(2) : "—"}</dd>
                <dt className="text-slate-500">DS sel.</dt>
                <dd>{c.deepSearchSelected ? "Y" : "N"}</dd>
                <dt className="text-slate-500">DS ok</dt>
                <dd>{c.deepSearchCompleted ? "Y" : "N"}</dd>
              </dl>
              <div className="mt-2 flex flex-wrap gap-1">
                {c.reasons.slice(0, 4).map((r) => {
                  let mapped = mapReasonPhraseForUi(r, langKey);
                  if (uiTextContainsForbiddenLabel(mapped)) {
                    mapped =
                      lang === "ko"
                        ? "내부 참고 신호"
                        : lang === "en"
                          ? "Internal signal"
                          : lang === "zh"
                            ? "内部参考"
                            : "内部シグナル";
                  }
                  return (
                    <span
                      key={r}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-400"
                    >
                      {mapped}
                    </span>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>
      )}
    </section>
  );
}
