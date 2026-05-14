import type { AuthenticatedUser } from "./_core/sdk";
import { getSupabaseAdmin } from "./_core/supabaseAdmin";

const DEFAULT_ANALYSIS_COST = 1;

/** profiles.id 및 analysis_jobs.user_id — Clerk면 `sub`, 그 외 `non-clerk:` 접두사. */
export function walletSubjectFromAuthUser(user: AuthenticatedUser): string {
  if (user.openId.startsWith("clerk:")) {
    return user.openId.slice("clerk:".length);
  }
  return `non-clerk:${user.openId}`;
}

export type EnsureProfileResult = {
  credits: number;
  signupBonusRows: number;
};

export type CreditLogRow = {
  id: string;
  user_id: string;
  amount: number;
  type: string;
  description: string | null;
  /** @deprecated legacy Stripe */
  stripe_event_id: string | null;
  /** @deprecated legacy Stripe */
  stripe_session_id: string | null;
  payment_provider: string | null;
  payment_event_id: string | null;
  payment_order_id: string | null;
  payment_checkout_id: string | null;
  analysis_job_id: string | null;
  idempotency_key: string | null;
  metadata: unknown;
  created_at: string;
};

/** Supabase RPC json/jsonb 반환 — 단일 객체·배열 1행·JSON 문자열 모두 허용 */
export function parseSupabaseRpcJson(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (Array.isArray(value) && value.length > 0 && value[0] && typeof value[0] === "object" && !Array.isArray(value[0])) {
    return value[0] as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object" && !Array.isArray(parsed[0])) {
        return parsed[0] as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function parseRpcJson(value: unknown): Record<string, unknown> | null {
  return parseSupabaseRpcJson(value);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Supabase RPC: 프로필 없으면 2크레딧 + signup_bonus 로그, 있으면 email/name만 갱신. */
export async function ensureProfileForClerkUser(user: AuthenticatedUser): Promise<EnsureProfileResult> {
  const sb = getSupabaseAdmin();
  const userId = walletSubjectFromAuthUser(user);
  const { data, error } = await sb.rpc("ensure_profile_with_signup_bonus", {
    p_user_id: userId,
    p_email: user.email ?? null,
    p_name: user.name ?? null,
  });
  if (error) {
    throw new Error(error.message);
  }
  const row = parseRpcJson(data);
  const credits = num(row?.credits);
  const signupBonusRows = num(row?.signup_bonus_rows);
  if (credits == null) {
    throw new Error("ensure_profile_with_signup_bonus: invalid response");
  }
  return { credits, signupBonusRows: signupBonusRows ?? 0 };
}

export async function getCreditBalance(clerkProfileId: string): Promise<number> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("profiles")
    .select("credits")
    .eq("id", clerkProfileId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  const row = data as { credits?: number } | null;
  return typeof row?.credits === "number" ? row.credits : 0;
}

export async function getCreditLogs(clerkProfileId: string, limit = 20): Promise<CreditLogRow[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("credit_logs")
    .select(
      "id, user_id, amount, type, description, stripe_event_id, stripe_session_id, payment_provider, payment_event_id, payment_order_id, payment_checkout_id, analysis_job_id, idempotency_key, metadata, created_at"
    )
    .eq("user_id", clerkProfileId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as CreditLogRow[];
}

export type SpendForAnalysisResult =
  | { ok: true; balanceAfter: number; ledgerId: string }
  | { ok: false; code: "INSUFFICIENT_CREDITS" | "PROFILE_NOT_FOUND" };

export async function spendCreditForAnalysisJob(
  user: AuthenticatedUser,
  jobId: string,
  cost: number = DEFAULT_ANALYSIS_COST
): Promise<SpendForAnalysisResult> {
  const sb = getSupabaseAdmin();
  const userId = walletSubjectFromAuthUser(user);
  const { data, error } = await sb.rpc("spend_credit_for_analysis", {
    p_user_id: userId,
    p_analysis_job_id: jobId,
    p_cost: cost,
  });
  if (error) {
    throw new Error(error.message);
  }
  const row = parseRpcJson(data);
  const ok = row?.ok === true;
  const code = str(row?.code);
  const credits = num(row?.credits);
  const logId = row?.log_id;
  const logStr = typeof logId === "string" ? logId : null;

  if (!ok) {
    if (code === "INSUFFICIENT_CREDITS" || code === "PROFILE_NOT_FOUND") {
      return { ok: false, code };
    }
    return { ok: false, code: "INSUFFICIENT_CREDITS" };
  }

  if (credits == null || !logStr) {
    throw new Error("spend_credit_for_analysis: invalid success response");
  }
  return { ok: true, balanceAfter: credits, ledgerId: logStr };
}

export type RefundCreditForAnalysisResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; duplicate?: boolean; errorCode: string; errorMessage?: string };

export async function refundCreditIfJobFailed(
  user: AuthenticatedUser,
  jobId: string,
  cost: number = DEFAULT_ANALYSIS_COST
): Promise<RefundCreditForAnalysisResult> {
  const profileId = walletSubjectFromAuthUser(user);
  return refundCreditIfJobFailedByProfileId(profileId, jobId, cost);
}

/** analysis worker 등 — Clerk 세션 없이 profiles.id(= analysis_jobs.user_id)로 환불 RPC 호출 */
export async function refundCreditIfJobFailedByProfileId(
  profileId: string,
  jobId: string,
  cost: number = DEFAULT_ANALYSIS_COST
): Promise<RefundCreditForAnalysisResult> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.rpc("refund_credit_for_analysis", {
      p_user_id: profileId,
      p_analysis_job_id: jobId,
      p_amount: cost,
    });
    if (error) {
      console.error("[creditService] refund_credit_for_analysis RPC", error.message);
      return { ok: false, errorCode: "RPC_ERROR", errorMessage: error.message };
    }
    const row = parseRpcJson(data);
    if (!row) {
      return { ok: false, errorCode: "RPC_EMPTY_RESPONSE" };
    }
    if (row.ok === true) {
      return { ok: true, duplicate: row.duplicate === true };
    }
    const reason = str(row.reason) ?? str(row.error) ?? "REFUND_DECLINED";
    return {
      ok: false,
      duplicate: row.duplicate === true,
      errorCode: reason,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[creditService] refund_credit_for_analysis exception", msg);
    return { ok: false, errorCode: "EXCEPTION", errorMessage: msg };
  }
}

/** 웹훅에서만 호출 — idempotency_key 는 `payment:<provider>:<stable_event_or_order_id>` 형태 권장 */
export async function addCreditsFromPaymentWebhook(args: {
  clerkUserId: string;
  amount: number;
  idempotencyKey: string;
  paymentProvider: string;
  paymentEventId: string | null;
  paymentOrderId: string | null;
  paymentCheckoutId: string | null;
  description: string | null;
}): Promise<{ ok: boolean; duplicate: boolean; credits: number | null; errorCode: string | null }> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.rpc("add_credits_from_payment", {
    p_user_id: args.clerkUserId,
    p_amount: args.amount,
    p_idempotency_key: args.idempotencyKey,
    p_payment_provider: args.paymentProvider,
    p_payment_event_id: args.paymentEventId,
    p_payment_order_id: args.paymentOrderId,
    p_payment_checkout_id: args.paymentCheckoutId,
    p_description: args.description,
  });
  if (error) {
    throw new Error(error.message);
  }
  const row = parseRpcJson(data);
  const errCode = str(row?.error);
  const duplicate = row?.duplicate === true;
  const credits = num(row?.credits);
  let ok = row?.ok === true;
  if (ok && !duplicate && credits == null) {
    ok = false;
  }
  let errorOut = errCode;
  if (!ok && row?.ok === true && !duplicate && credits == null) {
    errorOut = "RPC_OK_WITHOUT_CREDITS";
  }
  return {
    ok,
    duplicate,
    credits,
    errorCode: ok ? null : errorOut,
  };
}

/** 웹훅 지급 직후 credit_logs 행 존재 확인(개발 시 RPC·DB 불일치 탐지) */
export async function fetchCreditLogIdByIdempotencyKey(idempotencyKey: string): Promise<string | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("credit_logs").select("id").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  const row = data as { id?: string } | null;
  return typeof row?.id === "string" ? row.id : null;
}

