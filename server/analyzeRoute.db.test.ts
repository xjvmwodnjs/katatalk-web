import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import * as resolve from "./_core/resolveRequestUser";
import { analyzeRouter } from "./analyzeRoute";
import { vitestAnalysisJobsStore, vitestSeedAnalysisJob } from "./vitestSetup";
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

const userB = {
  id: 2,
  openId: "clerk:user_b",
  email: "b@test.com",
  name: "User B",
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

describe("analyzeRoute — DB-backed analysis_jobs", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(analyzeRouter);
    const r = await listen(app);
    server = r.server;
    port = r.port;
  });

  afterAll(async () => {
    await new Promise<void>((res, rej) => {
      server.close(err => (err ? rej(err) : res()));
    });
  });

  beforeEach(() => {
    vitestAnalysisJobsStore.clear();
    vi.mocked(resolve.tryResolveUserFromRequest).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ANALYSIS_WORKER_MODE;
  });

  it("GET /api/analyze/:jobId returns 404 when row is missing", async () => {
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze/missing-job-id-xyz`, {
      headers: { Authorization: "Bearer fake" },
    });
    expect(res.status).toBe(404);
  });

  it("GET returns 403 when job.user_id !== viewer", async () => {
    vitestSeedAnalysisJob({
      id: "job-cross",
      user_id: "user_a",
      status: "completed",
      file_name: "x.sgf",
      language: "ko",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa01",
      is_mock: true,
      progress: 100,
      result: { ok: true },
      error_message: null,
      completed_at: new Date().toISOString(),
    });
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userB);
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze/job-cross`, {
      headers: { Authorization: "Bearer fake" },
    });
    expect(res.status).toBe(403);
  });

  it("GET completed returns analysis_jobs.result from DB (no in-memory store)", async () => {
    const resultPayload = { summary: "from-db", boardSize: 19 };
    vitestSeedAnalysisJob({
      id: "job-db-result",
      user_id: "user_a",
      status: "completed",
      file_name: "game.sgf",
      language: "ko",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa02",
      is_mock: true,
      progress: 100,
      result: resultPayload,
      error_message: null,
      completed_at: new Date().toISOString(),
    });
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze/job-db-result`, {
      headers: { Authorization: "Bearer fake" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data?: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(resultPayload);
    expect(res.headers.get("X-KataTalk-Mock")).toBe("true");
  });

  it("GET queued returns status from DB row", async () => {
    vitestSeedAnalysisJob({
      id: "job-q",
      user_id: "user_a",
      status: "queued",
      file_name: "q.sgf",
      language: "en",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa03",
      is_mock: true,
      progress: 0,
      result: null,
      error_message: null,
      completed_at: null,
    });
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze/job-q`, {
      headers: { Authorization: "Bearer fake" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; progress: number | null };
    expect(body.status).toBe("queued");
    expect(body.progress).toBe(0);
  });

  it("GET failed returns error from DB", async () => {
    vitestSeedAnalysisJob({
      id: "job-fail",
      user_id: "user_a",
      status: "failed",
      file_name: "bad.sgf",
      language: "ko",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa04",
      is_mock: true,
      progress: null,
      result: null,
      error_message: "pipeline exploded",
      completed_at: new Date().toISOString(),
    });
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze/job-fail`, {
      headers: { Authorization: "Bearer fake" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; error?: { message: string } };
    expect(body.success).toBe(true);
    expect(body.error?.message).toBe("pipeline exploded");
  });

  it("POST /api/analyze inserts analysis_jobs row (queued)", async () => {
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
    const body = (await res.json()) as { jobId: string; success: boolean };
    expect(body.success).toBe(true);
    expect(vitestAnalysisJobsStore.has(body.jobId)).toBe(true);
    const row = vitestAnalysisJobsStore.get(body.jobId)!;
    expect(row.status).toBe("queued");
    expect(row.user_id).toBe("user_a");
    expect(row.is_mock).toBe(true);
    expect(row.credit_log_id).toBeTruthy();
  });

  it("POST with ANALYSIS_WORKER_MODE=external leaves job queued when timers advance", async () => {
    process.env.ANALYSIS_WORKER_MODE = "external";
    vi.useFakeTimers();
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
    const { jobId } = (await res.json()) as { jobId: string };
    await vi.advanceTimersByTimeAsync(60_000);
    const row = vitestAnalysisJobsStore.get(jobId);
    expect(row?.status).toBe("queued");
  });

  it("after mock timers, analysis_jobs becomes completed with result", async () => {
    vi.useFakeTimers();
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
    const { jobId } = (await res.json()) as { jobId: string };
    await vi.runAllTimersAsync();
    const row = vitestAnalysisJobsStore.get(jobId);
    expect(row?.status).toBe("completed");
    expect(row?.result).toBeDefined();
    expect(row?.progress).toBe(100);
  });
});
