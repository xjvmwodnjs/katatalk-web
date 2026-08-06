import express from "express";
import http from "http";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  tryResolveUserFromRequest: vi.fn(),
}));

vi.mock("./_core/resolveRequestUser", () => ({
  tryResolveUserFromRequest: mocks.tryResolveUserFromRequest,
}));

import {
  AUTH_DEPENDENCY_UNAVAILABLE_CODE,
  AUTH_DEPENDENCY_UNAVAILABLE_MESSAGE,
  AuthDependencyUnavailableError,
} from "./_core/authErrors";
import { createContext } from "./_core/context";
import type { TrpcContext } from "./_core/context";
import { requireAnalyzeAuth } from "./middleware/requireAnalyzeAuth";
import { appRouter } from "./routers";

function listen(
  app: express.Express
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        port: typeof address === "object" && address ? address.port : 0,
      });
    });
    server.on("error", reject);
  });
}

describe("authentication dependency boundary", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const app = express();
    app.get("/private", requireAnalyzeAuth, (_req, res) => {
      res.json({ success: true });
    });
    ({ server, port } = await listen(app));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for a missing or invalid token", async () => {
    mocks.tryResolveUserFromRequest.mockResolvedValue(null);

    const response = await fetch(`http://127.0.0.1:${port}/private`);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it("returns a fixed non-reflecting 503 for an auth dependency outage", async () => {
    const sensitive =
      "https://secret-jwks.example/private?token=do-not-reflect";
    mocks.tryResolveUserFromRequest.mockRejectedValue(
      Object.assign(new AuthDependencyUnavailableError(), { hidden: sensitive })
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await fetch(`http://127.0.0.1:${port}/private`, {
      headers: { Authorization: "Bearer sensitive-token-value" },
    });
    const raw = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(raw)).toEqual({
      success: false,
      code: AUTH_DEPENDENCY_UNAVAILABLE_CODE,
      message: AUTH_DEPENDENCY_UNAVAILABLE_MESSAGE,
    });
    expect(raw).not.toContain(sensitive);
    expect(raw).not.toContain("sensitive-token-value");
    expect(errorSpy.mock.calls.flat().join(" ")).toBe(
      "[requireAnalyzeAuth] AUTH_DEPENDENCY_UNAVAILABLE"
    );
    errorSpy.mockRestore();
  });

  it("preserves a dependency outage in tRPC instead of returning auth.me null", async () => {
    mocks.tryResolveUserFromRequest.mockRejectedValue(
      new AuthDependencyUnavailableError()
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const req = { headers: {} } as TrpcContext["req"];
    const res = {} as TrpcContext["res"];

    const ctx = await createContext({ req, res });
    const caller = appRouter.createCaller(ctx);

    await expect(caller.auth.me()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: AUTH_DEPENDENCY_UNAVAILABLE_MESSAGE,
    });
    expect(ctx.authError).toBe(AUTH_DEPENDENCY_UNAVAILABLE_CODE);
    expect(errorSpy.mock.calls.flat().join(" ")).toBe(
      "[trpc auth] AUTH_DEPENDENCY_UNAVAILABLE"
    );
    errorSpy.mockRestore();
  });
});
