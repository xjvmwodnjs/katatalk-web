import "dotenv/config";
import readline from "node:readline";
import {
  KATAGO_CONCURRENCY_PROTOCOL,
  type KatagoConcurrencyPhaseDurations,
  type KatagoConcurrencyRunnerRequest,
  type KatagoConcurrencyRunnerResponse,
} from "../server/katagoConcurrencyBenchmark.ts";
import { evaluateKatagoResultQuality } from "../server/katagoResultQualityGate.ts";
import {
  analyzeSgfKatago,
  closeSharedPersistentRootSession,
} from "../server/worker/analysisEngines/katagoEngine.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function phaseDurations(value: unknown): KatagoConcurrencyPhaseDurations {
  const phases = isPlainObject(value) ? value : null;
  return {
    totalBeforeQualityGate: numberValue(phases?.totalBeforeQualityGate),
    rootAnalysis: numberValue(phases?.rootAnalysis),
    rootStage: numberValue(phases?.rootStage),
    multiTurn: numberValue(phases?.multiTurn),
    signalPlanning: numberValue(phases?.signalPlanning),
    deepSearch: numberValue(phases?.deepSearch),
    winrateTimeline: numberValue(phases?.winrateTimeline),
  };
}

function send(response: KatagoConcurrencyRunnerResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseRequest(line: string): KatagoConcurrencyRunnerRequest | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (
      !isPlainObject(parsed) ||
      parsed.protocol !== KATAGO_CONCURRENCY_PROTOCOL ||
      (parsed.type !== "analyze" && parsed.type !== "shutdown")
    ) {
      return null;
    }
    return parsed as KatagoConcurrencyRunnerRequest;
  } catch {
    return null;
  }
}

let shuttingDown = false;

async function closeRunner(): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await closeSharedPersistentRootSession();
}

async function run(): Promise<void> {
  const input = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  send({
    protocol: KATAGO_CONCURRENCY_PROTOCOL,
    type: "ready",
    pid: process.pid,
  });

  for await (const line of input) {
    const request = parseRequest(line.trim());
    if (!request) {
      continue;
    }
    if (request.type === "shutdown") {
      break;
    }
    const startedAt = Date.now();
    try {
      const result = await analyzeSgfKatago({
        jobId: request.jobId,
        sgfContent: request.sgfContent,
        language: request.language,
        maxVisits: request.maxVisits,
        fileName: request.fileName,
      });
      const quality = evaluateKatagoResultQuality(result);
      const engine = isPlainObject(result.engine) ? result.engine : null;
      send({
        protocol: KATAGO_CONCURRENCY_PROTOCOL,
        type: "result",
        jobId: request.jobId,
        ok: true,
        durationMs: Date.now() - startedAt,
        quality: {
          ok: quality.ok,
          failureCount: quality.failureCount,
          warningCount: quality.warningCount,
          issueCodes: quality.issues.map(issue => issue.code),
        },
        phaseDurationsMs: phaseDurations(engine?.phaseDurationsMs),
        error: null,
      });
    } catch (error) {
      const message = errorMessage(error).slice(0, 2_000);
      send({
        protocol: KATAGO_CONCURRENCY_PROTOCOL,
        type: "result",
        jobId: request.jobId,
        ok: false,
        durationMs: Date.now() - startedAt,
        quality: {
          ok: false,
          failureCount: 1,
          warningCount: 0,
          issueCodes: [message.split(":", 1)[0] ?? "ANALYSIS_FAILED"],
        },
        phaseDurationsMs: phaseDurations(null),
        error: message,
      });
    }
  }

  await closeRunner();
  send({
    protocol: KATAGO_CONCURRENCY_PROTOCOL,
    type: "stopped",
    pid: process.pid,
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void closeRunner().finally(() => process.exit(1));
  });
}

void run().catch(error => {
  console.error(`[katago-concurrency-runner] ${errorMessage(error)}`);
  process.exitCode = 1;
});
