/**
 * Vitest 전역 설정 — 서버 모듈이 로드되기 전에 최소 env 를 채우고 Supabase Admin 을 모킹한다.
 */
import { vi } from "vitest";

/** 기본: Vitest(NODE_ENV=test)에서만 VITEST_RATE_LIMIT_OFF 로 rate limit 우회. production 에서는 무시됨. */
if (process.env.VITEST_RATE_LIMIT_OFF === undefined) {
  process.env.VITEST_RATE_LIMIT_OFF = "true";
}

if (!process.env.JWT_SECRET?.trim()) {
  process.env.JWT_SECRET = "vitest-jwt-secret-minimum-32-characters-long-x";
}

if (!process.env.SUPABASE_URL?.trim()) {
  process.env.SUPABASE_URL = "https://vitest-placeholder.supabase.co";
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "vitest-service-role-placeholder-not-real";
}

if (!process.env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim()) {
  process.env.LEMONSQUEEZY_WEBHOOK_SECRET = "vitest-lemon-webhook-secret-32chars___";
}

if (!process.env.LEMONSQUEEZY_API_KEY?.trim()) {
  process.env.LEMONSQUEEZY_API_KEY = "vitest-lemon-api-key-placeholder";
}
if (!process.env.LEMONSQUEEZY_STORE_ID?.trim()) {
  process.env.LEMONSQUEEZY_STORE_ID = "999";
}
if (!process.env.LEMONSQUEEZY_CREDIT_PACK_STARTER_VARIANT_ID?.trim()) {
  process.env.LEMONSQUEEZY_CREDIT_PACK_STARTER_VARIANT_ID = "vitest-variant-starter";
}
if (!process.env.LEMONSQUEEZY_CREDIT_PACK_STANDARD_VARIANT_ID?.trim()) {
  process.env.LEMONSQUEEZY_CREDIT_PACK_STANDARD_VARIANT_ID = "vitest-variant-standard";
}
if (!process.env.LEMONSQUEEZY_CREDIT_PACK_PRO_VARIANT_ID?.trim()) {
  process.env.LEMONSQUEEZY_CREDIT_PACK_PRO_VARIANT_ID = "vitest-variant-pro";
}

function isoNow() {
  return new Date().toISOString();
}

/** Vitest 전용 in-memory analysis_jobs (실제 Supabase 대체) */
export const vitestAnalysisJobsStore = new Map<string, Record<string, unknown>>();
/** 원자 실패 RPC가 생성한 refund ledger를 job id 기준으로 추적하는 테스트 대역. */
export const vitestAnalysisRefundedJobsStore = new Set<string>();
/** 응답 유실 재시도 fixture용 RPC 호출 횟수. */
export const vitestAtomicFailureRpcCalls = new Map<string, number>();
/** Max-attempt atomic finalization declines quarantined for reconciliation. */
export const vitestAnalysisFinalizationFailuresStore = new Map<
  string,
  {
    leaseWorkerId: string | null;
    leaseAttemptCount: number;
    failureCode: string;
    occurrenceCount: number;
    resolved: boolean;
  }
>();

function resolveVitestAnalysisFinalizationFailure(jobId: string): void {
  const existing = vitestAnalysisFinalizationFailuresStore.get(jobId);
  if (existing) {
    vitestAnalysisFinalizationFailuresStore.set(jobId, { ...existing, resolved: true });
  }
}

/** HTTP 테스트 등에서 DB 행을 직접 넣을 때 사용 */
export function vitestSeedAnalysisJob(row: Record<string, unknown>) {
  const id = row.id as string;
  vitestAnalysisRefundedJobsStore.delete(id);
  vitestAtomicFailureRpcCalls.delete(id);
  vitestAnalysisFinalizationFailuresStore.delete(id);
  vitestAnalysisJobsStore.set(id, {
    created_at: isoNow(),
    updated_at: isoNow(),
    progress: row.progress ?? 0,
    ...row,
  });
}

