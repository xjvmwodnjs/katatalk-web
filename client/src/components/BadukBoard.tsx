// =============================================================
// BadukBoard: Precision 19x19 Go board with stones at exact intersections
// Fixed: Stones render at exact grid intersections using SVG-based approach
// =============================================================

import { useEffect, useState } from "react";
import { sgfToGrid } from "@/lib/mockData";

interface BadukBoardProps {
  pv: string[];
  player: "B" | "W";
}

interface Stone {
  col: number;
  row: number;
  number: number;
  color: "black" | "white";
}

const BOARD_SIZE = 19;
const STAR_POINTS = [
  [3, 3], [9, 3], [15, 3],
  [3, 9], [9, 9], [15, 9],
  [3, 15], [9, 15], [15, 15],
];

// Board coordinate system:
// - The board has a padding area around the grid
// - Grid lines are evenly spaced within the padded area
const PADDING = 3.5; // percentage padding on each side
const GRID_AREA = 100 - 2 * PADDING; // usable grid area

export default function BadukBoard({ pv, player }: BadukBoardProps) {
  const [visibleStones, setVisibleStones] = useState<number>(0);

  const stones: Stone[] = pv.map((coord, i) => {
    const pos = sgfToGrid(coord);
    if (!pos) return null;
    const color = (player === "B" && i % 2 === 0) || (player === "W" && i % 2 === 1)
      ? "black"
      : "white";
    return { col: pos[0], row: pos[1], number: i + 1, color };
  }).filter(Boolean) as Stone[];

  useEffect(() => {
    setVisibleStones(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    stones.forEach((_, i) => {
      timers.push(setTimeout(() => setVisibleStones(i + 1), i * 200 + 100));
    });
    return () => timers.forEach(clearTimeout);
  }, [pv.join(",")]);

  // Get the exact percentage position of intersection (col, row) on the SVG viewBox
  const getPos = (index: number) => {
    return PADDING + (index / 18) * GRID_AREA;
  };

  const COLS = "ABCDEFGHJKLMNOPQRST";
  const stoneRadius = GRID_AREA / 18 / 2.15;

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      {/* Board Container - SVG based for pixel-perfect rendering */}
      <div className="relative w-full" style={{ maxWidth: "400px" }}>
        <svg
          viewBox="0 0 100 100"
          className="w-full h-auto rounded-lg"
          style={{
            backgroundColor: "#C8960C",
            backgroundImage: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0.1) 100%)",
            boxShadow: "inset 0 0 20px rgba(0,0,0,0.15), 0 6px 24px rgba(0,0,0,0.5)",
          }}
        >
          {/* Board wood texture gradient */}
          <defs>
            <radialGradient id="boardGrad" cx="35%" cy="30%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.08)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0.12)" />
            </radialGradient>
            <radialGradient id="blackStone" cx="35%" cy="28%">
              <stop offset="0%" stopColor="#666" />
              <stop offset="55%" stopColor="#1a1a1a" />
              <stop offset="100%" stopColor="#000" />
            </radialGradient>
            <radialGradient id="whiteStone" cx="35%" cy="28%">
              <stop offset="0%" stopColor="#fff" />
              <stop offset="50%" stopColor="#eee" />
              <stop offset="100%" stopColor="#ccc" />
            </radialGradient>
            <filter id="stoneShadow">
              <feDropShadow dx="0.15" dy="0.3" stdDeviation="0.3" floodOpacity="0.5" />
            </filter>
          </defs>

          {/* Background overlay */}
          <rect x="0" y="0" width="100" height="100" fill="url(#boardGrad)" />

          {/* Grid lines */}
          {Array.from({ length: BOARD_SIZE }, (_, i) => (
            <line
              key={`h${i}`}
              x1={PADDING}
              y1={getPos(i)}
              x2={100 - PADDING}
              y2={getPos(i)}
              stroke="rgba(0,0,0,0.55)"
              strokeWidth="0.2"
            />
          ))}
          {Array.from({ length: BOARD_SIZE }, (_, i) => (
            <line
              key={`v${i}`}
              x1={getPos(i)}
              y1={PADDING}
              x2={getPos(i)}
              y2={100 - PADDING}
              stroke="rgba(0,0,0,0.55)"
              strokeWidth="0.2"
            />
          ))}

          {/* Star points */}
          {STAR_POINTS.map(([c, r], idx) => (
            <circle
              key={`star${idx}`}
              cx={getPos(c)}
              cy={getPos(r)}
              r="0.55"
              fill="rgba(0,0,0,0.7)"
            />
          ))}

          {/* Column labels (top) */}
          {Array.from({ length: BOARD_SIZE }, (_, i) => (
            <text
              key={`col${i}`}
              x={getPos(i)}
              y={PADDING - 1.2}
              textAnchor="middle"
              fontSize="1.8"
              fill="rgba(0,0,0,0.45)"
              fontFamily="'JetBrains Mono', monospace"
              fontWeight="600"
            >
              {COLS[i]}
            </text>
          ))}

          {/* Row labels (left) */}
          {Array.from({ length: BOARD_SIZE }, (_, i) => (
            <text
              key={`row${i}`}
              x={PADDING - 1.8}
              y={getPos(i)}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="1.8"
              fill="rgba(0,0,0,0.45)"
              fontFamily="'JetBrains Mono', monospace"
              fontWeight="600"
            >
              {19 - i}
            </text>
          ))}

          {/* Stones */}
          {stones.map((stone, i) => {
            if (stone.number > visibleStones) return null;
            const cx = getPos(stone.col);
            const cy = getPos(stone.row);

            return (
              <g key={i} filter="url(#stoneShadow)" className="stone-appear-svg">
                {/* Stone body */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={stoneRadius}
                  fill={stone.color === "black" ? "url(#blackStone)" : "url(#whiteStone)"}
                  stroke={stone.color === "white" ? "rgba(0,0,0,0.15)" : "none"}
                  strokeWidth="0.1"
                />
                {/* Number label */}
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={stone.number >= 10 ? "2" : "2.3"}
                  fontWeight="bold"
                  fontFamily="'JetBrains Mono', monospace"
                  fill={stone.color === "black" ? "#F0D060" : "#222"}
                >
                  {stone.number}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* PV Legend */}
      <div className="flex flex-wrap gap-1.5 justify-center px-2">
        {stones.map((s, i) => (
          <div
            key={i}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px]"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <div
              className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0"
              style={{
                background:
                  s.color === "black"
                    ? "radial-gradient(circle at 32% 28%, #555, #111 70%)"
                    : "radial-gradient(circle at 32% 28%, #fff, #ddd 70%)",
                color: s.color === "black" ? "#F0D060" : "#222",
                border: s.color === "white" ? "0.5px solid rgba(0,0,0,0.2)" : "none",
              }}
            >
              {s.number}
            </div>
            <span className="text-amber-200/70">{pv[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
