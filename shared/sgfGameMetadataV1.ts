import { skipSgfVariationTreeV1 } from "./sgfPlaybackV1";

export const SGF_GAME_INFO_VERSION_V1 = "sgf-game-info-v1" as const;
export const MAX_SGF_RESULT_MARGIN_V1 = 1000;

export type SgfGameMetadataFieldV1 = "PB" | "PW" | "DT" | "RE";

export type SgfGameMetadataWarningCodeV1 =
  | "blank"
  | "duplicate"
  | "multi_value"
  | "non_root"
  | "malformed"
  | "too_long"
  | "unsafe_control"
  | "invalid_format"
  | "noncanonical_format";

export type SgfGameMetadataWarningV1 = {
  field: SgfGameMetadataFieldV1;
  code: SgfGameMetadataWarningCodeV1;
};

export type ParsedSgfGameMetadataV1 = {
  version: typeof SGF_GAME_INFO_VERSION_V1;
  blackPlayer: string | null;
  whitePlayer: string | null;
  date: string | null;
  /** Safe, SGF SimpleText-normalized authored RE value. */
  resultRaw: string | null;
  /** Canonical display/consumer value derived only from a supported RE value. */
  result: string | null;
  warnings: SgfGameMetadataWarningV1[];
};

type PropertyOccurrenceV1 = {
  nodeIndex: number;
  values: string[];
};

type PropertyScanV1 = {
  malformed: Set<SgfGameMetadataFieldV1>;
  occurrences: Record<SgfGameMetadataFieldV1, PropertyOccurrenceV1[]>;
};

const METADATA_FIELDS = new Set<SgfGameMetadataFieldV1>([
  "PB",
  "PW",
  "DT",
  "RE",
]);

const FIELD_LIMITS: Record<SgfGameMetadataFieldV1, number> = {
  PB: 128,
  PW: 128,
  DT: 256,
  RE: 64,
};

const UNSAFE_CONTROL_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u200B\u200E\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/;

function emptyOccurrences(): Record<
  SgfGameMetadataFieldV1,
  PropertyOccurrenceV1[]
> {
  return { PB: [], PW: [], DT: [], RE: [] };
}

