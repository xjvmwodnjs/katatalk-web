import { describe, expect, it, vi, afterEach } from "vitest";
import {
  isLegacyMockResultPayload,
  resolveCompletedJobMetaMock,
  resolveWorkerPipelineForClaimedJob,
  sanitizeAnalysisJobErrorMessage,
} from "./analysisEngineDeterminism";
import { shouldEnqueueAnalysisJobAsMock } from "./middleware/analyzeEnqueueGuard";
import { processClaimedAnalysisJob } from "./worker/processClaimedAnalysisJob";
import type { AnalysisJobDbRow } from "./creditService";

vi.mock("./worker/katagoAnalysisDbPipeline", () => ({
  runKatagoAnalysisDbPipeline: vi.fn(async () => undefined),
}));
vi.mock("./mockAnalysisDbPipeline", () => ({
  runMockAnalysisDbPipeline: vi.fn(async () => undefined),
}));
vi.mock("./creditService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./creditService")>();
  return {
    ...actual,
    analysisJobProcessingLeaseFromClaimedRow: vi.fn(() => null),
    refundCreditIfJobFailedByProfileId: vi.fn(async () => ({ ok: true, duplicate: false })),
    updateAnalysisJobRow: vi.fn(async () => undefined),
    updateAnalysisJobRowWithLease: vi.fn(async () => ({ ok: true as const })),
  };
});

function makeRow(overrides: Partial<AnalysisJobDbRow> = {}): AnalysisJobDbRow {
  return {
    id: "job-1",
    user_id: "user-1",
    status: "running",
    progress: 10,
    file_name: "g.sgf",
    language: "ko",
    is_mock: false,
    credit_cost: 1,
    credit_log_id: "log-1",
    sgf_content: "(;SZ[19];B[pd];W[dp])",
    sgf_sha256: null,
    sgf_size_bytes: null,
    result: null,
    error_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
    locked_at: null,
    locked_by: null,
    attempt_count: 1,
    max_attempts: 3,
    next_retry_at: null,
    last_error_code: null,
    ...overrides,
  };
}

describe("shouldEnqueueAnalysisJobAsMock", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it("katago + external → is_mock=false at enqueue policy", () => {
    process.env.ANALYSIS_ENGINE = "katago";
    process.env.ANALYSIS_WORKER_MODE = "external";
    expect(shouldEnqueueAnalysisJobAsMock()).toBe(false);
  });
});

describe("resolveWorkerPipelineForClaimedJob", () => {
  it("is_mock=false + worker mock → engine_mismatch", () => {
    const r = resolveWorkerPipelineForClaimedJob(makeRow({ is_mock: false }), "mock");
    expect(r.pipeline).toBe("engine_mismatch");
    expect(r.mismatchCode).toBe("ENGINE_MISMATCH_WORKER_MOCK");
  });

  it("is_mock=true + worker katago → engine_mismatch", () => {
    const r = resolveWorkerPipelineForClaimedJob(makeRow({ is_mock: true }), "katago");
    expect(r.pipeline).toBe("engine_mismatch");
    expect(r.mismatchCode).toBe("ENGINE_MISMATCH_JOB_MOCK");
  });
});

describe("resolveCompletedJobMetaMock", () => {
  it("katago-worker-v1 → meta.mock=false", () => {
    const meta = resolveCompletedJobMetaMock(makeRow({ is_mock: false }), {
      source: "katago-worker-v1",
      isMock: false,
      ok: true,
    });
    expect(meta?.mock).toBe(false);
  });

  it("row.is_mock=true → meta.mock=true", () => {
    const meta = resolveCompletedJobMetaMock(makeRow({ is_mock: true }), {
      source: { mock: true, fileName: "x.sgf" },
    });
    expect(meta?.mock).toBe(true);
  });

  it("katago source wins over row.is_mock contradiction", () => {
    const meta = resolveCompletedJobMetaMock(makeRow({ is_mock: true }), {
      source: "katago-worker-v1",
      isMock: false,
      ok: true,
    });
    expect(meta?.mock).toBe(false);
  });

  it("legacy mock payload → meta.mock=true", () => {
    expect(isLegacyMockResultPayload({ source: { mock: true } })).toBe(true);
    const meta = resolveCompletedJobMetaMock(makeRow({ is_mock: false }), {
      source: { mock: true, fileName: "f" },
    });
    expect(meta?.mock).toBe(true);
  });
});