function analysisJobsTableBuilder() {
  return {
    select(_cols?: string) {
      return {
        eq(col: string, val: string) {
          return {
            maybeSingle() {
              const row = vitestAnalysisJobsStore.get(val) ?? null;
              return Promise.resolve({ data: row, error: null });
            },
          };
        },
      };
    },
    insert(row: Record<string, unknown>) {
      const id = row.id as string;
      vitestAnalysisJobsStore.set(id, {
        ...row,
        created_at: (row.created_at as string) ?? isoNow(),
        updated_at: (row.updated_at as string) ?? isoNow(),
        progress: row.progress ?? 0,
      });
      return Promise.resolve({ error: null });
    },
    update(patch: Record<string, unknown>) {
      const filters: Array<{ kind: "eq" | "in" | "is"; col: string; val: unknown }> = [];
      function rowMatches(existing: Record<string, unknown>): boolean {
        for (const f of filters) {
          const cur = existing[f.col];
          if (f.kind === "in") {
            if (!Array.isArray(f.val) || !f.val.includes(cur)) return false;
          } else if (f.kind === "is") {
            if ((cur ?? null) !== f.val) return false;
          } else if (f.col === "attempt_count") {
            if (Number(cur) !== Number(f.val)) return false;
          } else if (cur !== f.val) {
            return false;
          }
        }
        return true;
      }
      function runUpdate(leaseSelectMode: boolean): { data?: unknown[]; error: null } {
        const idFilter = filters.find(f => f.col === "id");
        const id = idFilter?.val != null ? String(idFilter.val) : "";
        const existing = id ? vitestAnalysisJobsStore.get(id) : undefined;
        if (!existing) {
          return leaseSelectMode ? { data: [], error: null } : { error: null };
        }
        const ex = existing as Record<string, unknown>;
        if (filters.length === 1 && filters[0].kind === "eq" && filters[0].col === "id") {
          Object.assign(existing, patch, { updated_at: isoNow() });
          return leaseSelectMode ? { data: [{ id }], error: null } : { error: null };
        }
        if (!rowMatches(ex)) {
          return leaseSelectMode ? { data: [], error: null } : { error: null };
        }
        Object.assign(existing, patch, { updated_at: isoNow() });
        return leaseSelectMode ? { data: [{ id }], error: null } : { error: null };
      }
      const tail = {
        eq(col: string, val: unknown) {
          filters.push({ kind: "eq", col, val });
          return tail;
        },
        in(col: string, values: unknown[]) {
          filters.push({ kind: "in", col, val: values });
          return tail;
        },
        is(col: string, val: unknown) {
          filters.push({ kind: "is", col, val });
          return tail;
        },
        select() {
          return Promise.resolve(runUpdate(true));
        },
        then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
          return Promise.resolve(runUpdate(false)).then(onFulfilled, onRejected);
        },
      };
      return {
        eq(col: string, val: unknown) {
          filters.push({ kind: "eq", col, val });
          return tail;
        },
      };
    },
  };
}

function legacyQueryBuilder(table: string) {
  const builder: Record<string, unknown> = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return Promise.resolve({
        data: table === "credit_logs" ? [] : [],
        error: null,
      });
    },
    maybeSingle() {
      if (table === "profiles") {
        return Promise.resolve({ data: { credits: 2 }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    insert() {
      return Promise.resolve({ error: null });
    },
  };
  return builder;
}

function simulatedPublicAnalysisErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case "KATAGO_TIMEOUT":
      return "Analysis timed out. Please try again.";
    case "SGF_PARSE_FAILED":
    case "KATAGO_QUERY_BUILD_FAILED":
      return "The game record could not be analyzed.";
    default:
      return "Analysis failed. Please try again.";
  }
}

