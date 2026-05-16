// =============================================================
// Basic SGF text validation (upload guardrails; not a full parser)
// =============================================================

import { extractMainlineBwMoves } from "@shared/sgfPlaybackV1";

export type SgfValidationResult = { ok: true } | { ok: false; message: string };

/**
 * Validates minimal SGF structure expected for a real game record.
 * Does not fully parse the tree; KataGo integration will use a proper parser later.
 */
export function validateSgfText(raw: string): SgfValidationResult {
  if (raw.length === 0) {
    return { ok: false, message: "The uploaded file is empty." };
  }

  let text = raw;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  text = text.trimStart();

  if (!text.startsWith("(")) {
    return {
      ok: false,
      message:
        "Invalid SGF: the file must start with '(' (Smart Game Format root). This file does not look like an SGF record.",
    };
  }

  const parsed = extractMainlineBwMoves(text);
  if (parsed.warnings.some((w) => w.code === "no_root")) {
    return {
      ok: false,
      message: "Invalid SGF: the file must contain an SGF root node like '(;'.",
    };
  }

  const unsupportedGm = parsed.warnings.find((w) => w.code === "unsupported_game_type");
  if (unsupportedGm) {
    return {
      ok: false,
      message: `Invalid SGF: unsupported game type GM[${String(unsupportedGm.params?.gm ?? "?")}]. Only GM[1] Go records are supported.`,
    };
  }

  if (parsed.moves.length === 0) {
    return {
      ok: false,
      message:
        "Invalid SGF: no Black or White move properties were found. Expected at least one B[...] or W[...] (including passes like B[] or W[]).",
    };
  }

  return { ok: true };
}
