import { nanoid } from "nanoid";
import type { AnalysisJobGetResponse } from "@shared/analysisJob";
import type {
  AnalysisJobEnqueuePayload,
  AnalysisJobInternal,
  AnalysisJobStore,
} from "./analysisJobStore.types";
import { buildMockAnalysisReport } from "./mockAnalysisResult";

function toIso(d: Date): string {
  return d.toISOString();
}

function toPublicRow(job: AnalysisJobInternal): AnalysisJobGetResponse {
  const base = {
    success: true as const,
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    createdAt: toIso(job.createdAt),
    updatedAt: toIso(job.updatedAt),
  };

  if (job.status === "failed") {
    return {
      ...base,
      error: { message: job.errorMessage ?? "Analysis failed." },
    };
  }

  if (job.status === "completed" && job.resultData !== undefined) {
    return {
      ...base,
      data: job.resultData,
      meta: job.meta,
    };
  }

  return base;
}

/**
 * In-memory job store for local dev. Replace with DB + queue implementation
 * that satisfies `AnalysisJobStore` (or a superset with enqueue-only API).
 */
export class InMemoryAnalysisJobStore implements AnalysisJobStore {
  private readonly jobs = new Map<string, AnalysisJobInternal>();

  createAndEnqueueMock(payload: AnalysisJobEnqueuePayload): string {
    const jobId = nanoid();
    const now = new Date();
    const row: AnalysisJobInternal = {
      jobId,
      status: "queued",
      progress: 0,
      createdAt: now,
      updatedAt: now,
      payload,
    };
    this.jobs.set(jobId, row);
    void this.runMockPipeline(jobId);
    return jobId;
  }

  toPublicGetResponse(jobId: string): AnalysisJobGetResponse | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return toPublicRow(job);
  }

  private patch(jobId: string, patch: Partial<AnalysisJobInternal>) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const next = { ...job, ...patch, updatedAt: new Date() };
    this.jobs.set(jobId, next);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Simulates queued → running → completed with staged progress.
   * TODO(KataGo worker): Replace this method with a consumer that:
   * 1. Marks job running in DB.
   * 2. Runs KataGo / parsing on `payload.sgfContent`, updates progress.
   * 3. Writes `resultData` + meta, sets status completed (or failed on error).
   */
  private async runMockPipeline(jobId: string): Promise<void> {
    try {
      await this.sleep(350);
      this.patch(jobId, { status: "running", progress: 25 });

      await this.sleep(450);
      this.patch(jobId, { status: "running", progress: 55 });

      await this.sleep(400);
      this.patch(jobId, { status: "running", progress: 85 });

      await this.sleep(300);

      const job = this.jobs.get(jobId);
      if (!job) return;

      const data = buildMockAnalysisReport(job.payload);
      this.patch(jobId, {
        status: "completed",
        progress: 100,
        resultData: data,
        meta: {
          mock: true,
          message:
            "Mock analysis job finished. SGF was validated at enqueue; KataGo not used.",
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      this.patch(jobId, {
        status: "failed",
        progress: null,
        errorMessage: message,
      });
    }
  }
}

/** Singleton for the Express app until DI / DB wiring exists. */
export const analysisJobStore = new InMemoryAnalysisJobStore();
