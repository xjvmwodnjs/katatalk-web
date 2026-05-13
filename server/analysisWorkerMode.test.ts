import { afterEach, describe, expect, it } from "vitest";
import { getAnalysisWorkerMode } from "./analysisWorkerMode";

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
