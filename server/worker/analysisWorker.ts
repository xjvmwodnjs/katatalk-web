import "dotenv/config";
import { startAnalysisWorkerMain } from "./analysisWorkerLoop";

startAnalysisWorkerMain().catch(err => {
  console.error("[analysis-worker] fatal", err);
  process.exit(1);
});
