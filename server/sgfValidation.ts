// =============================================================
// Basic SGF text validation (upload guardrails; not a full parser)
// =============================================================

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

  const hasFf = /\bFF\[/i.test(text);
  const hasGm = /\bGM\[/i.test(text);
  if (!hasFf && !hasGm) {
    return {
      ok: false,
      message:
        "Invalid SGF: the file must contain an FF (file format) or GM (game type) property, for example FF[4] or GM[1].",
    };
  }

  const hasMove = /\b[BW]\[[^\]]*\]/i.test(text);
  if (!hasMove) {
    return {
      ok: false,
      message:
        "Invalid SGF: no Black or White move properties were found. Expected at least one B[...] or W[...] (including passes like B[] or W[]).",
    };
  }

  return { ok: true };
}
