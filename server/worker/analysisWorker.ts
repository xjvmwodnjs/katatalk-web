import { config as loadDotenv } from "dotenv";

loadDotenv({ override: process.env.NODE_ENV !== "production" });

void import("./analysisWorkerLoop")
  .then(({ startAnalysisWorkerMain }) => startAnalysisWorkerMain())
  .catch(err => {
    console.error("[analysis-worker] fatal", err);
    process.exit(1);
  });