function simulateFailAnalysisJobAndRefundRpc(args?: Record<string, unknown>): {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
} {
  const jobId = String(args?.p_analysis_job_id ?? "");
  const callCount = (vitestAtomicFailureRpcCalls.get(jobId) ?? 0) + 1;
  vitestAtomicFailureRpcCalls.set(jobId, callCount);
  if (jobId === "atomic-failure-rpc-error") {
    return {
      data: null,
      error: { message: "atomic failure RPC simulated outage" },
    };
  }
  if (jobId === "atomic-failure-response-lost" && callCount === 1) {
    const row = vitestAnalysisJobsStore.get(jobId);
    if (row) {
      const cost = Number(row.credit_cost ?? 0);
      const errorCode = String(args?.p_error_code ?? "ANALYSIS_FAILED");
      if (cost > 0) vitestAnalysisRefundedJobsStore.add(jobId);
      Object.assign(row, {
        status: "failed",
        progress: null,
        result: null,
        error_message: simulatedPublicAnalysisErrorMessage(errorCode),
        last_error_code: errorCode,
        completed_at: isoNow(),
        locked_at: null,
        locked_by: null,
        next_retry_at: null,
        failure_worker_id: args?.p_locked_by,
        failure_attempt_count: args?.p_attempt_count,
        updated_at: isoNow(),
      });
      resolveVitestAnalysisFinalizationFailure(jobId);
    }
    return { data: null, error: { message: "response lost after commit" } };
  }

  const workerId = String(args?.p_locked_by ?? "").trim();
  const attemptCount = Number(args?.p_attempt_count);
  if (!workerId || !Number.isInteger(attemptCount) || attemptCount < 1) {
    return {
      data: {
        ok: false,
        code: "INVALID_ARGUMENT",
        duplicate: false,
        refunded: false,
      },
      error: null,
    };
  }
  const row = vitestAnalysisJobsStore.get(jobId);
  if (!row) {
    return {
      data: { ok: false, code: "NOT_FOUND", duplicate: false, refunded: false },
      error: null,
    };
  }
  const cost = Number(row.credit_cost ?? 0);

  if (row.status === "failed") {
    const sameFinalizer = row.failure_worker_id === workerId && Number(row.failure_attempt_count) === attemptCount;
    if (!sameFinalizer) {
      return {
        data: {
          ok: false,
          code: "ALREADY_FAILED",
          duplicate: false,
          refunded: false,
        },
        error: null,
      };
    }
    if (cost > 0 && !vitestAnalysisRefundedJobsStore.has(jobId)) {
      return {
        data: {
          ok: false,
          code: "LEDGER_INVARIANT",
          duplicate: true,
          refunded: false,
        },
        error: null,
      };
    }
    return {
      data: {
        ok: true,
        code: "ALREADY_FAILED",
        duplicate: true,
        refunded: cost > 0,
        credits: 10,
      },
      error: null,
    };
  }
  if (row.status === "completed") {
    return {
      data: {
        ok: false,
        code: "ALREADY_COMPLETED",
        duplicate: false,
        refunded: false,
      },
      error: null,
    };
  }
  if (row.status !== "running") {
    return {
      data: {
        ok: false,
        code: "INVALID_STATE",
        duplicate: false,
        refunded: false,
      },
      error: null,
    };
  }
  if (row.locked_by !== workerId || Number(row.attempt_count) !== attemptCount) {
    return {
      data: {
        ok: false,
        code: "LEASE_LOST",
        duplicate: false,
        refunded: false,
      },
      error: null,
    };
  }
  if (cost < 0 || (cost > 0 && !row.credit_log_id)) {
    return {
      data: {
        ok: false,
        code: "LEDGER_INVARIANT",
        duplicate: false,
        refunded: false,
      },
      error: null,
    };
  }

  const refundPreexisting = vitestAnalysisRefundedJobsStore.has(jobId);
  const errorCode = String(args?.p_error_code ?? "ANALYSIS_FAILED");
  if (cost > 0) vitestAnalysisRefundedJobsStore.add(jobId);
  Object.assign(row, {
    status: "failed",
    progress: null,
    result: null,
    error_message: simulatedPublicAnalysisErrorMessage(errorCode),
    last_error_code: errorCode,
    completed_at: isoNow(),
    locked_at: null,
    locked_by: null,
    next_retry_at: null,
    failure_worker_id: workerId,
    failure_attempt_count: attemptCount,
    updated_at: isoNow(),
  });
  resolveVitestAnalysisFinalizationFailure(jobId);
  return {
    data: {
      ok: true,
      code: cost === 0 ? "FAILED_NO_CHARGE" : refundPreexisting ? "FAILED_ALREADY_REFUNDED" : "FAILED_AND_REFUNDED",
      duplicate: refundPreexisting,
      refunded: cost > 0,
      credits: 10,
    },
    error: null,
  };
}

