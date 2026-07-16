import { describe, expect, it } from "vitest";
import type { AnalysisJobDbRow } from "./creditService";
import {
  assertAnalysisWorkerConcurrencyConfig,
  buildAnalysisConfigLogLine,
  buildAnalysisWorkerStartupEnvSnapshot,
  readAnalysisWorkerConcurrencyFrom,
  runBoundedAnalysisWorkerLoop,
} from "./worker/analysisWorkerLoop";

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
      "[analysis-config] engine=katago workerMode=external concurrency=1 deepSearch=false timeline=false maxVisits=200 multiTurnMax=6"
    );
    expect(buildAnalysisConfigLogLine(env)).not.toContain("C:/secret");

    const snapshot = buildAnalysisWorkerStartupEnvSnapshot(env);
    expect(snapshot).toMatchObject({
      ANALYSIS_ENGINE: "katago",
      ANALYSIS_WORKER_MODE: "external",
      ANALYSIS_WORKER_CONCURRENCY: 1,
      hasKATAGO_BINARY_PATH: true,
      hasKATAGO_CONFIG_PATH: true,
      hasKATAGO_MODEL_PATH: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain("C:/secret");
  });

  it("parses a bounded worker concurrency", () => {
    expect(readAnalysisWorkerConcurrencyFrom({})).toBe(1);
    expect(
      readAnalysisWorkerConcurrencyFrom({ ANALYSIS_WORKER_CONCURRENCY: "3" })
    ).toBe(3);
    expect(
      readAnalysisWorkerConcurrencyFrom({ ANALYSIS_WORKER_CONCURRENCY: "99" })
    ).toBe(4);
    expect(
      readAnalysisWorkerConcurrencyFrom({
        ANALYSIS_WORKER_CONCURRENCY: "2jobs",
      })
    ).toBe(1);
  });

  it("rejects unsafe KataGo concurrency and accepts the shared-session profile", () => {
    expect(() =>
      assertAnalysisWorkerConcurrencyConfig({
        ANALYSIS_ENGINE: "katago",
        ANALYSIS_WORKER_CONCURRENCY: "2",
      })
    ).toThrow(/ANALYSIS_WORKER_CONCURRENCY_UNSAFE/);

    expect(() =>
      assertAnalysisWorkerConcurrencyConfig({
        ANALYSIS_ENGINE: "katago",
        ANALYSIS_WORKER_CONCURRENCY: "4",
        KATAGO_PERSISTENT_ROOT_ENABLED: "true",
        KATAGO_PERSISTENT_ROOT_STRICT: "true",
        KATAGO_PERSISTENT_MULTI_TURN_ENABLED: "true",
        KATAGO_PERSISTENT_MULTI_TURN_STRICT: "true",
        KATAGO_PERSISTENT_MULTI_TURN_PER_JOB_CONCURRENCY: "1",
        KATAGO_DEEP_SEARCH_ENABLED: "false",
        KATAGO_WINRATE_TIMELINE_ENABLED: "false",
      })
    ).not.toThrow();
  });
});

describe("runBoundedAnalysisWorkerLoop", () => {
  const job = (id: string) => ({ id }) as AnalysisJobDbRow;

  it("never exceeds the configured slots and drains all claimed jobs", async () => {
    const queue = [job("1"), job("2"), job("3"), job("4"), job("5")];
    const controller = new AbortController();
    const processed: string[] = [];
    let active = 0;
    let maxActive = 0;

    await runBoundedAnalysisWorkerLoop({
      concurrency: 2,
      signal: controller.signal,
      idleMs: 1,
      claimNext: async () => queue.shift() ?? null,
      processJob: async claimed => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active -= 1;
        processed.push(claimed.id);
        if (processed.length === 5) {
          controller.abort();
        }
      },
    });

    expect(maxActive).toBe(2);
    expect(processed.sort()).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("waits for an in-flight job after shutdown stops new claims", async () => {
    const controller = new AbortController();
    let release!: () => void;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    let started!: () => void;
    const didStart = new Promise<void>(resolve => {
      started = resolve;
    });
    let claimed = false;
    let settled = false;

    const running = runBoundedAnalysisWorkerLoop({
      concurrency: 2,
      signal: controller.signal,
      idleMs: 1,
      claimNext: async () => {
        if (claimed) {
          return null;
        }
        claimed = true;
        return job("held");
      },
      processJob: async () => {
        started();
        await held;
      },
    }).finally(() => {
      settled = true;
    });

    await didStart;
    controller.abort();
    await new Promise(resolve => setTimeout(resolve, 1));
    expect(settled).toBe(false);
    release();
    await running;
    expect(settled).toBe(true);
  });

  it("isolates a synchronous job failure and continues claiming", async () => {
    const queue = [job("bad"), job("good")];
    const controller = new AbortController();
    const errors: string[] = [];
    const processed: string[] = [];

    await runBoundedAnalysisWorkerLoop({
      concurrency: 1,
      signal: controller.signal,
      idleMs: 1,
      claimNext: async () => queue.shift() ?? null,
      processJob: claimed => {
        if (claimed.id === "bad") {
          throw new Error("sync failure");
        }
        processed.push(claimed.id);
        controller.abort();
        return Promise.resolve();
      },
      onJobError: (claimed, error) => {
        errors.push(
          `${claimed.id}:${error instanceof Error ? error.message : String(error)}`
        );
      },
    });

    expect(errors).toEqual(["bad:sync failure"]);
    expect(processed).toEqual(["good"]);
  });
});