describe("processClaimedAnalysisJob engine mismatch", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    vi.clearAllMocks();
  });

  it("is_mock=false + worker mock does not run mock pipeline", async () => {
    process.env.ANALYSIS_ENGINE = "mock";
    const { runMockAnalysisDbPipeline } = await import("./mockAnalysisDbPipeline");
    const { runKatagoAnalysisDbPipeline } = await import("./worker/katagoAnalysisDbPipeline");
    const { updateAnalysisJobRow, refundCreditIfJobFailedByProfileId } = await import("./creditService");

    await processClaimedAnalysisJob(makeRow({ is_mock: false, credit_cost: 1 }));

    expect(runMockAnalysisDbPipeline).not.toHaveBeenCalled();
    expect(runKatagoAnalysisDbPipeline).not.toHaveBeenCalled();
    expect(updateAnalysisJobRow).toHaveBeenCalled();
    const patch = vi.mocked(updateAnalysisJobRow).mock.calls[0]?.[1] as {
      status?: string;
      error_message?: string;
    };
    expect(patch.status).toBe("failed");
    expect(patch.error_message).toContain("ENGINE_MISMATCH_WORKER_MOCK");
    expect(refundCreditIfJobFailedByProfileId).toHaveBeenCalled();
  });

  it("is_mock=true + worker katago refunds paid job without running pipelines", async () => {
    process.env.ANALYSIS_ENGINE = "katago";
    const { runMockAnalysisDbPipeline } = await import("./mockAnalysisDbPipeline");
    const { runKatagoAnalysisDbPipeline } = await import("./worker/katagoAnalysisDbPipeline");
    const { updateAnalysisJobRow, refundCreditIfJobFailedByProfileId } = await import("./creditService");

    await processClaimedAnalysisJob(makeRow({ is_mock: true, credit_cost: 1 }));

    expect(runKatagoAnalysisDbPipeline).not.toHaveBeenCalled();
    expect(runMockAnalysisDbPipeline).not.toHaveBeenCalled();
    const patch = vi.mocked(updateAnalysisJobRow).mock.calls[0]?.[1] as {
      status?: string;
      error_message?: string;
    };
    expect(patch.status).toBe("failed");
    expect(patch.error_message).toContain("ENGINE_MISMATCH_JOB_MOCK");
    expect(refundCreditIfJobFailedByProfileId).toHaveBeenCalled();
  });

  it("engine mismatch with credit_cost=0 does not refund", async () => {
    process.env.ANALYSIS_ENGINE = "katago";
    const { refundCreditIfJobFailedByProfileId } = await import("./creditService");

    await processClaimedAnalysisJob(makeRow({ is_mock: true, credit_cost: 0 }));

    expect(refundCreditIfJobFailedByProfileId).not.toHaveBeenCalled();
  });
});

describe("sanitizeAnalysisJobErrorMessage", () => {
  it("strips embedded SGF snippets from messages", () => {
    const sgf = "(;SZ[19];B[pd];W[dp];B[pq])";
    const out = sanitizeAnalysisJobErrorMessage(`fail ${sgf} tail`);
    expect(out).not.toContain("B[pd]");
    expect(out).toContain("(;…)");
  });

  it("redacts 500+ char SGF while keeping error code prefix", () => {
    const moves = Array.from({ length: 120 }, (_, i) =>
      i % 2 === 0 ? `;B[${String.fromCharCode(97 + (i % 19))}${String.fromCharCode(97 + (i % 19))}]` : ";W[]"
    ).join("");
    const longSgf = `(;SZ[19]${moves})`;
    expect(longSgf.length).toBeGreaterThan(500);
    const out = sanitizeAnalysisJobErrorMessage(`SGF_PARSE_FAILED: parse error ${longSgf} end`);
    expect(out.startsWith("SGF_PARSE_FAILED:")).toBe(true);
    expect(out).not.toMatch(/[BW]\[/);
    expect(out).not.toContain("SZ[");
    expect(out).not.toContain(longSgf.slice(0, 40));
  });

  it("redacts multiple (; ...) fragments and newline SGF", () => {
    const out = sanitizeAnalysisJobErrorMessage(
      "KATAGO_QUERY_BUILD_FAILED: a (;SZ[9];B[aa])\n and (;SZ[13];W[bb]) tail"
    );
    expect(out.startsWith("KATAGO_QUERY_BUILD_FAILED:")).toBe(true);
    expect(out).not.toMatch(/SZ\[/);
    expect(out).not.toMatch(/B\[/);
    expect(out).not.toMatch(/W\[/);
    expect(out).toContain("(;…)");
  });

  it("leaves short non-SGF errors readable", () => {
    const out = sanitizeAnalysisJobErrorMessage("KATAGO_EXIT_NONZERO: exit 1");
    expect(out).toBe("KATAGO_EXIT_NONZERO: exit 1");
  });
});
