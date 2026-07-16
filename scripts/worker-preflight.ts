import { config as loadDotenv } from "dotenv";

loadDotenv({ override: false });

async function main(): Promise<void> {
  const [{ validateServerEnv }, { runAnalysisWorkerPreflight }] = await Promise.all([
    import("../server/_core/env"),
    import("../server/worker/analysisWorkerPreflight"),
  ]);
  validateServerEnv();
  const report = await runAnalysisWorkerPreflight(process.env);
  console.log(
    `[worker-preflight] pass engine=${report.engine} katagoBackend=${report.katagoBackend ?? "n/a"} requireGpuBackend=${String(report.requireGpuBackend)} winratePerspective=${report.winratePerspective ?? "n/a"}`
  );
}

main().catch(error => {
  console.error(`[worker-preflight] fail ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});