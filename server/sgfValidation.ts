// =============================================================
// Basic SGF text validation (upload guardrails; not a full parser)
// =============================================================

import { extractMainlineBwMoves } from "@shared/sgfPlaybackV1";
import {
  parseSupportedKatagoRulesFromRootV1,
  SgfKatagoParseError,
  type SgfKatagoParseErrorCodeV1,
} from "@shared/sgfKatagoParseV1";

export type SgfValidationResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      code?: SgfKatagoParseErrorCodeV1;
    };

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

  if (parsed.warnings.some((w) => w.code === "setup_after_move_unsupported")) {
    return {
      ok: false,
      message:
        "Invalid SGF: AB/AW/AE setup stones after the first move are not supported. Put setup stones before the first move.",
    };
  }

  if (parsed.moves.length === 0) {
    return {
      ok: false,
      message:
        "Invalid SGF: no Black or White move properties were found. Expected at least one B[...] or W[...] (including passes like B[] or W[]).",
    };
  }

  try {
    parseSupportedKatagoRulesFromRootV1(text);
  } catch (error) {
    if (error instanceof SgfKatagoParseError) {
      if (error.code === "SGF_UNSUPPORTED_RULES") {
        return {
          ok: false,
          code: error.code,
          message: "Invalid SGF: only Japanese rules are supported.",
        };
      }
      if (error.code === "SGF_PARSE_FAILED") {
        return {
          ok: false,
          code: error.code,
          message: "Invalid SGF: the root RU property is not closed.",
        };
      }
    }
    throw error;
  }

  return { ok: true };
}
