import { afterEach, describe, expect, it } from "vitest";
import { analyzeSgfKatagoStub, analyzeSgfMock, assertKatagoPathsConfiguredOrThrow, getAnalysisEngineName } from "./worker/analysisEngines";

describe("analysis engines config", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env.ANALYSIS_ENGINE = saved.ANALYSIS_ENGINE;
    process.env.KATAGO_BINARY_PATH = saved.KATAGO_BINARY_PATH;
    process.env.KATAGO_CONFIG_PATH = saved.KATAGO_CONFIG_PATH;
    process.env.KATAGO_MODEL_PATH = saved.KATAGO_MODEL_PATH;
  });

  it("defaults ANALYSIS_ENGINE to mock", () => {
    delete process.env.ANALYSIS_ENGINE;
    expect(getAnalysisEngineName()).toBe("mock");
  });

  it("respects ANALYSIS_ENGINE=katago", () => {
    process.env.ANALYSIS_ENGINE = "katago";
    expect(getAnalysisEngineName()).toBe("katago");
  });

  it("assertKatagoPathsConfiguredOrThrow fails when paths missing", () => {
    process.env.ANALYSIS_ENGINE = "katago";
    delete process.env.KATAGO_BINARY_PATH;
    delete process.env.KATAGO_CONFIG_PATH;
    delete process.env.KATAGO_MODEL_PATH;
    expect(() => assertKatagoPathsConfiguredOrThrow()).toThrow(/KATAGO/);
  });

  it("assertKatagoPathsConfiguredOrThrow passes when paths set", () => {
    process.env.KATAGO_BINARY_PATH = "/bin/katago";
    process.env.KATAGO_CONFIG_PATH = "/cfg.cfg";
    process.env.KATAGO_MODEL_PATH = "/model.bin.gz";
    expect(() => assertKatagoPathsConfiguredOrThrow()).not.toThrow();
  });
});

describe("analyzeSgfMock", () => {
  it("returns mock-shaped result", async () => {
    const r = await analyzeSgfMock({
      jobId: "j1",
      sgfContent: null,
      language: "ko",
      maxVisits: 50,
      fileName: "f.sgf",
    });
    expect((r as { source?: { mock?: boolean } }).source?.mock).toBe(true);
  });
});

describe("analyzeSgfKatagoStub", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env.KATAGO_BINARY_PATH = saved.KATAGO_BINARY_PATH;
    process.env.KATAGO_CONFIG_PATH = saved.KATAGO_CONFIG_PATH;
    process.env.KATAGO_MODEL_PATH = saved.KATAGO_MODEL_PATH;
  });

  it("throws KATAGO_ENV_MISSING when paths unset", async () => {
    delete process.env.KATAGO_BINARY_PATH;
    await expect(
      analyzeSgfKatagoStub({
        jobId: "j",
        sgfContent: "(;FF[4]GM[1]SZ[19])",
        language: "ko",
        maxVisits: 1,
        fileName: "x.sgf",
      })
    ).rejects.toThrow(/KATAGO_ENV_MISSING/);
  });

  it("throws KATAGO_NOT_IMPLEMENTED when paths set", async () => {
    process.env.KATAGO_BINARY_PATH = "/x/katago";
    process.env.KATAGO_CONFIG_PATH = "/x/cfg";
    process.env.KATAGO_MODEL_PATH = "/x/model";
    await expect(
      analyzeSgfKatagoStub({
        jobId: "j",
        sgfContent: "(;FF[4]GM[1]SZ[19])",
        language: "ko",
        maxVisits: 1,
        fileName: "x.sgf",
      })
    ).rejects.toThrow(/KATAGO_NOT_IMPLEMENTED|katago:smoke/);
  });
});
