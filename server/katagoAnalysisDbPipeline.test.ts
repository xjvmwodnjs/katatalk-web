import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as creditService from "./creditService";
import * as analysisEngines from "./worker/analysisEngines";
import type { AnalysisJobDbRow } from "./creditService";
import { runKatagoAnalysisDbPipeline } from "./worker/katagoAnalysisDbPipeline";

describe("runKatagoAnalysisDbPipeline", () => {
  beforeEach(() => {
    vi.spyOn(creditService, "updateAnalysisJobRow").mockResolvedValue(undefined);
    vi.spyOn(analysisEngines, "analyzeSgfKatago").mockResolvedValue({
      ok: true,
      source: "katago-worker-v1",
      isMock: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks completed job is_mock=false in DB update", async () => {
    const row: AnalysisJobDbRow = {
      id: "kg-job-1",
      user_id: "user_a",
      status: "running",
      file_name: "g.sgf",
      language: "ko",
      credit_cost: 1,
      credit_log_id: "00000000-0000-0000-0000-00000000aa01",
      is_mock: false,
      progress: 15,
      result: null,
      error_message: null,
      created_at: "",
      updated_at: "",
      completed_at: null,
      sgf_content: "(;FF[4]GM[1]SZ[19];B[pd])",
      sgf_sha256: "x",
      sgf_size_bytes: 10,
    };

    await runKatagoAnalysisDbPipeline({
      jobId: "kg-job-1",
      row,
      fileName: "g.sgf",
      language: "ko",
    });

    const updateSpy = vi.mocked(creditService.updateAnalysisJobRow);
    const completedCall = updateSpy.mock.calls.find(
      args => (args[1] as { status?: string }).status === "completed"
    );
    expect(completedCall).toBeDefined();
    expect(completedCall![1]).toEqual(
      expect.objectContaining({
        status: "completed",
        progress: 100,
        is_mock: false,
      })
    );
  });
});
