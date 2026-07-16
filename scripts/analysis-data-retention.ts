import { config as loadDotenv } from "dotenv";

loadDotenv({ override: false });

function readLimit(): number {
  const raw = process.env.ANALYSIS_DATA_RETENTION_BATCH_SIZE?.trim() ?? "100";
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new Error("ANALYSIS_DATA_RETENTION_BATCH_SIZE must be an integer from 1 to 500.");
  }
  return value;
}

async function main(): Promise<void> {
  const { purgeExpiredAnalysisJobData } = await import("../server/creditService");
  const dryRun = process.argv.slice(2).includes("--apply") === false;
  const rows = await purgeExpiredAnalysisJobData({ limit: readLimit(), dryRun });
  console.log(`[analysis-data-retention] mode=${dryRun ? "dry-run" : "apply"} eligible=${rows.length} purged=${rows.filter(row => row.purged).length}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
