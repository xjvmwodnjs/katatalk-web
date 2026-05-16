import { describe, expect, it } from "vitest";
import { buildAnalysisConfigLogLine, buildAnalysisWorkerStartupEnvSnapshot } from "./worker/analysisWorkerLoop";

describe("analysis worker startup config logging", () => {
  it("logs normalized smoke config without exposing KataGo paths", () => {
    const env = {
      NODE_ENV: "development",
      ANALYSIS_ENGINE: "katago",
      ANALYSIS_WORKER_MODE: "external",
      KATATALK_ALLOW_MOCK_ANALYSIS: "false",
      KATAGO_MAX_VISITS: "200",
      KATAGO_MULTI_TURN_MAX: "6",
      KATAGO_DEEP_SEARCH_ENABLED: "false",
      KATAGO_WINRATE_TIMELINE_ENABLED: "false",
      KATAGO_BINARY_PATH: "C:/secret/katago.exe",
      KATAGO_CONFIG_PATH: "C:/secret/analysis.cfg",
      KATAGO_MODEL_PATH: "C:/secret/model.bin.gz",
    } as NodeJS.ProcessEnv;

    expect(buildAnalysisConfigLogLine(env)).toBe(
      "[analysis-config] engine=katago workerMode=external deepSearch=false timeline=false maxVisits=200 multiTurnMax=6"
    );
    expect(buildAnalysisConfigLogLine(env)).not.toContain("C:/secret");

    const snapshot = buildAnalysisWorkerStartupEnvSnapshot(env);
    expect(snapshot).toMatchObject({
      ANALYSIS_ENGINE: "katago",
      ANALYSIS_WORKER_MODE: "external",
      hasKATAGO_BINARY_PATH: true,
      hasKATAGO_CONFIG_PATH: true,
      hasKATAGO_MODEL_PATH: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain("C:/secret");
  });
});