function simulateClaimNextAnalysisJobRpc(args?: Record<string, unknown>): {
  data: Record<string, unknown> | null;
  error: null;
} {
  const wid = String(args?.p_worker_id ?? "unknown").trim() || "unknown";
  const staleSec = Math.max(1, Number(args?.p_stale_seconds ?? 900));
  const nowMs = Date.now();

  for (const [, row] of Array.from(vitestAnalysisJobsStore.entries())) {
    const r = row as Record<string, unknown>;
    if (r.status !== "running") continue;
    const ac = Number(r.attempt_count ?? 0);
    const maxA = Number(r.max_attempts ?? 3);
    if (ac < maxA) continue;
    const lockedAt = r.locked_at as string | null | undefined;
    const lockedMs = lockedAt ? new Date(lockedAt).getTime() : 0;
    const stale = !lockedAt || nowMs - lockedMs > staleSec * 1000;
    if (!stale) continue;
    const jobId = String(r.id);
    if (vitestAnalysisFinalizationFailuresStore.get(jobId)?.resolved === false) continue;
    const finalization = simulateFailAnalysisJobAndRefundRpc({
      p_analysis_job_id: r.id,
      p_locked_by: r.locked_by,
      p_attempt_count: r.attempt_count,
      p_error_code: "MAX_ATTEMPTS_EXCEEDED",
      p_error_message: "MAX_ATTEMPTS_EXCEEDED: worker lease exhausted",
    });
    if (finalization.data?.ok !== true) {
      const existing = vitestAnalysisFinalizationFailuresStore.get(jobId);
      vitestAnalysisFinalizationFailuresStore.set(jobId, {
        leaseWorkerId: typeof r.locked_by === "string" ? r.locked_by : null,
        leaseAttemptCount: Number(r.attempt_count),
        failureCode: String(finalization.data?.code ?? "UNKNOWN"),
        occurrenceCount: (existing?.occurrenceCount ?? 0) + 1,
        resolved: false,
      });
    }
  }

  const candidates = Array.from(vitestAnalysisJobsStore.entries()).filter(([, row]) => {
    const r = row as Record<string, unknown>;
    const ac = Number(r.attempt_count ?? 0);
    const maxA = Number(r.max_attempts ?? 3);
    if (ac >= maxA) return false;

    if (r.status === "queued") {
      const nr = r.next_retry_at as string | null | undefined;
      if (nr && new Date(nr).getTime() > nowMs) return false;
      return true;
    }
    if (r.status === "running") {
      const lockedAt = r.locked_at as string | null | undefined;
      const lockedMs = lockedAt ? new Date(lockedAt).getTime() : 0;
      return !lockedAt || nowMs - lockedMs > staleSec * 1000;
    }
    return false;
  });

  candidates.sort((a, b) =>
    String((a[1] as { created_at?: string }).created_at ?? "").localeCompare(
      String((b[1] as { created_at?: string }).created_at ?? "")
    )
  );

  if (candidates.length === 0) {
    return { data: null, error: null };
  }

  const [, row] = candidates[0]!;
  const r = row as Record<string, unknown>;
  Object.assign(r, {
    status: "running",
    progress: Math.max(Number(r.progress) || 0, 1),
    locked_at: isoNow(),
    locked_by: wid,
    attempt_count: Number(r.attempt_count ?? 0) + 1,
    completed_at: null,
    error_message: null,
    last_error_code: null,
    updated_at: isoNow(),
  });
  return { data: r, error: null };
}

