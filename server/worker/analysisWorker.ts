import { config as loadDotenv } from "dotenv";

// Explicit shell/service env must win over .env during local smoke runs.
loadDotenv({ override: false });

void import("./analysisWorkerLoop")
  .then(({ startAnalysisWorkerMain }) => startAnalysisWorkerMain())
  .catch(err => {
    console.error("[analysis-worker] fatal", err);
    process.exit(1);
  });
