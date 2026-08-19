import { createHash } from "node:crypto";

const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONFIRM_PREFIX = "RECONCILE_FINALIZATION:";
const SAFE_FAILURE_CODES = new Set([
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "NOT_RECONCILABLE",
  "LINK_ALREADY_SET",
  "LEDGER_INVARIANT",
]);

export type AnalysisFinalizationReconciliationRpcClient = {
  rpc: (
    name: string,
    params: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type AnalysisFinalizationReconciliationCommand = {
  jobId: string;
  apply: boolean;
  json: boolean;
};

export type AnalysisFinalizationReconciliationResult = {
  exitCode: 0 | 1;
  status:
    | "preview_ready"
    | "reconciled"
    | "already_reconciled"
    | "rejected"
    | "unavailable";
  code:
    | "PREVIEW_READY"
    | "RECONCILED"
    | "ALREADY_RECONCILED"
    | "INVALID_ARGUMENT"
    | "NOT_FOUND"
    | "NOT_RECONCILABLE"
    | "LINK_ALREADY_SET"
    | "LEDGER_INVARIANT"
    | "RECONCILIATION_UNAVAILABLE";
  jobFingerprint: string;
};

export class AnalysisFinalizationReconciliationInputError extends Error {
  readonly code = "INVALID_COMMAND";

  constructor() {
    super("INVALID_COMMAND");
  }
}

function recordFromRpc(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (Array.isArray(value) && value.length === 1) {
    return recordFromRpc(value[0]);
  }
  if (typeof value === "string") {
    try {
      return recordFromRpc(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  return null;
}

function commandError(): never {
  throw new AnalysisFinalizationReconciliationInputError();
}

export function parseAnalysisFinalizationReconciliationCommand(
  argv: string[]
): AnalysisFinalizationReconciliationCommand {
  let jobId: string | null = null;
  let confirm: string | null = null;
  let apply = false;
  let json = false;

  for (const arg of argv) {
    if (arg === "--apply") {
      if (apply) commandError();
      apply = true;
      continue;
    }
    if (arg === "--json") {
      if (json) commandError();
      json = true;
      continue;
    }
    if (arg.startsWith("--job-id=")) {
      if (jobId !== null) commandError();
      jobId = arg.slice("--job-id=".length);
      continue;
    }
    if (arg.startsWith("--confirm=")) {
      if (confirm !== null) commandError();
      confirm = arg.slice("--confirm=".length);
      continue;
    }
    commandError();
  }

  if (!jobId || !JOB_ID_PATTERN.test(jobId)) commandError();
  if (!apply && confirm !== null) commandError();
  if (apply && confirm !== `${CONFIRM_PREFIX}${jobId}`) commandError();

  return { jobId, apply, json };
}

export function analysisFinalizationReconciliationFingerprint(jobId: string): string {
  return createHash("sha256").update(jobId).digest("hex").slice(0, 16);
}

type RpcBody =
  | { ok: true; code: "PREVIEW_READY" | "RECONCILED" | "ALREADY_RECONCILED"; applied: boolean }
  | { ok: false; code: "INVALID_ARGUMENT" | "NOT_FOUND" | "NOT_RECONCILABLE" | "LINK_ALREADY_SET" | "LEDGER_INVARIANT"; applied: false };

function rpcBodyFromUnknown(value: unknown): RpcBody | null {
  const record = recordFromRpc(value);
  if (!record || typeof record.ok !== "boolean" || typeof record.applied !== "boolean") {
    return null;
  }
  if (record.ok === true) {
    if (
      (record.code === "PREVIEW_READY" ||
        record.code === "RECONCILED" ||
        record.code === "ALREADY_RECONCILED") &&
      typeof record.applied === "boolean"
    ) {
      return { ok: true, code: record.code, applied: record.applied };
    }
    return null;
  }
  if (typeof record.code === "string" && SAFE_FAILURE_CODES.has(record.code) && record.applied === false) {
    return {
      ok: false,
      code: record.code as Extract<RpcBody, { ok: false }> ["code"],
      applied: false,
    };
  }
  return null;
}

function unavailable(jobId: string): AnalysisFinalizationReconciliationResult {
  return {
    exitCode: 1,
    status: "unavailable",
    code: "RECONCILIATION_UNAVAILABLE",
    jobFingerprint: analysisFinalizationReconciliationFingerprint(jobId),
  };
}

function rejected(
  jobId: string,
  code: Extract<AnalysisFinalizationReconciliationResult["code"], "INVALID_ARGUMENT" | "NOT_FOUND" | "NOT_RECONCILABLE" | "LINK_ALREADY_SET" | "LEDGER_INVARIANT">
): AnalysisFinalizationReconciliationResult {
  return {
    exitCode: 1,
    status: "rejected",
    code,
    jobFingerprint: analysisFinalizationReconciliationFingerprint(jobId),
  };
}

async function invoke(
  client: AnalysisFinalizationReconciliationRpcClient,
  jobId: string,
  apply: boolean
): Promise<RpcBody | null> {
  try {
    const { data, error } = await client.rpc("reconcile_analysis_job_finalization", {
      p_analysis_job_id: jobId,
      p_apply: apply,
    });
    return error ? null : rpcBodyFromUnknown(data);
  } catch {
    return null;
  }
}

export async function reconcileAnalysisJobFinalization(args: {
  command: AnalysisFinalizationReconciliationCommand;
  client: AnalysisFinalizationReconciliationRpcClient;
}): Promise<AnalysisFinalizationReconciliationResult> {
  const preview = await invoke(args.client, args.command.jobId, false);
  if (!preview) return unavailable(args.command.jobId);
  if (!preview.ok) return rejected(args.command.jobId, preview.code);
  if (preview.code === "ALREADY_RECONCILED" && preview.applied === false) {
    return {
      exitCode: 0,
      status: "already_reconciled",
      code: "ALREADY_RECONCILED",
      jobFingerprint: analysisFinalizationReconciliationFingerprint(args.command.jobId),
    };
  }
  if (preview.code !== "PREVIEW_READY" || preview.applied !== false) {
    return unavailable(args.command.jobId);
  }
  if (!args.command.apply) {
    return {
      exitCode: 0,
      status: "preview_ready",
      code: "PREVIEW_READY",
      jobFingerprint: analysisFinalizationReconciliationFingerprint(args.command.jobId),
    };
  }

  const applied = await invoke(args.client, args.command.jobId, true);
  if (!applied) return unavailable(args.command.jobId);
  if (!applied.ok) return rejected(args.command.jobId, applied.code);
  if (applied.code === "RECONCILED" && applied.applied === true) {
    return {
      exitCode: 0,
      status: "reconciled",
      code: "RECONCILED",
      jobFingerprint: analysisFinalizationReconciliationFingerprint(args.command.jobId),
    };
  }
  if (applied.code === "ALREADY_RECONCILED" && applied.applied === false) {
    return {
      exitCode: 0,
      status: "already_reconciled",
      code: "ALREADY_RECONCILED",
      jobFingerprint: analysisFinalizationReconciliationFingerprint(args.command.jobId),
    };
  }
  return unavailable(args.command.jobId);
}