vi.mock("./_core/supabaseAdmin", () => {
  const mockRpc = vi.fn(
    async (
      name: string,
      args?: Record<string, unknown>
    ): Promise<{ data: unknown; error: unknown }> => {
      const a = args ?? {};
      if (name === "ensure_profile_with_signup_bonus") {
        return { data: { credits: 2, signup_bonus_rows: 1 }, error: null };
      }
      if (name === "spend_credit_for_analysis") {
        const jobId = a.p_analysis_job_id;
        if (jobId === "insufficient-job") {
          return {
            data: { ok: false, code: "INSUFFICIENT_CREDITS", credits: 0, log_id: null },
            error: null,
          };
        }
        return {
          data: {
            ok: true,
            code: "OK",
            credits: 1,
            log_id: "00000000-0000-0000-0000-00000000aa01",
          },
          error: null,
        };
      }
      if (name === "enqueue_paid_analysis_job") {
        const jobId = String(a.p_analysis_job_id ?? "");
        if (jobId === "insufficient-job") {
          return { data: { ok: false, code: "INSUFFICIENT_CREDITS" }, error: null };
        }
        vitestSeedAnalysisJob({
          id: jobId,
          user_id: a.p_user_id,
          status: "queued",
          file_name: a.p_file_name,
          language: a.p_language,
          credit_cost: a.p_cost,
          credit_log_id: "00000000-0000-0000-0000-00000000aa01",
          is_mock: a.p_is_mock,
          progress: 0,
          sgf_content: a.p_sgf_content,
          sgf_sha256: a.p_sgf_sha256,
          sgf_size_bytes: a.p_sgf_size_bytes,
          data_retention_until: a.p_data_retention_until,
          result: null,
          error_message: null,
          completed_at: null,
        });
        return {
          data: {
            ok: true,
            code: "OK",
            credits: 1,
            log_id: "00000000-0000-0000-0000-00000000aa01",
          },
          error: null,
        };
      }
      if (name === "refund_credit_for_analysis") {
        const jobId = a.p_analysis_job_id as string;
        if (jobId === "job-refund-rpc-error") {
          return { data: null, error: { message: "rpc simulated failure" } };
        }
        if (jobId === "job-refund-dup") {
          return {
            data: { ok: true, duplicate: true, credits: 9, log_id: "00000000-0000-0000-0000-00000000dd01" },
            error: null,
          };
        }
        if (jobId === "job-refund-no-spend") {
          return {
            data: { ok: false, reason: "NO_SPEND", credits: 9, log_id: null },
            error: null,
          };
        }
        return { data: { ok: true, duplicate: false, credits: 10, log_id: "00000000-0000-0000-0000-00000000cc01" }, error: null };
      }
      if (name === "fail_analysis_job_and_refund_with_lease") {
        return simulateFailAnalysisJobAndRefundRpc(args);
      }
      if (name === "claim_next_analysis_job") {
        return simulateClaimNextAnalysisJobRpc(args);
      }
      if (name === "add_credits_from_payment") {
        return {
          data: { ok: true, duplicate: false, credits: 52, log_id: "00000000-0000-0000-0000-00000000bb01" },
          error: null,
        };
      }
      return { data: null, error: null };
    }
  );

  const mockFrom = vi.fn((table: string) => {
    if (table === "analysis_jobs") {
      return analysisJobsTableBuilder();
    }
    return legacyQueryBuilder(table);
  });

  return {
    SupabaseAdminUnavailableError: class SupabaseAdminUnavailableError extends Error {
      readonly code = "SUPABASE_ADMIN_UNAVAILABLE";
      constructor(message: string) {
        super(message);
        this.name = "SupabaseAdminUnavailableError";
      }
    },
    getSupabaseAdmin: () => ({
      rpc: mockRpc,
      from: mockFrom,
    }),
  };
});
