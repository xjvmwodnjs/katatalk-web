import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { AnalysisResultLang } from "@shared/analysisResultI18n";
import { getAnalysisResultUiStrings } from "@shared/analysisResultI18n";
import {
  boardNavFirstTurnIndexV1,
  boardNavLastTurnIndexV1,
  boardNavStepTurnIndexV1,
  clampSelectedTurnIndexV1,
} from "@shared/boardNavigationV1";
import { ChevronsLeft, ChevronsRight, SkipBack, SkipForward } from "lucide-react";

type Props = {
  selectedTurnIndex: number;
  totalMoves: number;
  onSelectTurnIndex: (turnIndex: number) => void;
  lang: AnalysisResultLang;
};

function interp(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    params[key] !== undefined && params[key] !== null ? String(params[key]) : ""
  );
}

export default function BoardTurnNavigation({
  selectedTurnIndex,
  totalMoves,
  onSelectTurnIndex,
  lang,
}: Props) {
  const t = getAnalysisResultUiStrings(lang);
  const total = Math.max(0, Math.trunc(totalMoves) || 0);
  const current = clampSelectedTurnIndexV1(selectedTurnIndex, total);
  const atStart = current <= boardNavFirstTurnIndexV1();
  const atEnd = current >= boardNavLastTurnIndexV1(total);

  const go = (next: number) => onSelectTurnIndex(clampSelectedTurnIndexV1(next, total));

  return (
    <div
      className="mb-3 space-y-2 rounded-xl border border-white/10 bg-black/25 px-3 py-3 sm:px-4"
      role="toolbar"
      aria-label={t.navAriaToolbar}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 min-w-9 px-2 text-xs sm:min-w-10 sm:text-sm"
            disabled={atStart}
            aria-label={t.navFirst}
            onClick={() => go(boardNavFirstTurnIndexV1())}
          >
            <SkipBack className="size-3.5 sm:mr-0.5" aria-hidden />
            <span className="sr-only sm:not-sr-only sm:inline">{t.navFirst}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 min-w-9 px-2 text-xs sm:min-w-10 sm:text-sm"
            disabled={atStart}
            aria-label={t.navPrev}
            onClick={() => go(boardNavStepTurnIndexV1(current, -1, total))}
          >
            <ChevronsLeft className="size-3.5 sm:mr-0.5" aria-hidden />
            <span className="sr-only sm:not-sr-only sm:inline">{t.navPrev}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 min-w-9 px-2 text-xs sm:min-w-10 sm:text-sm"
            disabled={atEnd}
            aria-label={t.navNext}
            onClick={() => go(boardNavStepTurnIndexV1(current, 1, total))}
          >
            <ChevronsRight className="size-3.5 sm:mr-0.5" aria-hidden />
            <span className="sr-only sm:not-sr-only sm:inline">{t.navNext}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 min-w-9 px-2 text-xs sm:min-w-10 sm:text-sm"
            disabled={atEnd}
            aria-label={t.navEnd}
            onClick={() => go(boardNavLastTurnIndexV1(total))}
          >
            <SkipForward className="size-3.5 sm:mr-0.5" aria-hidden />
            <span className="sr-only sm:not-sr-only sm:inline">{t.navEnd}</span>
          </Button>
        </div>
        <p
          className="shrink-0 font-mono text-sm tabular-nums text-amber-100/95"
          aria-live="polite"
          aria-atomic="true"
        >
          {interp(t.navTurnCounter, { current, total })}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Slider
          className="flex-1"
          min={0}
          max={total}
          step={1}
          value={[current]}
          onValueChange={(v) => {
            const n = v[0];
            if (n !== undefined) {
              go(n);
            }
          }}
          aria-label={t.navSliderAria}
        />
      </div>
    </div>
  );
}