/** Reads one SGF SimpleText value while preserving its whitespace semantics. */
function readSimpleTextValueV1(
  sgf: string,
  openBracketIndex: number
): { text: string; end: number } | null {
  if (sgf[openBracketIndex] !== "[") {
    return null;
  }
  let out = "";
  let i = openBracketIndex + 1;
  while (i < sgf.length) {
    const ch = sgf[i]!;
    if (ch === "]") {
      return {
        text: out.normalize("NFC").trim().replace(/ +/g, " "),
        end: i + 1,
      };
    }
    if (ch === "\\") {
      if (i + 1 >= sgf.length) {
        return null;
      }
      const next = sgf[i + 1]!;
      if (next === "\r") {
        i += sgf[i + 2] === "\n" ? 3 : 2;
        continue;
      }
      if (next === "\n") {
        i += sgf[i + 2] === "\r" ? 3 : 2;
        continue;
      }
      out += /\s/.test(next) ? " " : next;
      i += 2;
      continue;
    }
    if (ch === "\r") {
      out += " ";
      i += sgf[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    out += /\s/.test(ch) ? " " : ch;
    i += 1;
  }
  return null;
}

/** Scans actual PB/PW/DT/RE properties on the selected linear mainline. */
function scanMetadataPropertiesV1(sgf: string): PropertyScanV1 {
  const malformed = new Set<SgfGameMetadataFieldV1>();
  const occurrences = emptyOccurrences();
  const rootIndex = sgf.indexOf("(;");
  if (rootIndex < 0) {
    return { malformed, occurrences };
  }

  let i = rootIndex + 2;
  let nodeIndex = 0;
  while (i < sgf.length) {
    const ch = sgf[i]!;
    if (ch === ")") {
      break;
    }
    if (ch === "(") {
      i = skipSgfVariationTreeV1(sgf, i).end;
      continue;
    }
    if (ch === ";") {
      nodeIndex += 1;
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (!/[A-Za-z]/.test(ch)) {
      i += 1;
      continue;
    }

    const idStart = i;
    while (i < sgf.length && /[A-Za-z]/.test(sgf[i]!)) {
      i += 1;
    }
    const id = sgf.slice(idStart, i).toUpperCase();
    while (i < sgf.length && /\s/.test(sgf[i]!)) {
      i += 1;
    }
    const field = METADATA_FIELDS.has(id as SgfGameMetadataFieldV1)
      ? (id as SgfGameMetadataFieldV1)
      : null;
    if (i >= sgf.length || sgf[i] !== "[") {
      if (field != null) {
        malformed.add(field);
      }
      continue;
    }

    const values: string[] = [];
    let closed = true;
    while (i < sgf.length) {
      while (i < sgf.length && /\s/.test(sgf[i]!)) {
        i += 1;
      }
      if (i >= sgf.length || sgf[i] !== "[") {
        break;
      }
      const value = readSimpleTextValueV1(sgf, i);
      if (value == null) {
        closed = false;
        i = sgf.length;
        break;
      }
      values.push(value.text);
      i = value.end;
    }
    if (field != null) {
      if (!closed) {
        malformed.add(field);
      } else {
        occurrences[field].push({ nodeIndex, values });
      }
    }
  }
  return { malformed, occurrences };
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return new Set([4, 6, 9, 11]).has(month) ? 30 : 31;
}

/** Validates FF[4] full/partial ISO dates and comma-compressed date lists. */
export function isValidSgfDateV1(value: string): boolean {
  const parts = value.split(",");
  if (parts.length === 0 || parts.some(part => part.length === 0)) {
    return false;
  }

  let year: number | null = null;
  let month: number | null = null;
  let precision: "year" | "month" | "day" | null = null;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    const full = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(part);
    if (full != null) {
      year = Number(full[1]);
      month = full[2] == null ? null : Number(full[2]);
      const day = full[3] == null ? null : Number(full[3]);
      if (
        year < 1 ||
        (month != null && (month < 1 || month > 12)) ||
        (day != null &&
          (month == null || day < 1 || day > daysInMonth(year, month)))
      ) {
        return false;
      }
      precision = day != null ? "day" : month != null ? "month" : "year";
      continue;
    }
    if (index === 0 || year == null) {
      return false;
    }

    const monthDay = /^(\d{2})-(\d{2})$/.exec(part);
    if (monthDay != null) {
      if (precision === "year") {
        return false;
      }
      month = Number(monthDay[1]);
      const day = Number(monthDay[2]);
      if (
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > daysInMonth(year, month)
      ) {
        return false;
      }
      precision = "day";
      continue;
    }

    const shortcut = /^(\d{2})$/.exec(part);
    if (shortcut == null || precision === "year") {
      return false;
    }
    const numeric = Number(shortcut[1]);
    if (precision === "day") {
      if (month == null || numeric < 1 || numeric > daysInMonth(year, month)) {
        return false;
      }
    } else {
      if (numeric < 1 || numeric > 12) {
        return false;
      }
      month = numeric;
      precision = "month";
    }
  }
  return true;
}

function isCanonicalMarginWithinProductRangeV1(value: string): boolean {
  const [whole, fraction = ""] = value.split(".");
  const maxWhole = String(MAX_SGF_RESULT_MARGIN_V1);
  if (
    whole == null ||
    whole.length > maxWhole.length ||
    (whole.length === maxWhole.length && whole > maxWhole)
  ) {
    return false;
  }
  return whole !== maxWhole || fraction.length === 0;
}

export function normalizeSgfResultV1(value: string): {
  result: string | null;
  noncanonical: boolean;
} {
  if (
    Array.from(value).length > FIELD_LIMITS.RE ||
    UNSAFE_CONTROL_PATTERN.test(value)
  ) {
    return { result: null, noncanonical: false };
  }
  const compact = value.replace(/\s+/g, "");
  const lower = compact.toLowerCase();
  if (compact === "0") {
    return { result: "0", noncanonical: value !== "0" };
  }
  if (lower === "draw") {
    return { result: "0", noncanonical: value !== "Draw" };
  }
  if (lower === "jigo") {
    return { result: "0", noncanonical: true };
  }
  if (lower === "void") {
    return { result: "Void", noncanonical: value !== "Void" };
  }
  if (compact === "?") {
    return { result: "?", noncanonical: value !== "?" };
  }

  const win = /^([BW])\+(.*)$/i.exec(compact);
  if (win == null) {
    return { result: null, noncanonical: false };
  }
  const color = win[1]!.toUpperCase();
  const suffix = win[2]!;
  if (suffix === "") {
    const result = `${color}+`;
    return { result, noncanonical: value !== result };
  }
  const suffixLower = suffix.toLowerCase();
  const suffixAliases: Record<
    string,
    { outcome: "R" | "T" | "F"; official: string[] }
  > = {
    r: { outcome: "R", official: ["R"] },
    resign: { outcome: "R", official: ["Resign"] },
    resignation: { outcome: "R", official: [] },
    t: { outcome: "T", official: ["T"] },
    time: { outcome: "T", official: ["Time"] },
    f: { outcome: "F", official: ["F"] },
    forfeit: { outcome: "F", official: ["Forfeit"] },
  };
  const suffixContract = suffixAliases[suffixLower];
  if (suffixContract != null) {
    const result = `${color}+${suffixContract.outcome}`;
    const official =
      color === win[1] &&
      value === compact &&
      suffixContract.official.includes(suffix);
    return { result, noncanonical: !official };
  }

  const numeric = /^(\d+)(?:([.,])(\d+))?$/.exec(suffix);
  if (numeric == null) {
    return { result: null, noncanonical: false };
  }
  const whole = numeric[1]!.replace(/^0+(?=\d)/, "");
  const fraction = (numeric[3] ?? "").replace(/0+$/, "");
  const canonicalNumber = `${whole}${fraction ? `.${fraction}` : ""}`;
  if (
    /^0(?:\.0*)?$/.test(canonicalNumber) ||
    !isCanonicalMarginWithinProductRangeV1(canonicalNumber) ||
    String(Number(canonicalNumber)) !== canonicalNumber
  ) {
    return { result: null, noncanonical: false };
  }
  const result = `${color}+${canonicalNumber}`;
  const noncanonical =
    color !== win[1] || value !== compact || numeric[2] === ",";
  return { result, noncanonical };
}

function parseFieldV1(
  scan: PropertyScanV1,
  field: SgfGameMetadataFieldV1,
  warnings: SgfGameMetadataWarningV1[]
): string | null {
  const occurrences = scan.occurrences[field];
  if (scan.malformed.has(field)) {
    warnings.push({ field, code: "malformed" });
  }
  if (occurrences.some(occurrence => occurrence.nodeIndex !== 0)) {
    warnings.push({ field, code: "non_root" });
  }
  if (occurrences.length > 1) {
    warnings.push({ field, code: "duplicate" });
  }
  if (
    scan.malformed.has(field) ||
    occurrences.length !== 1 ||
    occurrences[0]!.nodeIndex !== 0
  ) {
    return null;
  }
  const values = occurrences[0]!.values;
  if (values.length !== 1) {
    warnings.push({ field, code: "multi_value" });
    return null;
  }
  const value = values[0]!;
  if (value.length === 0) {
    warnings.push({ field, code: "blank" });
    return null;
  }
  if (Array.from(value).length > FIELD_LIMITS[field]) {
    warnings.push({ field, code: "too_long" });
    return null;
  }
  if (UNSAFE_CONTROL_PATTERN.test(value)) {
    warnings.push({ field, code: "unsafe_control" });
    return null;
  }
  return value;
}

/**
 * Parses optional root PB/PW/DT/RE without making analysis admission depend on
 * descriptive metadata. Invalid fields fail closed to null with fixed warnings.
 */
export function parseSgfRootGameMetadataV1(
  sgf: string
): ParsedSgfGameMetadataV1 {
  const scan = scanMetadataPropertiesV1(sgf);
  const warnings: SgfGameMetadataWarningV1[] = [];
  const blackPlayer = parseFieldV1(scan, "PB", warnings);
  const whitePlayer = parseFieldV1(scan, "PW", warnings);
  const rawDate = parseFieldV1(scan, "DT", warnings);
  const resultRaw = parseFieldV1(scan, "RE", warnings);

  let date = rawDate;
  if (date != null && !isValidSgfDateV1(date)) {
    warnings.push({ field: "DT", code: "invalid_format" });
    date = null;
  }

  let result: string | null = null;
  if (resultRaw != null) {
    const normalized = normalizeSgfResultV1(resultRaw);
    result = normalized.result;
    if (result == null) {
      warnings.push({ field: "RE", code: "invalid_format" });
    } else if (normalized.noncanonical) {
      warnings.push({ field: "RE", code: "noncanonical_format" });
    }
  }

  return {
    version: SGF_GAME_INFO_VERSION_V1,
    blackPlayer,
    whitePlayer,
    date,
    resultRaw: result == null ? null : resultRaw,
    result,
    warnings,
  };
}

export type SafeStoredSgfGameMetadataV1 = {
  blackPlayer: string | null;
  whitePlayer: string | null;
  date: string | null;
  result: string | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeStoredFieldV1(
  field: SgfGameMetadataFieldV1,
  value: unknown
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .normalize("NFC")
    .replace(/\s/g, " ")
    .trim()
    .replace(/ +/g, " ");
  if (
    normalized.length === 0 ||
    Array.from(normalized).length > FIELD_LIMITS[field] ||
    UNSAFE_CONTROL_PATTERN.test(normalized)
  ) {
    return null;
  }
  if (field === "DT") {
    return isValidSgfDateV1(normalized) ? normalized : null;
  }
  if (field === "RE") {
    return normalizeSgfResultV1(normalized).result;
  }
  return normalized;
}

/** Revalidates persisted marker payloads before any metadata reaches the UI. */
export function readSafeStoredSgfGameMetadataV1(
  gameInfo: unknown
): SafeStoredSgfGameMetadataV1 | null {
  if (
    !isPlainObject(gameInfo) ||
    gameInfo.metadata_version !== SGF_GAME_INFO_VERSION_V1
  ) {
    return null;
  }
  return {
    blackPlayer: sanitizeStoredFieldV1("PB", gameInfo.black_player),
    whitePlayer: sanitizeStoredFieldV1("PW", gameInfo.white_player),
    date: sanitizeStoredFieldV1("DT", gameInfo.date),
    result: sanitizeStoredFieldV1("RE", gameInfo.result),
  };
}
