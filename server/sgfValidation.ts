// =============================================================
// Basic SGF text validation (upload guardrails; not a full parser)
// =============================================================

import { extractMainlineBwMoves } from "@shared/sgfPlaybackV1";
import {
  parseSgfForKatagoV1,
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
        "Invalid SGF: AB/AW/AE setup stones in a move node or after the first move are not supported. Put setup stones before the first move.",
    };
  }

  if (parsed.moves.length === 0) {
    return {
      ok: false,
      message:
        "Invalid SGF: no Black or White move properties were found. Expected at least one B[...] or W[...] (including passes like B[] or W[]).",
    };
  }

  let rootRulesValidated = false;
  try {
    parseSupportedKatagoRulesFromRootV1(text);
    rootRulesValidated = true;
    // Keep upload admission and Worker execution on the same strict parser so
    // invalid board/setup coordinates fail before wallet/debit/enqueue.
    parseSgfForKatagoV1(text);
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
          message: rootRulesValidated
            ? "Invalid SGF: the record contains malformed or unsupported structural values."
            : "Invalid SGF: the root RU property is not closed.",
        };
      }
      if (error.code === "SGF_INVALID_PLAYER_TO_PLAY") {
        return {
          ok: false,
          code: error.code,
          message:
            "Invalid SGF: PL must contain exactly B or W in a setup node before the first move.",
        };
      }
      if (error.code === "SGF_PLAYER_TO_PLAY_CONFLICT") {
        return {
          ok: false,
          code: error.code,
          message: "Invalid SGF: PL conflicts with the first move color.",
        };
      }
      if (error.code === "SGF_UNSUPPORTED_PLAYER_TO_PLAY") {
        return {
          ok: false,
          code: error.code,
          message: "Invalid SGF: PL after the first move is not supported.",
        };
      }
      if (error.code === "SGF_INVALID_HANDICAP") {
        return {
          ok: false,
          code: error.code,
          message: "Invalid SGF: HA must be 0 or an integer of at least 2.",
        };
      }
      if (error.code === "SGF_HANDICAP_SETUP_MISMATCH") {
        return {
          ok: false,
          code: error.code,
          message:
            "Invalid SGF: HA does not match the initial black setup stones.",
        };
      }
      if (error.code === "SGF_INVALID_COORDINATE") {
        return {
          ok: false,
          code: error.code,
          message:
            "Invalid SGF: one or more move or setup coordinates are invalid for the board size.",
        };
      }
    }
    throw error;
  }

  return { ok: true };
}
