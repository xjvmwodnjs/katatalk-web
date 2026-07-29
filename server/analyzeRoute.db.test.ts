import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import * as resolve from "./_core/resolveRequestUser";
import * as creditService from "./creditService";
import { analyzeRouter } from "./analyzeRoute";
import { vitestAnalysisJobsStore, vitestSeedAnalysisJob } from "./vitestSetup";
import { SGF_UPLOAD_FORM_FIELD } from "@shared/const";
import type { AuthenticatedUser } from "./_core/sdk";
import { sha256HexUtf8, utf8ByteLength } from "./sgfPayload";
import { appendWinrateTimelineProgressEventV1 } from "./winrateTimelineProgressV1";

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
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete process.env.ANALYSIS_WORKER_MODE;
    delete process.env.ANALYSIS_ENGINE;
    delete process.env.KATAGO_WINRATE_TIMELINE_LOCAL_PROGRESS;
    process.env.NODE_ENV = "test";
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

  it("GET timeline-progress returns local progress only when enabled", async () => {
    process.env.NODE_ENV = "development";
    process.env.KATAGO_WINRATE_TIMELINE_LOCAL_PROGRESS = "true";
    const jobId = `progressapi${Date.now()}`;
    vitestSeedAnalysisJob({
      id: jobId,
      user_id: "user_a",
      status: "running",
      file_name: "r.sgf",
      language: "ko",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa23",
      is_mock: false,
      progress: 40,
      result: null,
      sgf_content: minimalSgf,
      error_message: null,
      completed_at: null,
    });
    await appendWinrateTimelineProgressEventV1({
      jobId,
      turnIndex: 1,
      isDuringSearch: true,
      visits: 7,
      winrate: 0.53,
      scoreLead: 0.2,
      currentPlayer: "W",
      receivedAt: "2026-01-01T00:00:00.000Z",
    });
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze/${jobId}/timeline-progress`, {
      headers: { Authorization: "Bearer fake" },
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain(minimalSgf);
    const body = JSON.parse(raw) as { success: boolean; points?: Array<{ turnIndex: number; visits: number }> };
    expect(body.success).toBe(true);
    expect(body.points?.[0]).toMatchObject({ turnIndex: 1, visits: 7 });
  });

  it("GET timeline-progress returns empty enabled response before progress file exists", async () => {
    process.env.NODE_ENV = "development";
    process.env.KATAGO_WINRATE_TIMELINE_LOCAL_PROGRESS = "true";
    const jobId = `progressmissing${Date.now()}`;
    vitestSeedAnalysisJob({
      id: jobId,
      user_id: "user_a",
      status: "running",
      file_name: "r.sgf",
      language: "ko",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa24",
      is_mock: false,
      progress: 40,
      result: null,
      sgf_content: minimalSgf,
      error_message: null,
      completed_at: null,
    });
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze/${jobId}/timeline-progress`, {
      headers: { Authorization: "Bearer fake" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; enabled?: boolean; points?: unknown[] };
    expect(body).toMatchObject({ success: true, enabled: true, points: [] });
  });

  it("GET timeline-progress returns enabled=false unless local progress opt-in is set", async () => {
    delete process.env.KATAGO_WINRATE_TIMELINE_LOCAL_PROGRESS;
    vitestSeedAnalysisJob({
      id: "disabled-progress",
      user_id: "user_a",
      status: "running",
      file_name: "r.sgf",
      language: "ko",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa25",
      is_mock: false,
      progress: 40,
      result: null,
      sgf_content: minimalSgf,
      error_message: null,
      completed_at: null,
    });
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze/disabled-progress/timeline-progress`, {
      headers: { Authorization: "Bearer fake" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; enabled?: boolean; points?: unknown[] };
    expect(body).toMatchObject({ success: true, enabled: false, points: [] });
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
    expect(body.error?.message).toBe("Analysis failed. Please try again.");
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

  it("GET failed returns an allowlisted public error instead of DB diagnostics", async () => {
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
    expect(body.error?.message).toBe("Analysis failed. Please try again.");
  });

  it("POST /api/analyze inserts analysis_jobs row (queued)", async () => {
    const ensureWalletSpy = vi.spyOn(
      creditService,
      "ensureWalletWithSignupBonus"
    );
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
    expect(resolve.tryResolveUserFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      { ensureWallet: false }
    );
    expect(ensureWalletSpy).toHaveBeenCalledTimes(1);
  });

  it("POST keeps invalid optional game metadata field-local and enqueues once", async () => {
    const ensureWalletSpy = vi.spyOn(
      creditService,
      "ensureWalletWithSignupBonus"
    );
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const sgf =
      "(;FF[4]GM[1]SZ[19]PB[A]PB[B]PW[One][Two]DT[2023-02-29]RE[B+private-marker];B[pd])";
    const fd = new FormData();
    fd.append("language", "ko");
    fd.append(
      SGF_UPLOAD_FORM_FIELD,
      new Blob([sgf], { type: "application/octet-stream" }),
      "optional-metadata-warnings.sgf"
    );
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
      method: "POST",
      headers: { Authorization: "Bearer fake" },
      body: fd,
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string; success: boolean };
    expect(body.success).toBe(true);
    expect(ensureWalletSpy).toHaveBeenCalledTimes(1);
    expect(vitestAnalysisJobsStore.get(body.jobId)?.sgf_content).toBe(sgf);
    expect(vitestAnalysisJobsStore.size).toBe(1);
  });

  it("POST rejects malformed UTF-8 before wallet, debit, or enqueue", async () => {
    const ensureWalletSpy = vi.spyOn(
      creditService,
      "ensureWalletWithSignupBonus"
    );
    const atomicEnqueueSpy = vi.spyOn(creditService, "enqueuePaidAnalysisJob");
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const bytes = new Uint8Array([
      ...Buffer.from("(;FF[4]GM[1]SZ[19]PB[", "utf8"),
      0xc3,
      0x28,
      ...Buffer.from("];B[pd])", "utf8"),
    ]);
    const fd = new FormData();
    fd.append("language", "ko");
    fd.append(
      SGF_UPLOAD_FORM_FIELD,
      new Blob([bytes], { type: "application/octet-stream" }),
      "invalid-utf8.sgf"
    );
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
      method: "POST",
      headers: { Authorization: "Bearer fake" },
      body: fd,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      code: "SGF_INVALID_ENCODING",
      message: "Invalid SGF: the uploaded file must be valid UTF-8.",
    });
    expect(ensureWalletSpy).not.toHaveBeenCalled();
    expect(atomicEnqueueSpy).not.toHaveBeenCalled();
    expect(vitestAnalysisJobsStore.size).toBe(0);
  });

  it("POST rejects after-move setup stones before credit spend/enqueue", async () => {
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);
    const fd = new FormData();
    fd.append("language", "ko");
    fd.append(SGF_UPLOAD_FORM_FIELD, new Blob(["(;FF[4]GM[1]SZ[19];B[pd];AW[dd])"], { type: "application/octet-stream" }), "late-setup.sgf");
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
      method: "POST",
      headers: { Authorization: "Bearer fake" },
      body: fd,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; message?: string };
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/AB\/AW\/AE|setup stones/i);
    expect(vitestAnalysisJobsStore.size).toBe(0);
  });

  it("POST rejects unsupported root rules before wallet, debit, or enqueue", async () => {
    const ensureWalletSpy = vi.spyOn(creditService, "ensureWalletWithSignupBonus");
    const atomicEnqueueSpy = vi.spyOn(creditService, "enqueuePaidAnalysisJob");
    const legacySpendSpy = vi.spyOn(creditService, "spendCreditForAnalysisJob");
    const legacyInsertSpy = vi.spyOn(creditService, "insertAnalysisJobQueued");
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);

    const marker = "private-rule-marker-947";
    const sgf = `(;FF[4]GM[1]SZ[19]RU[${marker}];B[pd];W[dp])`;
    const fd = new FormData();
    fd.append("language", "ko");
    fd.append(
      SGF_UPLOAD_FORM_FIELD,
      new Blob([sgf], { type: "application/octet-stream" }),
      "unsupported-rules.sgf"
    );
    const response = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
      method: "POST",
      headers: { Authorization: "Bearer fake" },
      body: fd,
    });

    expect(response.status).toBe(400);
    const rawBody = await response.text();
    const body = JSON.parse(rawBody) as {
      success: boolean;
      code?: string;
      message?: string;
    };
    expect(body).toEqual({
      success: false,
      code: "SGF_UNSUPPORTED_RULES",
      message: "Invalid SGF: only Japanese rules are supported.",
    });
    expect(rawBody).not.toContain(marker);
    expect(ensureWalletSpy).not.toHaveBeenCalled();
    expect(atomicEnqueueSpy).not.toHaveBeenCalled();
    expect(legacySpendSpy).not.toHaveBeenCalled();
    expect(legacyInsertSpy).not.toHaveBeenCalled();
    expect(vitestAnalysisJobsStore.size).toBe(0);
  });

  it("POST rejects invalid SGF analysis contracts before wallet, debit, or enqueue", async () => {
    const ensureWalletSpy = vi.spyOn(
      creditService,
      "ensureWalletWithSignupBonus"
    );
    const atomicEnqueueSpy = vi.spyOn(creditService, "enqueuePaidAnalysisJob");
    const legacySpendSpy = vi.spyOn(creditService, "spendCreditForAnalysisJob");
    const legacyInsertSpy = vi.spyOn(creditService, "insertAnalysisJobQueued");
    vi.mocked(resolve.tryResolveUserFromRequest).mockResolvedValue(userA);

    const marker = "private-initial-contract-marker-947";
    const cases = [
      {
        code: "SGF_INVALID_PLAYER_TO_PLAY",
        sgf: `(;FF[4]GM[1]SZ[19]PL[${marker}];B[pd])`,
      },
      {
        code: "SGF_PLAYER_TO_PLAY_CONFLICT",
        sgf: "(;FF[4]GM[1]SZ[19]PL[B];W[pd])",
      },
      {
        code: "SGF_UNSUPPORTED_PLAYER_TO_PLAY",
        sgf: "(;FF[4]GM[1]SZ[19];B[pd];PL[W];W[dp])",
      },
      {
        code: "SGF_INVALID_HANDICAP",
        sgf: `(;FF[4]GM[1]SZ[19]HA[${marker}]AB[pd][dp];W[qq])`,
      },
      {
        code: "SGF_HANDICAP_SETUP_MISMATCH",
        sgf: "(;FF[4]GM[1]SZ[19]HA[2]AB[pd];W[qq])",
      },
      {
        code: "SGF_INVALID_COORDINATE",
        sgf: "(;FF[4]GM[1]SZ[19]HA[2]AB[zz][yy];W[qq])",
      },
      {
        code: "SGF_INVALID_BOARD_SIZE",
        sgf: `(;FF[4]GM[1]SZ[${marker}];B[pd])`,
      },
      {
        code: "SGF_UNSUPPORTED_BOARD_SIZE",
        sgf: "(;FF[4]GM[1]SZ[19:13];B[pd])",
      },
      {
        code: "SGF_INVALID_KOMI",
        sgf: `(;FF[4]GM[1]SZ[19]KM[${marker}];B[pd])`,
      },
      {
        code: "SGF_UNSUPPORTED_KOMI",
        sgf: "(;FF[4]GM[1]SZ[19]KM[6.25];B[pd])",
      },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      const fd = new FormData();
      fd.append("language", "ko");
      fd.append(
        SGF_UPLOAD_FORM_FIELD,
        new Blob([testCase.sgf], { type: "application/octet-stream" }),
        `invalid-initial-contract-${String(index)}.sgf`
      );
      const response = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
        method: "POST",
        headers: { Authorization: "Bearer fake" },
        body: fd,
      });
      expect(response.status).toBe(400);
      const rawBody = await response.text();
      const body = JSON.parse(rawBody) as {
        success: boolean;
        code?: string;
      };
      expect(body.success).toBe(false);
      expect(body.code).toBe(testCase.code);
      expect(rawBody).not.toContain(marker);
    }

    expect(ensureWalletSpy).not.toHaveBeenCalled();
    expect(atomicEnqueueSpy).not.toHaveBeenCalled();
    expect(legacySpendSpy).not.toHaveBeenCalled();
    expect(legacyInsertSpy).not.toHaveBeenCalled();
    expect(vitestAnalysisJobsStore.size).toBe(0);
    expect(resolve.tryResolveUserFromRequest).toHaveBeenCalledTimes(cases.length);
    for (const [, options] of vi.mocked(resolve.tryResolveUserFromRequest).mock
      .calls) {
      expect(options).toEqual({ ensureWallet: false });
    }
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
