import type { AnalysisJobGetResponse } from "@shared/analysisJob";
import type {
  AnalysisJobEnqueuePayload,
  AnalysisJobInternal,
  AnalysisJobStore,
} from "./analysisJobStore.types";
import { buildMockAnalysisReport } from "./mockAnalysisResult";

const TERMINAL_TTL_MS = 60 * 60 * 1000;

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
 * In-memory job store for local dev.
 * 운영(Vercel/serverless 등)에서는 인스턴스 간 공유가 되지 않으므로 사용하면 안 된다.
 */
export class InMemoryAnalysisJobStore implements AnalysisJobStore {
  private readonly jobs = new Map<string, AnalysisJobInternal>();

  private sweepExpiredTerminalJobs() {
    const now = Date.now();
    for (const [id, job] of Array.from(this.jobs.entries())) {
      if (job.status !== "completed" && job.status !== "failed") continue;
      const t = job.terminalAt?.getTime() ?? job.updatedAt.getTime();
      if (now - t > TERMINAL_TTL_MS) {
        this.jobs.delete(id);
      }
    }
  }

  createAndEnqueueMock(args: {
    jobId: string;
    payload: AnalysisJobEnqueuePayload;
    ownerClerkSubject: string;
    ownerAppUserId: number;
    creditLedgerId: string;
    onJobFailed?: () => void | Promise<void>;
  }): void {
    this.sweepExpiredTerminalJobs();
    const now = new Date();
    const row: AnalysisJobInternal = {
      jobId: args.jobId,
      status: "queued",
      progress: 0,
      createdAt: now,
      updatedAt: now,
      ownerClerkSubject: args.ownerClerkSubject,
      ownerAppUserId: args.ownerAppUserId,
      creditLedgerId: args.creditLedgerId,
      payload: args.payload,
    };
    this.jobs.set(args.jobId, row);
    void this.runMockPipeline(args.jobId, args.onJobFailed);
  }

  getInternal(jobId: string): AnalysisJobInternal | null {
    this.sweepExpiredTerminalJobs();
    return this.jobs.get(jobId) ?? null;
  }

  toPublicGetResponse(jobId: string): AnalysisJobGetResponse | null {
    this.sweepExpiredTerminalJobs();
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

  private async runMockPipeline(
    jobId: string,
    onJobFailed?: () => void | Promise<void>
  ): Promise<void> {
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
        terminalAt: new Date(),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      this.patch(jobId, {
        status: "failed",
        progress: null,
        errorMessage: message,
        terminalAt: new Date(),
      });
      try {
        await onJobFailed?.();
      } catch (refundErr) {
        console.error("[inMemoryAnalysisJobStore] onJobFailed refund error", refundErr);
      }
    }
  }
}

/** Singleton for the Express app until DI / DB wiring exists. */
export const analysisJobStore = new InMemoryAnalysisJobStore();
