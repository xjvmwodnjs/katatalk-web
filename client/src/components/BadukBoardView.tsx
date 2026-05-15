import { useId } from "react";
import type { BadukBoardGhostMarkerV1 } from "@shared/badukBoardViewV1";
import { boardStarPointsV1 } from "@shared/badukBoardViewV1";
import type { AnalysisResultLang } from "@shared/analysisResultI18n";
import { getAnalysisResultUiStrings, uiTextContainsForbiddenLabel } from "@shared/analysisResultI18n";
import type { SgfPlaybackLastMoveV1, SgfPlaybackStoneV1 } from "@shared/sgfPlaybackV1";
import { boardYToGtpRow, indexToGtpColumn } from "@shared/sgfPlaybackV1";

export type BadukBoardViewProps = {
  boardSize: number;
  stones: SgfPlaybackStoneV1[];
  lastMove: SgfPlaybackLastMoveV1 | null;
  ghosts: BadukBoardGhostMarkerV1[];
  lang: AnalysisResultLang;
};

const PADDING = 4.2;
const GRID_AREA = 100 - 2 * PADDING;

function clampBoardSize(n: number): number {
  if (!Number.isFinite(n)) {
    return 19;
  }
  const s = Math.trunc(n);
  if (s < 2) {
    return 2;
  }
  if (s > 25) {
    return 25;
  }
  return s;
}

function intersectionPos(index: number, boardSize: number): number {
  if (boardSize <= 1) {
    return PADDING;
  }
  return PADDING + (index / (boardSize - 1)) * GRID_AREA;
}