/** Supabase analysis_jobs 행 (서비스 롤 조회) */
export type AnalysisJobDbRow = {
  id: string;
  user_id: string;
  status: string;
  file_name: string | null;
  language: string | null;
  credit_cost: number;
  credit_log_id: string | null;
  result: unknown | null;
  error_message: string | null;
  is_mock: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  /** 마이그레이션 003 이전 DB 에서는 없을 수 있음 */
  progress?: number | null;
  /** 마이그레이션 005 — 검증된 SGF UTF-8 원문 (MVP 는 DB 컬럼; 추후 Storage 분리 가능) */
  sgf_content?: string | null;
  sgf_sha256?: string | null;
  sgf_size_bytes?: number | null;
  /** 마이그레이션 007 — worker claim lease */
  locked_at?: string | null;
  locked_by?: string | null;
  attempt_count?: number;
  max_attempts?: number;
  next_retry_at?: string | null;
  last_error_code?: string | null;
};

export async function insertAnalysisJobQueued(args: {
  jobId: string;
  profileId: string;
  fileName: string;
  language: string;
  creditLogId: string | null;
  creditCost?: number;
  sgfContent: string;
  sgfSha256: string;
  sgfSizeBytes: number;
  /** KataGo worker(external) 실분석 큐이면 false */
  isMock?: boolean;
}): Promise<void> {
  const sb = getSupabaseAdmin();
  const isMock = args.isMock ?? true;
  const { error } = await sb.from("analysis_jobs").insert({
    id: args.jobId,
    user_id: args.profileId,
    status: "queued",
    file_name: args.fileName,
    language: args.language,
    credit_cost: args.creditCost ?? 1,
    credit_log_id: args.creditLogId,
    is_mock: isMock,
    progress: 0,
    sgf_content: args.sgfContent,
    sgf_sha256: args.sgfSha256,
    sgf_size_bytes: args.sgfSizeBytes,
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function getAnalysisJobRow(jobId: string): Promise<AnalysisJobDbRow | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("analysis_jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data != null ? (data as AnalysisJobDbRow) : null;
}

export async function updateAnalysisJobRow(
  jobId: string,
  patch: Partial<
    Pick<
      AnalysisJobDbRow,
      | "status"
      | "progress"
      | "result"
      | "error_message"
      | "completed_at"
      | "is_mock"
      | "locked_at"
      | "locked_by"
      | "last_error_code"
      | "next_retry_at"
      | "attempt_count"
    >
  >
): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("analysis_jobs").update(patch).eq("id", jobId);
  if (error) {
    throw new Error(error.message);
  }
}

function analysisJobRowFromUnknown(data: unknown): AnalysisJobDbRow | null {
  if (data == null) {
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row || typeof row !== "object") {
    return null;
  }
  const id = typeof row.id === "string" ? row.id : null;
  const user_id = typeof row.user_id === "string" ? row.user_id : null;
  const status = typeof row.status === "string" ? row.status : null;
  if (!id || !user_id || !status) {
    return null;
  }
  return {
    id,
    user_id,
    status,
    file_name: typeof row.file_name === "string" ? row.file_name : null,
    language: typeof row.language === "string" ? row.language : null,
    credit_cost: typeof row.credit_cost === "number" ? row.credit_cost : 1,
    credit_log_id: typeof row.credit_log_id === "string" ? row.credit_log_id : null,
    result: row.result ?? null,
    error_message: typeof row.error_message === "string" ? row.error_message : null,
    is_mock: row.is_mock === true,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
    completed_at: typeof row.completed_at === "string" ? row.completed_at : null,
    progress: typeof row.progress === "number" ? row.progress : row.progress === null ? null : undefined,
    sgf_content: typeof row.sgf_content === "string" ? row.sgf_content : null,
    sgf_sha256: typeof row.sgf_sha256 === "string" ? row.sgf_sha256 : null,
    sgf_size_bytes: typeof row.sgf_size_bytes === "number" ? row.sgf_size_bytes : null,
    locked_at: row.locked_at === null || typeof row.locked_at === "string" ? (row.locked_at as string | null) : undefined,
    locked_by: typeof row.locked_by === "string" || row.locked_by === null ? (row.locked_by as string | null) : undefined,
    attempt_count: typeof row.attempt_count === "number" ? row.attempt_count : undefined,
    max_attempts: typeof row.max_attempts === "number" ? row.max_attempts : undefined,
    next_retry_at:
      row.next_retry_at === null || typeof row.next_retry_at === "string"
        ? (row.next_retry_at as string | null)
        : undefined,
    last_error_code:
      typeof row.last_error_code === "string" || row.last_error_code === null
        ? (row.last_error_code as string | null)
        : undefined,
  };
}

/**
 * queued 또는 stale running job 1건을 running 으로 원자 claim. 없으면 null.
 * Supabase `007_analysis_job_lease_retry.sql` (및 이후) RPC 시그니처: (p_worker_id, p_stale_seconds).
 */
export async function claimNextAnalysisJobRpc(options?: {
  workerId?: string;
  staleSeconds?: number;
}): Promise<AnalysisJobDbRow | null> {
  const sb = getSupabaseAdmin();
  const staleRaw = options?.staleSeconds ?? parseInt(process.env.ANALYSIS_CLAIM_STALE_SECONDS ?? "900", 10);
  const staleSeconds = Number.isFinite(staleRaw) && staleRaw >= 1 ? staleRaw : 900;
  const workerId = (options?.workerId ?? "unknown").trim() || "unknown";
  const { data, error } = await sb.rpc("claim_next_analysis_job", {
    p_worker_id: workerId,
    p_stale_seconds: staleSeconds,
  });
  if (error) {
    throw new Error(error.message);
  }
  return analysisJobRowFromUnknown(data);
}

export async function getAnalysisJobOwnerProfileId(jobId: string): Promise<string | null> {
  try {
    const row = await getAnalysisJobRow(jobId);
    return row?.user_id ?? null;
  } catch (e) {
    console.error("[creditService] getAnalysisJobOwnerProfileId", e);
    return null;
  }
}

/** @deprecated 이름 호환 — ensureProfileForClerkUser 사용 권장 */
export async function ensureWalletWithSignupBonus(user: AuthenticatedUser): Promise<void> {
  await ensureProfileForClerkUser(user);
}

export async function getWalletBalance(user: AuthenticatedUser): Promise<number> {
  await ensureProfileForClerkUser(user);
  return getCreditBalance(walletSubjectFromAuthUser(user));
}
