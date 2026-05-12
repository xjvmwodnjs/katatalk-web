import { describe, expect, it, vi } from "vitest";
import { resolveListenPortForServer } from "./_core/listenPort";

describe("resolveListenPortForServer", () => {
  it("production uses exact PORT from env", async () => {
    await expect(
      resolveListenPortForServer({
        isProduction: true,
        portFromEnv: 8080,
        findAvailablePort: vi.fn(async () => 9999),
      })
    ).resolves.toBe(8080);
  });

  it("production rejects invalid port", async () => {
    await expect(
      resolveListenPortForServer({
        isProduction: true,
        portFromEnv: NaN,
        findAvailablePort: vi.fn(),
      })
    ).rejects.toThrow("INVALID_PRODUCTION_LISTEN_PORT");

    await expect(
      resolveListenPortForServer({
        isProduction: true,
        portFromEnv: 0,
        findAvailablePort: vi.fn(),
      })
    ).rejects.toThrow("INVALID_PRODUCTION_LISTEN_PORT");
  });

  it("development delegates to findAvailablePort", async () => {
    const find = vi.fn(async (start: number) => start + 2);
    await expect(
      resolveListenPortForServer({
        isProduction: false,
        portFromEnv: 3000,
        findAvailablePort: find,
      })
    ).resolves.toBe(3002);
    expect(find).toHaveBeenCalledWith(3000);
  });
});
