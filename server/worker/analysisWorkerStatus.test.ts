import { describe, expect, it, vi } from "vitest";
import {
  getAnalysisWorkerHealth,
  healthFromRpcRow,
  readAnalysisWorkerStatusHeartbeatSeconds,
  readAnalysisWorkerStatusStaleSeconds,
  reportAnalysisWorkerStatus,
} from "./analysisWorkerStatus";

describe("analysis Worker status", () => {
  it("bounds heartbeat and stale settings", () => {
    expect(readAnalysisWorkerStatusHeartbeatSeconds({})).toBe(15);
    expect(readAnalysisWorkerStatusHeartbeatSeconds({ ANALYSIS_WORKER_STATUS_HEARTBEAT_SECONDS: "999" })).toBe(300);
    expect(readAnalysisWorkerStatusStaleSeconds({ ANALYSIS_WORKER_STATUS_STALE_SECONDS: "0" })).toBe(60);
    expect(readAnalysisWorkerStatusStaleSeconds({ ANALYSIS_WORKER_STATUS_STALE_SECONDS: "90" })).toBe(90);
  });

  it("does not treat an idle Worker without a success as unhealthy", () => {
    expect(healthFromRpcRow({
      expectedEngine: "katago",
      staleAfterSeconds: 60,
      row: {
        live_instances: 1,
        last_heartbeat_at: "2026-07-15T00:00:00.000Z",
        last_success_at: null,
      },
    })).toMatchObject({
      status: "live",
      liveInstances: 1,
      lastSuccessAt: null,
    });
  });

  it("maps stale, never-seen, and malformed results safely", () => {
    expect(healthFromRpcRow({
      expectedEngine: "katago",
      staleAfterSeconds: 60,
      row: { live_instances: 0, last_heartbeat_at: "2026-07-15T00:00:00.000Z" },
    }).status).toBe("stale");
    expect(healthFromRpcRow({ expectedEngine: "katago", staleAfterSeconds: 60, row: { live_instances: 0 } }).status).toBe("never_seen");
    expect(healthFromRpcRow({ expectedEngine: "katago", staleAfterSeconds: 60, row: null }).status).toBe("unknown");
  });

  it("uses service RPCs without exposing Worker identity", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    await reportAnalysisWorkerStatus({
      instanceId: "e4934132-3c27-4a8c-ae91-fab2b68cbaf6",
      workerId: "worker-private",
      engine: "katago",
      success: true,
      client: { rpc },
    });
    expect(rpc).toHaveBeenCalledWith("report_analysis_worker", expect.objectContaining({
      p_engine: "katago",
      p_success: true,
    }));

    rpc.mockResolvedValueOnce({
      data: [{ live_instances: 1, last_heartbeat_at: "2026-07-15T00:00:00.000Z", last_success_at: null }],
      error: null,
    });
    await expect(getAnalysisWorkerHealth({ expectedEngine: "katago", client: { rpc } })).resolves.toMatchObject({
      status: "live",
      expectedEngine: "katago",
    });
  });
});
