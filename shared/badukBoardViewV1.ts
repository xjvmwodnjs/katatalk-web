/**
 * Baduk Board Renderer v1 — 순수 헬퍼(React 없음).
 * ghost 좌표는 GTP 문자열만 변환하며 SGF 재파싱 없음.
 */

import type { AnalysisResultKeyMoveCandidateV1, AnalysisResultVariationPreviewV1 } from "./analysisResultViewModel";
import { gtpCoordToBoardXY } from "./sgfPlaybackV1";

export type BadukBoardGhostMarkerV1 = {
  x: number;
  y: number;
  gtp: string;
  /** candidate | pv | try */
  kind: "candidate" | "pv" | "try";
  color?: "B" | "W";
  /** Optional display order for selected PV overlays. */
  order?: number;
};

export type BadukBoardOverlayModeV1 = "mainline" | "candidate-selected" | "variation-review" | "try-play";

/** 보드 크기별 화점(0-based x,y). 19×19만 9개, 그 외는 간단 패턴. */
export function boardStarPointsV1(boardSize: number): [number, number][] {
  if (boardSize === 19) {
    return [
      [3, 3],
      [9, 3],
      [15, 3],
      [3, 9],
      [9, 9],
      [15, 9],
      [3, 15],
      [9, 15],
      [15, 15],
    ];
  }
  if (boardSize === 13) {
    return [
      [3, 3],
      [9, 3],
      [3, 9],
      [9, 9],
      [6, 6],
    ];
  }
  if (boardSize === 9) {
    return [
      [2, 2],
      [6, 2],
      [2, 6],
      [6, 6],
      [4, 4],
    ];
  }
  if (boardSize >= 7) {
    const c = Math.floor(boardSize / 2);
    return [[c, c]];
  }
  return [];
}

function addGhost(
  out: BadukBoardGhostMarkerV1[],
  seen: Set<string>,
  gtp: string | null | undefined,
  kind: BadukBoardGhostMarkerV1["kind"],
  boardSize: number,
  occupied: Set<string>,
  order?: number,
  color?: "B" | "W"
): void {
  if (!gtp || /^pass$/i.test(gtp.trim())) {
    return;
  }
  const xy = gtpCoordToBoardXY(gtp, boardSize);
  if (!xy) {
    return;
  }
  const key = `${xy.x},${xy.y}`;
  if (seen.has(key) || occupied.has(key)) {
    return;
  }
  seen.add(key);
  out.push({ x: xy.x, y: xy.y, gtp: gtp.trim(), kind, ...(color ? { color } : {}), ...(order != null ? { order } : {}) });
}

function nextColor(color: "B" | "W"): "B" | "W" {
  return color === "B" ? "W" : "B";
}

/** 선택 수순의 후보수·PV 첫 수를 ghost 로 수집(실돌 위치는 제외). */
export function collectBadukBoardGhostMarkersV1(args: {
  boardSize: number;
  occupiedKeys: Iterable<string>;
  selectedTurnIndex: number | null;
  candidates: AnalysisResultKeyMoveCandidateV1[];
  variationPreview: AnalysisResultVariationPreviewV1[];
  selectedVariation?: AnalysisResultVariationPreviewV1 | null;
  overlayMode?: BadukBoardOverlayModeV1;
  pvStartColor?: "B" | "W";
  tryPlayStones?: BadukBoardGhostMarkerV1[];
}): BadukBoardGhostMarkerV1[] {
  const { boardSize, occupiedKeys, selectedTurnIndex, candidates, variationPreview, selectedVariation } = args;
  if (selectedTurnIndex == null) {
    return [];
  }
  const occupied = new Set(occupiedKeys);
  const out: BadukBoardGhostMarkerV1[] = [];
  const seen = new Set<string>();
  const overlayMode = args.overlayMode ?? "mainline";

  if (overlayMode === "variation-review" && selectedVariation && selectedVariation.pv.length > 0) {
    let color = args.pvStartColor ?? "B";
    selectedVariation.pv.forEach((gtp, i) => {
      addGhost(out, seen, gtp, "pv", boardSize, occupied, i + 1, color);
      color = nextColor(color);
    });
    return out;
  }

  if (overlayMode === "try-play") {
    for (const st of args.tryPlayStones ?? []) {
      const key = `${st.x},${st.y}`;
      if (seen.has(key) || occupied.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(st);
    }
    return out;
  }

  if (overlayMode === "candidate-selected") {
    return out;
  }

  const cand = candidates.find((c) => c.turnIndex === selectedTurnIndex);
  if (cand?.bestMove) {
    addGhost(out, seen, cand.bestMove, "candidate", boardSize, occupied);
  }

  const pvRow = variationPreview.find((p) => p.turnIndex === selectedTurnIndex);
  if (pvRow?.bestMove) {
    addGhost(out, seen, pvRow.bestMove, "candidate", boardSize, occupied);
  }

  return out;
}
