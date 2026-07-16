import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertKatagoRuntimePathsReadableOrThrow } from "./analysisWorkerPreflight";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function validKatagoEnv(): NodeJS.ProcessEnv {
  const directory = mkdtempSync(path.join(os.tmpdir(), "katatalk-worker-preflight-"));
  temporaryDirectories.push(directory);
  const binary = path.join(directory, "katago");
  const config = path.join(directory, "analysis.cfg");
  const model = path.join(directory, "model.bin.gz");
  writeFileSync(binary, "binary");
  writeFileSync(config, "reportAnalysisWinratesAs = BLACK\n");
  writeFileSync(model, "model");
  return {
    ANALYSIS_ENGINE: "katago",
    KATAGO_BINARY_PATH: binary,
    KATAGO_CONFIG_PATH: config,
    KATAGO_MODEL_PATH: model,
  };
}

describe("assertKatagoRuntimePathsReadableOrThrow", () => {
  it("accepts configured regular files", () => {
    expect(() => assertKatagoRuntimePathsReadableOrThrow(validKatagoEnv())).not.toThrow();
  });

  it.each(["KATAGO_BINARY_PATH", "KATAGO_CONFIG_PATH", "KATAGO_MODEL_PATH"] as const)(
    "rejects missing %s",
    name => {
      const env = validKatagoEnv();
      env[name] = "";
      expect(() => assertKatagoRuntimePathsReadableOrThrow(env)).toThrow(name);
    }
  );

  it("rejects a directory configured as the model path", () => {
    const env = validKatagoEnv();
    const directory = path.join(path.dirname(env.KATAGO_MODEL_PATH!), "not-a-model");
    mkdirSync(directory);
    env.KATAGO_MODEL_PATH = directory;
    expect(() => assertKatagoRuntimePathsReadableOrThrow(env)).toThrow("KATAGO_MODEL_PATH");
  });
});