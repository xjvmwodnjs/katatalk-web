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

/** Keyboard nav uses the same gate as toolbar/slider UI. */
export function isBoardKeyboardNavigationEnabledV1(
  args: Parameters<typeof shouldShowBoardTurnNavigationV1>[0]
): boolean {
  return shouldShowBoardTurnNavigationV1(args);
}

export type BoardKeyboardNavKeyV1 = "ArrowLeft" | "ArrowRight" | "Home" | "End";

export function isBoardKeyboardNavKeyV1(key: string): key is BoardKeyboardNavKeyV1 {
  return key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End";
}

export function nextTurnIndexFromBoardKeyboardV1(
  key: BoardKeyboardNavKeyV1,
  current: number,
  totalMoves: number
): number {
  const cur = clampSelectedTurnIndexV1(current, totalMoves);
  const total = Math.max(0, Math.trunc(Number(totalMoves)) || 0);
  switch (key) {
    case "ArrowLeft":
      return boardNavStepTurnIndexV1(cur, -1, total);
    case "ArrowRight":
      return boardNavStepTurnIndexV1(cur, 1, total);
    case "Home":
      return boardNavFirstTurnIndexV1();
    case "End":
      return boardNavLastTurnIndexV1(total);
    default:
      return cur;
  }
}

/**
 * Do not steal arrow/Home/End when the user is editing or using nav controls.
 * Pass `document.activeElement` from the keydown handler.
 */
export function shouldIgnoreBoardKeyboardNavFocusV1(activeElement: Element | null | undefined): boolean {
  if (!activeElement) {
    return false;
  }
  const el = activeElement as HTMLElement;
  if (typeof el.tagName !== "string") {
    return false;
  }
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button") {
    return true;
  }
  if (el.isContentEditable) {
    return true;
  }
  const role = el.getAttribute("role");
  if (role === "slider" || role === "textbox" || role === "combobox" || role === "listbox") {
    return true;
  }
  if (el.closest('[role="slider"]') != null) {
    return true;
  }
  if (el.closest('[data-slot="slider"]') != null) {
    return true;
  }
  return false;
}
