import { afterEach, describe, expect, it } from "vitest";
import { getAnalysisWorkerMode } from "./analysisWorkerMode";
import { buildAnalysisWorkerStartupEnvSnapshot } from "./worker/analysisWorkerLoop";

describe("getAnalysisWorkerMode", () => {
  const savedMode = process.env.ANALYSIS_WORKER_MODE;
  const savedNode = process.env.NODE_ENV;

  afterEach(() => {
    if (savedMode === undefined) {
      delete process.env.ANALYSIS_WORKER_MODE;
    } else {
      process.env.ANALYSIS_WORKER_MODE = savedMode;
    }
    process.env.NODE_ENV = savedNode;
  });

  it("respects ANALYSIS_WORKER_MODE=inline", () => {
    process.env.ANALYSIS_WORKER_MODE = "inline";
    expect(getAnalysisWorkerMode()).toBe("inline");
  });

  it("respects ANALYSIS_WORKER_MODE=external", () => {
    process.env.ANALYSIS_WORKER_MODE = "external";
    expect(getAnalysisWorkerMode()).toBe("external");
  });

  it("defaults to external when NODE_ENV is production and mode unset", () => {
    delete process.env.ANALYSIS_WORKER_MODE;
    process.env.NODE_ENV = "production";
    expect(getAnalysisWorkerMode()).toBe("external");
  });

  it("defaults to inline when NODE_ENV is not production and mode unset", () => {
    delete process.env.ANALYSIS_WORKER_MODE;
    process.env.NODE_ENV = "test";
    expect(getAnalysisWorkerMode()).toBe("inline");
  });
});

describe("buildAnalysisWorkerStartupEnvSnapshot", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it("logs worker env state without path or secret values", () => {
    process.env.ANALYSIS_ENGINE = "katago";
    process.env.ANALYSIS_WORKER_MODE = "external";
    process.env.KATATALK_ALLOW_MOCK_ANALYSIS = "false";
    process.env.ANALYSIS_WORKER_ID = "local-dev-worker-1";
    process.env.KATAGO_BINARY_PATH = "C:/secret/katago.exe";
    process.env.KATAGO_CONFIG_PATH = "C:/secret/analysis.cfg";
    process.env.KATAGO_MODEL_PATH = "C:/secret/model.bin.gz";

    expect(buildAnalysisWorkerStartupEnvSnapshot(process.env)).toEqual({
      ANALYSIS_ENGINE: "katago",
      ANALYSIS_WORKER_MODE: "external",
      KATATALK_ALLOW_MOCK_ANALYSIS: "false",
      ANALYSIS_WORKER_ID: "local-dev-worker-1",
      ANALYSIS_WORKER_CONCURRENCY: 1,
      hasKATAGO_BINARY_PATH: true,
      hasKATAGO_CONFIG_PATH: true,
      hasKATAGO_MODEL_PATH: true,
      KATAGO_REQUIRE_GPU_BACKEND: false,
    });
  });
});
