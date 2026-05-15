/**
 * Board turn navigation v1 — view-only selectedTurnIndex stepping (0..totalMoves).
 * Aligns with `buildSgfPlaybackStateV1` clamp policy.
 */

export function clampSelectedTurnIndexV1(selected: number, totalMoves: number): number {
  const total = Math.max(0, Math.trunc(Number(totalMoves)) || 0);
  let sel = Math.trunc(Number(selected));
  if (!Number.isFinite(sel)) {
    sel = 0;
  }
  if (sel < 0) {
    sel = 0;
  }
  if (sel > total) {
    sel = total;
  }
  return sel;
}

export function boardNavFirstTurnIndexV1(): number {
  return 0;
}

export function boardNavLastTurnIndexV1(totalMoves: number): number {
  return clampSelectedTurnIndexV1(totalMoves, totalMoves);
}

export function boardNavStepTurnIndexV1(current: number, delta: number, totalMoves: number): number {
  return clampSelectedTurnIndexV1(current + delta, totalMoves);
}

export function shouldShowBoardTurnNavigationV1(args: {
  vmKind: string;
  sgfPlaceholder: boolean;
}): boolean {
  return args.vmKind === "katago-worker-v1" && !args.sgfPlaceholder;
}
