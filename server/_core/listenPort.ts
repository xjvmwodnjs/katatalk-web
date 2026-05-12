/**
 * Production: use the platform-provided PORT exactly (no scan/fallback).
 * Development: caller supplies findAvailablePort for local convenience.
 */
export async function resolveListenPortForServer(options: {
  isProduction: boolean;
  /** Parsed from process.env.PORT (may be NaN). */
  portFromEnv: number;
  findAvailablePort: (startPort: number) => Promise<number>;
}): Promise<number> {
  const raw = options.portFromEnv;
  if (options.isProduction) {
    if (!Number.isFinite(raw)) {
      throw new Error("INVALID_PRODUCTION_LISTEN_PORT");
    }
    const port = Math.trunc(raw);
    if (port < 1 || port > 65535) {
      throw new Error("INVALID_PRODUCTION_LISTEN_PORT");
    }
    return port;
  }
  const start =
    Number.isFinite(raw) && Math.trunc(raw) >= 1 && Math.trunc(raw) <= 65535
      ? Math.trunc(raw)
      : 3000;
  return options.findAvailablePort(start);
}
