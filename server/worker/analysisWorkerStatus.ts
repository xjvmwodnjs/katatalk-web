import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../_core/supabaseAdmin";

export type AnalysisWorkerEngine = "mock" | "katago";
export type AnalysisWorkerHealthStatus = "live" | "stale" | "never_seen" | "unknown";

type WorkerHealthRow = {
  observed_at?: unknown;
  live_instances?: unknown;
  last_heartbeat_at?: unknown;
  last_success_at?: unknown;
};

export type AnalysisWorkerHealth = {
  status: AnalysisWorkerHealthStatus;
  expectedEngine: AnalysisWorkerEngine;
  liveInstances: number;
  lastHeartbeatAt: string | null;
  lastSuccessAt: string | null;
  staleAfterSeconds: number;
};

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

export function createAnalysisWorkerInstanceId(): string {
  return randomUUID();
}

export function readAnalysisWorkerStatusHeartbeatSeconds(env: NodeJS.ProcessEnv = process.env): number {
  return Math.min(readPositiveInt(env.ANALYSIS_WORKER_STATUS_HEARTBEAT_SECONDS, 15), 300);
}

export function readAnalysisWorkerStatusStaleSeconds(env: NodeJS.ProcessEnv = process.env): number {
  return Math.min(readPositiveInt(env.ANALYSIS_WORKER_STATUS_STALE_SECONDS, 60), 3600);
}

export async function reportAnalysisWorkerStatus(args: {
  instanceId: string;
  workerId: string;
  engine: AnalysisWorkerEngine;
  success?: boolean;
  client?: RpcClient;
}): Promise<void> {
  const client = args.client ?? getSupabaseAdmin();
  const { error } = await client.rpc("report_analysis_worker", {
    p_instance_id: args.instanceId,
    p_worker_id: args.workerId,
    p_engine: args.engine,
    p_success: args.success === true,
  });
  if (error) {
    throw new Error("ANALYSIS_WORKER_STATUS_REPORT_FAILED");
  }
}

export function healthFromRpcRow(args: {
  expectedEngine: AnalysisWorkerEngine;
  staleAfterSeconds: number;
  row: WorkerHealthRow | null;
}): AnalysisWorkerHealth {
  const row = args.row;
  if (!row) {
    return {
      status: "unknown",
      expectedEngine: args.expectedEngine,
      liveInstances: 0,
      lastHeartbeatAt: null,
      lastSuccessAt: null,
      staleAfterSeconds: args.staleAfterSeconds,
    };
  }
  const liveInstances = typeof row.live_instances === "number" && row.live_instances > 0
    ? Math.trunc(row.live_instances)
    : 0;
  const lastHeartbeatAt = timestamp(row.last_heartbeat_at);
  return {
    status: liveInstances > 0 ? "live" : lastHeartbeatAt ? "stale" : "never_seen",
    expectedEngine: args.expectedEngine,
    liveInstances,
    lastHeartbeatAt,
    lastSuccessAt: timestamp(row.last_success_at),
    staleAfterSeconds: args.staleAfterSeconds,
  };
}

export async function getAnalysisWorkerHealth(args: {
  expectedEngine: AnalysisWorkerEngine;
  staleAfterSeconds?: number;
  client?: RpcClient;
}): Promise<AnalysisWorkerHealth> {
  const staleAfterSeconds = args.staleAfterSeconds ?? readAnalysisWorkerStatusStaleSeconds();
  const client = args.client ?? getSupabaseAdmin();
  const { data, error } = await client.rpc("get_analysis_worker_health", {
    p_engine: args.expectedEngine,
    p_stale_seconds: staleAfterSeconds,
  });
  if (error) {
    throw new Error("ANALYSIS_WORKER_STATUS_READ_FAILED");
  }
  const rows = Array.isArray(data) ? data : [];
  return healthFromRpcRow({
    expectedEngine: args.expectedEngine,
    staleAfterSeconds,
    row: (rows[0] as WorkerHealthRow | undefined) ?? null,
  });
}

export function startAnalysisWorkerStatusHeartbeat(args: {
  instanceId: string;
  workerId: string;
  engine: AnalysisWorkerEngine;
  intervalSeconds?: number;
  report?: (success?: boolean) => Promise<void>;
}): { reportSuccess: () => Promise<void>; stop: () => Promise<void> } {
  const intervalMs = Math.max(1, args.intervalSeconds ?? readAnalysisWorkerStatusHeartbeatSeconds()) * 1000;
  const report = args.report ?? (success => reportAnalysisWorkerStatus({ ...args, success }));
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const schedule = (): void => {
    if (!stopped) {
      timer = setTimeout(() => {
        void send();
      }, intervalMs);
    }
  };
  const send = (success = false): Promise<void> => {
    inFlight = inFlight.then(async () => {
      try {
        await report(success);
      } catch (error) {
        console.warn("[analysis-worker] status report failed", {
          code: error instanceof Error ? error.message : "UNKNOWN",
        });
      } finally {
        if (!success) {
          schedule();
        }
      }
    });
    return inFlight;
  };
  const reportSuccess = async (): Promise<void> => {
    await send(true);
  };

  void send();
  return {
    reportSuccess,
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
  };
}
