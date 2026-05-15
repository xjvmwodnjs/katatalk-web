import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import * as resolve from "./_core/resolveRequestUser";
import { analyzeRouter } from "./analyzeRoute";
import { vitestAnalysisJobsStore, vitestSeedAnalysisJob } from "./vitestSetup";
import { SGF_UPLOAD_FORM_FIELD } from "@shared/const";
import type { AuthenticatedUser } from "./_core/sdk";
import { sha256HexUtf8, utf8ByteLength } from "./sgfPayload";

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
    delete process.env.ANALYSIS_ENGINE;
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

  it("GET completed merges DB sgf_content into data for owner", async () => {
    const resultPayload = { summary: "from-db", boardSize: 19 };
    vitestSeedAnalysisJob({
      id: "job-db-sgf-merge",
      user_id: "user_a",
      status: "completed",
      file_name: "game.sgf",
      language: "ko",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa20",
      is_mock: true,
      progress: 100,
      result: resultPayload,
      sgf_content: minimalSgf,
      error_message: null,
      completed_at: new Date().toISOString(),
    });
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const logSpy = vi.spyOn(console, "log");
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze/job-db-sgf-merge`, {
      headers: { Authorization: "Bearer fake" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data?: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ ...resultPayload, sgf_content: minimalSgf });
    const leaked = logSpy.mock.calls.some((args) =>
      args.some((a) => typeof a === "string" && a.includes(minimalSgf))
    );
    expect(leaked).toBe(false);
    logSpy.mockRestore();
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

  it("GET running does not expose sgf_content in response even when DB row has it", async () => {
    const secretSgf = "(;RUNNING_NO_LEAK_SGF_MARKER[aa])";
    vitestSeedAnalysisJob({
      id: "job-run-sgf",
      user_id: "user_a",
      status: "running",
      file_name: "r.sgf",
      language: "ko",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa21",
      is_mock: true,
      progress: 40,
      result: null,
      sgf_content: secretSgf,
      error_message: null,
      completed_at: null,
    });
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze/job-run-sgf`, {
      headers: { Authorization: "Bearer fake" },
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("RUNNING_NO_LEAK_SGF_MARKER");
    const body = JSON.parse(raw) as { status: string; data?: unknown };
    expect(body.status).toBe("running");
    expect(body.data).toBeUndefined();
  });

  it("GET failed does not return data with sgf_content even when DB row has it", async () => {
    const secretSgf = "(;FAILED_NO_LEAK_SGF_MARKER[bb])";
    vitestSeedAnalysisJob({
      id: "job-fail-sgf",
      user_id: "user_a",
      status: "failed",
      file_name: "bad.sgf",
      language: "ko",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa22",
      is_mock: true,
      progress: null,
      result: { ok: false },
      sgf_content: secretSgf,
      error_message: "pipeline exploded",
      completed_at: new Date().toISOString(),
    });
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze/job-fail-sgf`, {
      headers: { Authorization: "Bearer fake" },
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("FAILED_NO_LEAK_SGF_MARKER");
    const body = JSON.parse(raw) as { data?: unknown; error?: { message: string } };
    expect(body.data).toBeUndefined();
    expect(body.error?.message).toBe("pipeline exploded");
  });

  it("GET completed normalizes DB status casing and parses stringified result", async () => {
    const katagoPayload = {
      ok: true,
      source: "katago-worker-v1",
      isMock: false,
      top_mistakes: [],
      engine: { name: "katago", maxVisits: 800 },
      katago: {
        hasWinrate: true,
        hasScoreLead: true,
        moveInfosCount: 16,
        rootInfo: { winrate: 0.52, scoreLead: 1.5, currentPlayer: "B" },
        topMove: { move: "Q16", winrate: 0.51, scoreLead: 1.2 },
      },
    };
    vitestSeedAnalysisJob({
      id: "job-katago-str",
      user_id: "user_a",
      status: "COMPLETED",
      file_name: "k.sgf",
      language: "ko",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa10",
      is_mock: false,
      progress: 100,
      result: JSON.stringify(katagoPayload),
      sgf_content: minimalSgf,
      error_message: null,
      completed_at: new Date().toISOString(),
    });
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze/job-katago-str`, {
      headers: { Authorization: "Bearer fake" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; status: string; data?: unknown };
    expect(body.success).toBe(true);
    expect(body.status).toBe("completed");
    expect(body.data).toEqual({ ...katagoPayload, sgf_content: minimalSgf });
    expect(res.headers.get("X-KataTalk-Mock")).toBeNull();
  });

  it("GET queued does not expose sgf_content when DB row has it", async () => {
    const secret = "(;QUEUED_SGF_NOT_IN_RESPONSE[cc])";
    vitestSeedAnalysisJob({
      id: "job-q-sgf",
      user_id: "user_a",
      status: "queued",
      file_name: "q2.sgf",
      language: "en",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa23",
      is_mock: true,
      progress: 0,
      result: null,
      sgf_content: secret,
      error_message: null,
      completed_at: null,
    });
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze/job-q-sgf`, {
      headers: { Authorization: "Bearer fake" },
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("QUEUED_SGF_NOT_IN_RESPONSE");
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
    expect(row.sgf_content).toBe(minimalSgf);
    expect(row.sgf_sha256).toBe(sha256HexUtf8(minimalSgf));
    expect(row.sgf_size_bytes).toBe(utf8ByteLength(minimalSgf));
  });

  it("POST inserts is_mock=false when ANALYSIS_ENGINE=katago and ANALYSIS_WORKER_MODE=external", async () => {
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
    const body = (await res.json()) as { jobId: string; success: boolean };
    const row = vitestAnalysisJobsStore.get(body.jobId)!;
    expect(row.is_mock).toBe(false);
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
