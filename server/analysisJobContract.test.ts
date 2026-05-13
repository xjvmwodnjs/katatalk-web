import { describe, expect, it } from "vitest";
import {
  isKatagoWorkerV1ResultPayload,
  normalizeAnalysisJobStatus,
  parseStoredAnalysisJobResult,
} from "@shared/analysisJob";

describe("shared/analysisJob helpers", () => {
  it("normalizeAnalysisJobStatus lowercases terminal states", () => {
    expect(normalizeAnalysisJobStatus("COMPLETED")).toBe("completed");
    expect(normalizeAnalysisJobStatus("Queued")).toBe("queued");
    expect(normalizeAnalysisJobStatus("FAILED")).toBe("failed");
    expect(normalizeAnalysisJobStatus("RUNNING")).toBe("running");
  });

  it("parseStoredAnalysisJobResult parses JSON strings", () => {
    const obj = { ok: true, source: "katago-worker-v1" };
    expect(parseStoredAnalysisJobResult(JSON.stringify(obj))).toEqual(obj);
    expect(parseStoredAnalysisJobResult(obj)).toEqual(obj);
    expect(parseStoredAnalysisJobResult(null)).toBeNull();
    expect(parseStoredAnalysisJobResult("")).toBeNull();
    expect(parseStoredAnalysisJobResult("{not json")).toBeNull();
  });

  it("isKatagoWorkerV1ResultPayload recognizes katago-worker-v1", () => {
    expect(isKatagoWorkerV1ResultPayload({ source: "katago-worker-v1" })).toBe(true);
    expect(isKatagoWorkerV1ResultPayload({ source: "mock" })).toBe(false);
    expect(isKatagoWorkerV1ResultPayload(null)).toBe(false);
  });
});