export default function BadukBoardView({ boardSize: rawSize, stones, lastMove, ghosts, lang }: BadukBoardViewProps) {
  const boardSize = clampBoardSize(rawSize);
  const uid = useId().replace(/:/g, "");
  const t = getAnalysisResultUiStrings(lang);
  const stoneRadius = boardSize > 1 ? GRID_AREA / (boardSize - 1) / 2.35 : 2;
  const stars = boardStarPointsV1(boardSize);
  const showCoords = boardSize <= 19;

  const ghostLegend = uiTextContainsForbiddenLabel(t.boardGhostLegend, lang)
    ? t.boardGhostLegendFallback
    : t.boardGhostLegend;
  const pvLegend = uiTextContainsForbiddenLabel(t.boardGhostPvLegend, lang)
    ? t.boardGhostPvLegendFallback
    : t.boardGhostPvLegend;

  return (
    <div className="w-full max-w-[min(100%,420px)] mx-auto">
      <div className="relative w-full aspect-square" role="img" aria-label={t.boardAriaSnapshot}>
        <svg viewBox="0 0 100 100" className="w-full h-full rounded-lg block" aria-hidden="true">
          <defs>
            <radialGradient id={`${uid}-wood`} cx="35%" cy="30%">
              <stop offset="0%" stopColor="#d4a84b" />
              <stop offset="100%" stopColor="#a67c1a" />
            </radialGradient>
            <radialGradient id={`${uid}-black`} cx="35%" cy="28%">
              <stop offset="0%" stopColor="#555" />
              <stop offset="55%" stopColor="#1a1a1a" />
              <stop offset="100%" stopColor="#000" />
            </radialGradient>
            <radialGradient id={`${uid}-white`} cx="35%" cy="28%">
              <stop offset="0%" stopColor="#fff" />
              <stop offset="50%" stopColor="#eee" />
              <stop offset="100%" stopColor="#ccc" />
            </radialGradient>
            <filter id={`${uid}-shadow`}>
              <feDropShadow dx="0.12" dy="0.25" stdDeviation="0.25" floodOpacity="0.45" />
            </filter>
          </defs>

          <rect width="100" height="100" fill={`url(#${uid}-wood)`} rx="1.2" />

          {Array.from({ length: boardSize }, (_, i) => (
            <line
              key={`h${i}`}
              x1={PADDING}
              y1={intersectionPos(i, boardSize)}
              x2={100 - PADDING}
              y2={intersectionPos(i, boardSize)}
              stroke="rgba(0,0,0,0.55)"
              strokeWidth="0.18"
            />
          ))}
          {Array.from({ length: boardSize }, (_, i) => (
            <line
              key={`v${i}`}
              x1={intersectionPos(i, boardSize)}
              y1={PADDING}
              x2={intersectionPos(i, boardSize)}
              y2={100 - PADDING}
              stroke="rgba(0,0,0,0.55)"
              strokeWidth="0.18"
            />
          ))}

          {stars.map(([sx, sy], idx) => (
            <circle
              key={`star-${idx}`}
              cx={intersectionPos(sx, boardSize)}
              cy={intersectionPos(sy, boardSize)}
              r={boardSize >= 13 ? 0.5 : 0.4}
              fill="rgba(0,0,0,0.75)"
            />
          ))}

          {showCoords
            ? Array.from({ length: boardSize }, (_, i) => (
                <text
                  key={`col-${i}`}
                  x={intersectionPos(i, boardSize)}
                  y={PADDING - 1.4}
                  textAnchor="middle"
                  fontSize={boardSize > 13 ? "1.55" : "1.85"}
                  fill="rgba(0,0,0,0.5)"
                  fontFamily="'JetBrains Mono', ui-monospace, monospace"
                  fontWeight="600"
                >
                  {indexToGtpColumn(i)}
                </text>
              ))
            : null}

          {showCoords
            ? Array.from({ length: boardSize }, (_, i) => (
                <text
                  key={`row-${i}`}
                  x={PADDING - 1.6}
                  y={intersectionPos(i, boardSize)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={boardSize > 13 ? "1.55" : "1.85"}
                  fill="rgba(0,0,0,0.5)"
                  fontFamily="'JetBrains Mono', ui-monospace, monospace"
                  fontWeight="600"
                >
                  {boardYToGtpRow(i, boardSize)}
                </text>
              ))
            : null}

          {ghosts.map((g, i) => {
            const cx = intersectionPos(g.x, boardSize);
            const cy = intersectionPos(g.y, boardSize);
            const fill = g.kind === "pv" ? "rgba(250,204,21,0.35)" : "rgba(147,197,253,0.45)";
            const stroke = g.kind === "pv" ? "rgba(250,204,21,0.85)" : "rgba(96,165,250,0.9)";
            return (
              <g key={`ghost-${g.gtp}-${i}`} aria-hidden="true">
                <circle cx={cx} cy={cy} r={stoneRadius * 0.92} fill={fill} stroke={stroke} strokeWidth="0.22" />
                <circle cx={cx} cy={cy} r={stoneRadius * 0.35} fill={stroke} opacity="0.5" />
              </g>
            );
          })}

          {stones.map((stone) => {
            const cx = intersectionPos(stone.x, boardSize);
            const cy = intersectionPos(stone.y, boardSize);
            const isBlack = stone.color === "B";
            const isLast =
              lastMove != null && lastMove.x === stone.x && lastMove.y === stone.y && lastMove.color === stone.color;
            return (
              <g key={`${stone.x}-${stone.y}-${stone.turnIndex}`} filter={`url(#${uid}-shadow)`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={stoneRadius}
                  fill={isBlack ? `url(#${uid}-black)` : `url(#${uid}-white)`}
                  stroke={isBlack ? "none" : "rgba(0,0,0,0.18)"}
                  strokeWidth="0.12"
                />
                {isLast ? (
                  <>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={stoneRadius + 0.35}
                      fill="none"
                      stroke="rgba(250,204,21,0.95)"
                      strokeWidth="0.28"
                    />
                    <text
                      x={cx}
                      y={cy}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={stoneRadius >= 1.8 ? "1.35" : "1.1"}
                      fontWeight="700"
                      fontFamily="'JetBrains Mono', ui-monospace, monospace"
                      fill={isBlack ? "#f0d060" : "#222"}
                    >
                      {stone.turnIndex}
                    </text>
                  </>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      {ghosts.length > 0 ? (
        <p className="mt-2 text-[11px] text-slate-500 text-center" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>
          {ghostLegend}
          {ghosts.some((g) => g.kind === "pv") ? ` · ${pvLegend}` : null}
        </p>
      ) : null}
    </div>
  );
}
