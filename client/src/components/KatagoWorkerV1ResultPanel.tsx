import type { Language } from "@/lib/mockData";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function fmtNum(n: unknown): string {
  if (typeof n === "number" && Number.isFinite(n)) {
    return String(n);
  }
  return "—";
}

/** KataGo JSON winrate: 0–1 또는 이미 퍼센트 스케일일 수 있음 — 흑/백 단정 없이 수치만 표시 */
function fmtKatagoWinrate(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    return "—";
  }
  if (n >= 0 && n <= 1) {
    return `${(n * 100).toFixed(1)}%`;
  }
  if (n >= 0 && n <= 100) {
    return `${n.toFixed(1)}%`;
  }
  return fmtNum(n);
}

function pickScore(rootOrMove: Record<string, unknown>): { label: string; value: string } | null {
  if (typeof rootOrMove.scoreLead === "number" && Number.isFinite(rootOrMove.scoreLead)) {
    return { label: "scoreLead", value: fmtNum(rootOrMove.scoreLead) };
  }
  if (typeof rootOrMove.scoreMean === "number" && Number.isFinite(rootOrMove.scoreMean)) {
    return { label: "scoreMean", value: fmtNum(rootOrMove.scoreMean) };
  }
  return null;
}

export type KatagoWorkerV1ResultData = Record<string, unknown>;

interface KatagoWorkerV1ResultPanelProps {
  data: KatagoWorkerV1ResultData;
  lang: Language;
}

export default function KatagoWorkerV1ResultPanel({ data, lang }: KatagoWorkerV1ResultPanelProps) {
  const engine = isRecord(data.engine) ? data.engine : {};
  const katago = isRecord(data.katago) ? data.katago : {};
  const rootInfo = isRecord(katago.rootInfo) ? (katago.rootInfo as Record<string, unknown>) : {};
  const topMove = isRecord(katago.topMove) ? (katago.topMove as Record<string, unknown>) : {};
  const maxVisits = engine.maxVisits;
  const moveInfosCount = katago.moveInfosCount;
  const rootScore = pickScore(rootInfo);
  const topScore = pickScore(topMove);
  const currentPlayer =
    typeof rootInfo.currentPlayer === "string"
      ? rootInfo.currentPlayer
      : typeof rootInfo.playerToMove === "string"
        ? rootInfo.playerToMove
        : null;

  const notice =
    lang === "ko"
      ? "KataGo 원시(raw) 분석만 완료되었습니다. BSI·ADI·자연어 해설은 다음 단계에서 제공될 예정입니다."
      : lang === "en"
        ? "KataGo raw analysis only. BSI, ADI, and natural-language commentary are planned for a later stage."
        : lang === "zh"
          ? "当前仅完成 KataGo 原始分析。BSI、ADI 与自然语言解说将在后续阶段提供。"
          : "KataGo の raw 分析のみ完了しています。BSI/ADI・自然言語解説は今後の段階で提供予定です。";

  const winrateCaption =
    lang === "ko"
      ? "KataGo winrate (흑/백 고정 해석 없음)"
      : lang === "en"
        ? "KataGo winrate (not labeled as black/white)"
        : lang === "zh"
          ? "KataGo 胜率（不作黑白固定解读）"
          : "KataGo winrate（黒白の固定ラベルなし）";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-8 mb-8">
      <div className="mb-2 text-xs font-medium uppercase tracking-widest text-amber-400/80 font-mono">
        KataGo worker v1
      </div>
      <h1
        className="text-2xl md:text-3xl font-bold text-amber-100 mb-2"
        style={{ fontFamily: "'Noto Serif KR', serif" }}
      >
        {lang === "ko" ? "분석 완료" : lang === "en" ? "Analysis complete" : lang === "zh" ? "分析完成" : "分析完了"}
      </h1>
      <p className="text-sm text-slate-400 mb-6" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
        {lang === "ko"
          ? "엔진: KataGo · 원시 포착 단계"
          : lang === "en"
            ? "Engine: KataGo · raw capture stage"
            : lang === "zh"
              ? "引擎：KataGo · 原始采集阶段"
              : "エンジン: KataGo · raw 取得段階"}
      </p>

      <dl className="grid gap-3 sm:grid-cols-2 text-sm">
        <div className="rounded-lg bg-black/20 px-3 py-2 border border-white/5">
          <dt className="text-slate-500 font-mono text-xs">source</dt>
          <dd className="text-amber-100 font-mono">{typeof data.source === "string" ? data.source : "—"}</dd>
        </div>
        <div className="rounded-lg bg-black/20 px-3 py-2 border border-white/5">
          <dt className="text-slate-500 font-mono text-xs">maxVisits</dt>
          <dd className="text-amber-100 font-mono">{fmtNum(maxVisits)}</dd>
        </div>
        <div className="rounded-lg bg-black/20 px-3 py-2 border border-white/5">
          <dt className="text-slate-500 text-xs">{winrateCaption}</dt>
          <dd className="text-amber-100 font-mono mt-1">{fmtKatagoWinrate(rootInfo.winrate)}</dd>
        </div>
        <div className="rounded-lg bg-black/20 px-3 py-2 border border-white/5">
          <dt className="text-slate-500 font-mono text-xs">root · currentPlayer</dt>
          <dd className="text-amber-100 font-mono">{currentPlayer ?? "—"}</dd>
        </div>
        {rootScore ? (
          <div className="rounded-lg bg-black/20 px-3 py-2 border border-white/5">
            <dt className="text-slate-500 font-mono text-xs">root · {rootScore.label}</dt>
            <dd className="text-amber-100 font-mono">{rootScore.value}</dd>
          </div>
        ) : null}
        <div className="rounded-lg bg-black/20 px-3 py-2 border border-white/5">
          <dt className="text-slate-500 font-mono text-xs">topMove · move</dt>
          <dd className="text-amber-100 font-mono">{typeof topMove.move === "string" ? topMove.move : "—"}</dd>
        </div>
        <div className="rounded-lg bg-black/20 px-3 py-2 border border-white/5">
          <dt className="text-slate-500 text-xs">{winrateCaption} (topMove)</dt>
          <dd className="text-amber-100 font-mono mt-1">{fmtKatagoWinrate(topMove.winrate)}</dd>
        </div>
        {topScore ? (
          <div className="rounded-lg bg-black/20 px-3 py-2 border border-white/5">
            <dt className="text-slate-500 font-mono text-xs">topMove · {topScore.label}</dt>
            <dd className="text-amber-100 font-mono">{topScore.value}</dd>
          </div>
        ) : null}
        <div className="rounded-lg bg-black/20 px-3 py-2 border border-white/5 sm:col-span-2">
          <dt className="text-slate-500 font-mono text-xs">moveInfosCount</dt>
          <dd className="text-amber-100 font-mono">{fmtNum(moveInfosCount)}</dd>
        </div>
      </dl>

      <p
        className="mt-6 text-sm text-slate-400 border-t border-white/10 pt-4"
        style={{ fontFamily: "'Noto Sans KR', sans-serif" }}
      >
        {notice}
      </p>
    </div>
  );
}
