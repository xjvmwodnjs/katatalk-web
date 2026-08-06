import { config as loadDotenv } from "dotenv";

import {
  AnalysisFinalizationReconciliationInputError,
  parseAnalysisFinalizationReconciliationCommand,
  reconcileAnalysisJobFinalization,
} from "../server/analysisFinalizationReconciliation.ts";
import { getSupabaseAdmin } from "../server/_core/supabaseAdmin.ts";

loadDotenv({ override: false });

function printResult(result: Awaited<ReturnType<typeof reconcileAnalysisJobFinalization>>, json: boolean): void {
  const safe = {
    status: result.status,
    code: result.code,
    jobFingerprint: result.jobFingerprint,
  };
  if (json) {
    console.log(JSON.stringify(safe));
    return;
  }
  console.log(
    `[analysis-finalization-reconcile] status=${safe.status} code=${safe.code} job_sha256=${safe.jobFingerprint}`
  );
}

async function main(): Promise<void> {
  const command = parseAnalysisFinalizationReconciliationCommand(process.argv.slice(2));
  const result = await reconcileAnalysisJobFinalization({
    command,
    client: getSupabaseAdmin(),
  });
  printResult(result, command.json);
  process.exitCode = result.exitCode;
}

main().catch(error => {
  const code = error instanceof AnalysisFinalizationReconciliationInputError
    ? "INVALID_COMMAND"
    : "RECONCILIATION_UNAVAILABLE";
  console.error(`[analysis-finalization-reconcile] ${code}`);
  process.exitCode = 1;
});
