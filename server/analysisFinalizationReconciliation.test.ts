import { describe, expect, it } from "vitest";

import {
  AnalysisFinalizationReconciliationInputError,
  analysisFinalizationReconciliationFingerprint,
  parseAnalysisFinalizationReconciliationCommand,
  reconcileAnalysisJobFinalization,
} from "./analysisFinalizationReconciliation";

describe("analysis finalization reconciliation command", () => {
  it("defaults to a single-job preview and keeps the raw id out of its fingerprint", () => {
    const command = parseAnalysisFinalizationReconciliationCommand([
      "--job-id=quarantine-job-1",
    ]);
    expect(command).toEqual({ jobId: "quarantine-job-1", apply: false, json: false });
    expect(analysisFinalizationReconciliationFingerprint(command.jobId)).toMatch(/^[a-f0-9]{16}$/);
  });

  it("requires an exact one-time confirmation for apply", () => {
    expect(() => parseAnalysisFinalizationReconciliationCommand([
      "--job-id=quarantine-job-1",
      "--apply",
    ])).toThrow(AnalysisFinalizationReconciliationInputError);
    expect(() => parseAnalysisFinalizationReconciliationCommand([
      "--job-id=quarantine-job-1",
      "--apply",
      "--confirm=RECONCILE_FINALIZATION:another-job",
    ])).toThrow(AnalysisFinalizationReconciliationInputError);
    expect(parseAnalysisFinalizationReconciliationCommand([
      "--job-id=quarantine-job-1",
      "--apply",
      "--confirm=RECONCILE_FINALIZATION:quarantine-job-1",
      "--json",
    ])).toMatchObject({ apply: true, json: true });
  });

  it("rejects duplicate, unknown, and unsafe arguments", () => {
    for (const argv of [
      ["--job-id=a", "--job-id=b"],
      ["--job-id=a", "--json", "--json"],
      ["--job-id=a", "--all"],
      ["--job-id=has space"],
      ["--confirm=RECONCILE_FINALIZATION:a", "--job-id=a"],
    ]) {
      expect(() => parseAnalysisFinalizationReconciliationCommand(argv)).toThrow(
        AnalysisFinalizationReconciliationInputError
      );
    }
  });

  it("runs preview before a confirmed apply and redacts backend failures", async () => {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
    const result = await reconcileAnalysisJobFinalization({
      command: parseAnalysisFinalizationReconciliationCommand([
        "--job-id=quarantine-job-1",
        "--apply",
        "--confirm=RECONCILE_FINALIZATION:quarantine-job-1",
      ]),
      client: {
        rpc: async (name, params) => {
          calls.push({ name, params });
          return {
            data: params.p_apply
              ? { ok: true, code: "RECONCILED", applied: true }
              : { ok: true, code: "PREVIEW_READY", applied: false },
            error: null,
          };
        },
      },
    });

    expect(calls.map(call => call.params.p_apply)).toEqual([false, true]);
    expect(result).toMatchObject({ exitCode: 0, status: "reconciled", code: "RECONCILED" });

    const unavailable = await reconcileAnalysisJobFinalization({
      command: parseAnalysisFinalizationReconciliationCommand(["--job-id=quarantine-job-2"]),
      client: { rpc: async () => ({ data: null, error: { message: "private backend detail" } }) },
    });
    expect(unavailable).toMatchObject({ exitCode: 1, code: "RECONCILIATION_UNAVAILABLE" });
    expect(JSON.stringify(unavailable)).not.toContain("private backend detail");
  });

  it("fails closed for malformed and rejected database replies", async () => {
    const command = parseAnalysisFinalizationReconciliationCommand(["--job-id=quarantine-job-3"]);
    const malformed = await reconcileAnalysisJobFinalization({
      command,
      client: { rpc: async () => ({ data: { ok: true, code: "PREVIEW_READY" }, error: null }) },
    });
    expect(malformed.code).toBe("RECONCILIATION_UNAVAILABLE");

    const rejected = await reconcileAnalysisJobFinalization({
      command,
      client: {
        rpc: async () => ({
          data: { ok: false, code: "LEDGER_INVARIANT", applied: false },
          error: null,
        }),
      },
    });
    expect(rejected).toMatchObject({ exitCode: 1, status: "rejected", code: "LEDGER_INVARIANT" });
  });
});
