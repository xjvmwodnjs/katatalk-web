export const ANALYSIS_REQUEST_ID_HEADER = "Idempotency-Key" as const;
export const ANALYSIS_REQUEST_ID_MIN_LENGTH = 16;
export const ANALYSIS_REQUEST_ID_MAX_LENGTH = 128;

const ANALYSIS_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;

/**
 * Public analysis submission id. It is opaque, contains no user data, and is
 * scoped by the authenticated wallet subject in the database.
 */
export function normalizeAnalysisRequestId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return ANALYSIS_REQUEST_ID_PATTERN.test(normalized) ? normalized : null;
}
