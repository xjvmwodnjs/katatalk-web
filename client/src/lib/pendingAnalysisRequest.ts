import { normalizeAnalysisRequestId } from "@shared/analysisRequestId";
import { nanoid } from "nanoid";

const STORAGE_KEY = "katatalk:pending-analysis-requests:v3";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 8;
// Immutable v1 ceiling: no released server contract admitted a larger SGF.
// Keep this separate from a future, potentially lower, new-submission limit so
// old committed requests can still be recovered without hashing arbitrary data.
export const MAX_PENDING_ANALYSIS_RECOVERY_FILE_BYTES = 1024 * 1024;

type PendingAnalysisRequestV3 = {
  contentKey: string;
  requestId: string;
  createdAt: number;
};

type PendingAnalysisRequestStoreV3 = {
  version: 3;
  entries: PendingAnalysisRequestV3[];
};

export class PendingAnalysisRequestStorageError extends Error {
  readonly code = "ANALYSIS_RETRY_STORAGE_UNAVAILABLE";

  constructor() {
    super("Secure retry storage is unavailable.");
    this.name = "PendingAnalysisRequestStorageError";
  }
}

export class PendingAnalysisRequestFileTooLargeError extends Error {
  readonly code = "ANALYSIS_RETRY_FILE_TOO_LARGE";

  constructor() {
    super("The selected file exceeds the historical recovery ceiling.");
    this.name = "PendingAnalysisRequestFileTooLargeError";
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function contentKeyFor(
  file: File,
  language: string,
  accountScope: string
): Promise<string> {
  const [accountDigest, contentDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(accountScope)),
    crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
  ]);
  return `${bytesToHex(new Uint8Array(accountDigest))}:${language}:${bytesToHex(
    new Uint8Array(contentDigest)
  )}`;
}

function durableStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isValidEntry(
  value: unknown,
  now: number
): value is PendingAnalysisRequestV3 {
  if (value == null || typeof value !== "object") return false;
  const entry = value as Partial<PendingAnalysisRequestV3>;
  return (
    typeof entry.contentKey === "string" &&
    /^[0-9a-f]{64}:[a-z]{2}:[0-9a-f]{64}$/.test(entry.contentKey) &&
    normalizeAnalysisRequestId(entry.requestId) != null &&
    typeof entry.createdAt === "number" &&
    Number.isFinite(entry.createdAt) &&
    entry.createdAt <= now &&
    now - entry.createdAt <= MAX_AGE_MS
  );
}

function readPendingEntries(storage: Storage): PendingAnalysisRequestV3[] {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    throw new PendingAnalysisRequestStorageError();
  }
  if (!raw) return [];

  let parsed: Partial<PendingAnalysisRequestStoreV3>;
  try {
    parsed = JSON.parse(raw) as Partial<PendingAnalysisRequestStoreV3>;
  } catch {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // A later write will fail closed before a paid request is submitted.
    }
    return [];
  }

  if (parsed.version !== 3 || !Array.isArray(parsed.entries)) {
    writePendingEntries(storage, []);
    return [];
  }
  const now = Date.now();
  const entries = parsed.entries
    .filter(entry => isValidEntry(entry, now))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ENTRIES);
  if (entries.length !== parsed.entries.length) {
    writePendingEntries(storage, entries);
  }
  return entries;
}

function writePendingEntries(
  storage: Storage,
  entries: PendingAnalysisRequestV3[]
): void {
  try {
    if (entries.length === 0) {
      storage.removeItem(STORAGE_KEY);
      return;
    }
    const value: PendingAnalysisRequestStoreV3 = {
      version: 3,
      entries: entries.slice(0, MAX_ENTRIES),
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    throw new PendingAnalysisRequestStorageError();
  }
}

export async function getOrCreatePendingAnalysisRequest(
  file: File,
  language: string,
  accountScope: string
): Promise<{ requestId: string; contentKey: string }> {
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    file.size > MAX_PENDING_ANALYSIS_RECOVERY_FILE_BYTES
  ) {
    throw new PendingAnalysisRequestFileTooLargeError();
  }
  const storage = durableStorage();
  if (!storage) {
    throw new PendingAnalysisRequestStorageError();
  }
  const normalizedAccountScope = accountScope.trim();
  if (!normalizedAccountScope) {
    throw new PendingAnalysisRequestStorageError();
  }
  const contentKey = await contentKeyFor(
    file,
    language,
    normalizedAccountScope
  );
  const entries = readPendingEntries(storage);
  const existing = entries.find(entry => entry.contentKey === contentKey);
  if (existing) {
    return { requestId: existing.requestId, contentKey };
  }

  // Prefix guarantees the public contract's first-character requirement;
  // nanoid's default alphabet can otherwise begin with "_" or "-".
  const requestId = `req.${nanoid(28)}`;
  writePendingEntries(storage, [
    { contentKey, requestId, createdAt: Date.now() },
    ...entries.filter(entry => entry.contentKey !== contentKey),
  ]);
  return { requestId, contentKey };
}

export function clearPendingAnalysisRequest(
  requestId: string,
  contentKey: string
): void {
  const storage = durableStorage();
  if (!storage) return;
  try {
    const entries = readPendingEntries(storage);
    const remaining = entries.filter(
      entry => entry.requestId !== requestId || entry.contentKey !== contentKey
    );
    if (remaining.length !== entries.length) {
      writePendingEntries(storage, remaining);
    }
  } catch {
    // The acknowledged job ID is already persisted separately; stale cleanup
    // is retried when storage becomes available again.
  }
}
