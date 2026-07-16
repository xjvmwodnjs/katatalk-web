import { statSync } from "node:fs";
import {
  assertKatagoPathsConfiguredOrThrow,
  assertKatagoWinratePerspectiveConfig,
} from "./analysisEngines";
import { assertAnalysisWorkerConcurrencyConfig } from "./analysisWorkerLoop";
import {
  assertKatagoGpuBackendRequirementV1,
  detectKatagoBackendV1,
  readKatagoRequireGpuBackendFrom,
  type KatagoBackendV1,
} from "./katagoBackendDetectionV1";

export type AnalysisWorkerPreflightReport = {
  engine: "mock" | "katago";
  katagoBackend: KatagoBackendV1 | null;
  requireGpuBackend: boolean;
  winratePerspective: "black" | "white" | "side_to_move" | null;
};

function readEngine(env: NodeJS.ProcessEnv): "mock" | "katago" {
  return env.ANALYSIS_ENGINE?.trim().toLowerCase() === "katago" ? "katago" : "mock";
}

export function assertKatagoRuntimePathsReadableOrThrow(env: NodeJS.ProcessEnv): void {
  assertKatagoPathsConfiguredOrThrow(env);
  for (const name of ["KATAGO_BINARY_PATH", "KATAGO_CONFIG_PATH", "KATAGO_MODEL_PATH"] as const) {
    const path = env[name]?.trim();
    try {
      if (!path || !statSync(path).isFile()) {
        throw new Error("not a file");
      }
    } catch {
      throw new Error(`KATAGO_RUNTIME_PATH_INVALID: ${name} must reference a readable file.`);
    }
  }
}

export async function runAnalysisWorkerPreflight(
  env: NodeJS.ProcessEnv = process.env
): Promise<AnalysisWorkerPreflightReport> {
  assertAnalysisWorkerConcurrencyConfig(env);
  const engine = readEngine(env);
  const requireGpuBackend = readKatagoRequireGpuBackendFrom(env);
  if (engine === "mock") {
    return { engine, katagoBackend: null, requireGpuBackend, winratePerspective: null };
  }

  assertKatagoRuntimePathsReadableOrThrow(env);
  const winratePerspective = assertKatagoWinratePerspectiveConfig(env);
  const backend = await detectKatagoBackendV1({ env });
  if (!backend.ok) {
    throw new Error(
      `KATAGO_BACKEND_CHECK_FAILED: backend=${backend.backend} timedOut=${String(backend.timedOut)}`
    );
  }
  assertKatagoGpuBackendRequirementV1(backend, env);
  return {
    engine,
    katagoBackend: backend.backend,
    requireGpuBackend,
    winratePerspective,
  };
}