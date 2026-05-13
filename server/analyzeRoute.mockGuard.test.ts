import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import * as resolve from "./_core/resolveRequestUser";
import { analyzeRouter } from "./analyzeRoute";
import { SGF_UPLOAD_FORM_FIELD } from "@shared/const";
import type { AuthenticatedUser } from "./_core/sdk";

vi.mock("./_core/resolveRequestUser", () => ({
  tryResolveUserFromRequest: vi.fn(),
}));

const userA = {
  id: 1,
  openId: "clerk:user_a",
  email: "a@test.com",
  name: "User A",
  loginMethod: "clerk",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
} as AuthenticatedUser;

const minimalSgf = "(;FF[4]GM[1]SZ[19];B[pd];W[dp])";

function listen(app: express.Express): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolvePromise, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolvePromise({ server, port });
    });
    server.on("error", reject);
  });
}

describe("POST /api/analyze mock guard (production)", () => {
  let server: http.Server;
  let port: number;
  let envBackup: NodeJS.ProcessEnv;

  beforeAll(async () => {
    const app = express();
    app.use(analyzeRouter);
    const r = await listen(app);
    server = r.server;
    port = r.port;
  });

  afterAll(async () => {
    await new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res())));
  });

  beforeEach(() => {
    envBackup = { ...process.env };
    vi.mocked(resolve.tryResolveUserFromRequest).mockReset();
  });

  afterEach(() => {
    process.env = envBackup;
    delete process.env.ANALYSIS_ENGINE;
    delete process.env.ANALYSIS_WORKER_MODE;
  });

  it("returns 503 MOCK_ANALYSIS_DISABLED when production + mock engine + flag not true", async () => {
    process.env.NODE_ENV = "production";
    process.env.KATATALK_ALLOW_MOCK_ANALYSIS = "false";
    delete process.env.ANALYSIS_ENGINE;
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);

    const fd = new FormData();
    fd.append("language", "ko");
    fd.append(SGF_UPLOAD_FORM_FIELD, new Blob([minimalSgf], { type: "application/octet-stream" }), "game.sgf");

    const res = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
      method: "POST",
      headers: { Authorization: "Bearer fake" },
      body: fd,
    });

    expect(res.status).toBe(503);
    const body = (await res.json()) as { code?: string; success?: boolean };
    expect(body.success).toBe(false);
    expect(body.code).toBe("MOCK_ANALYSIS_DISABLED");
  });

  it("allows enqueue when production + ANALYSIS_ENGINE=katago + ANALYSIS_WORKER_MODE=external without mock flag", async () => {
    process.env.NODE_ENV = "production";
    process.env.KATATALK_ALLOW_MOCK_ANALYSIS = "false";
    process.env.ANALYSIS_ENGINE = "katago";
    process.env.ANALYSIS_WORKER_MODE = "external";
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);

    const fd = new FormData();
    fd.append("language", "ko");
    fd.append(SGF_UPLOAD_FORM_FIELD, new Blob([minimalSgf], { type: "application/octet-stream" }), "game.sgf");

    const res = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
      method: "POST",
      headers: { Authorization: "Bearer fake" },
      body: fd,
    });

    expect(res.status).toBe(202);
  });

  it("returns 503 KATAGO_INLINE_FORBIDDEN when production + katago + inline", async () => {
    process.env.NODE_ENV = "production";
    process.env.ANALYSIS_ENGINE = "katago";
    process.env.ANALYSIS_WORKER_MODE = "inline";
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);

    const fd = new FormData();
    fd.append("language", "ko");
    fd.append(SGF_UPLOAD_FORM_FIELD, new Blob([minimalSgf], { type: "application/octet-stream" }), "game.sgf");

    const res = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
      method: "POST",
      headers: { Authorization: "Bearer fake" },
      body: fd,
    });

    expect(res.status).toBe(503);
    const body = (await res.json()) as { code?: string; success?: boolean };
    expect(body.success).toBe(false);
    expect(body.code).toBe("KATAGO_INLINE_FORBIDDEN");
  });

  it("allows analyze when NODE_ENV is test (development behavior)", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.KATATALK_ALLOW_MOCK_ANALYSIS;
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);

    const fd = new FormData();
    fd.append("language", "ko");
    fd.append(SGF_UPLOAD_FORM_FIELD, new Blob([minimalSgf], { type: "application/octet-stream" }), "game.sgf");

    const res = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
      method: "POST",
      headers: { Authorization: "Bearer fake" },
      body: fd,
    });

    expect(res.status).toBe(202);
  });
});
