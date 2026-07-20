import { type AnalysisJobProcessingLease, failAnalysisJobAndRefundWithLease, updateAnalysisJobRow } from "../creditService";
import {
  analysisJobErrorCodeFromMessage,
  publicAnalysisJobErrorMessage,
  sanitizeAnalysisJobErrorMessage,
} from "../analysisEngineDeterminism";
import type { AnalysisWorkerJobOutcome } from "./analysisJobOutcome";

/**
 * Finalize a failed analysis without ever falling back from the atomic Worker
 * RPC to the legacy split state/refund calls.
 *
 * Lease-less execution exists only for the local inline mock pipeline. The
 * production external Worker must always supply a claimed lease.
 */
export async function finalizeAnalysisJobFailure(args: {
  jobId: string;
  rawError: string;
  lease?: AnalysisJobProcessingLease | null;
  onLegacyJobFailed?: () => void | Promise<void>;
  logPrefix: string;
}): Promise<Extract<AnalysisWorkerJobOutcome, "failed" | "lease_lost">> {
  const diagnostic = sanitizeAnalysisJobErrorMessage(args.rawError);
  const errorCode = analysisJobErrorCodeFromMessage(diagnostic);
  const errorMessage = publicAnalysisJobErrorMessage(errorCode);

  console.error(`[${args.logPrefix}] analysis execution failed`, {
    jobId: args.jobId,
    code: errorCode,
    diagnostic,
  });

  if (args.lease) {
    try {
      const result = await failAnalysisJobAndRefundWithLease({
        jobId: args.jobId,
        lease: args.lease,
        errorCode,
        errorMessage,
      });
      if (!result.ok) {
        console.error(`[${args.logPrefix}] atomic failure finalization declined`, {
          jobId: args.jobId,
          code: result.code,
        });
        return "lease_lost";
      }
      if (result.duplicate) {
        console.warn(`[${args.logPrefix}] atomic failure finalization replayed`, {
          jobId: args.jobId,
          code: result.code,
        });
      }
      return "failed";
    } catch (error) {
      console.error(`[${args.logPrefix}] atomic failure finalization unconfirmed`, {
        jobId: args.jobId,
        code: "ATOMIC_FAILURE_UNCONFIRMED",
        error: error instanceof Error ? error.message : String(error),
      });
      return "lease_lost";
    }
  }

  // Development-only inline mock compatibility. Persist failure first and do
  // not refund when that write is uncertain, avoiding running + refunded.
  try {
    await updateAnalysisJobRow(args.jobId, {
      status: "failed",
      progress: null,
      result: null,
      error_message: errorMessage,
      last_error_code: errorCode,
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      next_retry_at: null,
    });
  } catch (error) {
    console.error(`[${args.logPrefix}] failed to persist inline failure state`, {
      jobId: args.jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "lease_lost";
  }

  try {
    await args.onLegacyJobFailed?.();
  } catch (error) {
    console.error(`[${args.logPrefix}] inline failure refund error`, {
      jobId: args.jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return "failed";
}
