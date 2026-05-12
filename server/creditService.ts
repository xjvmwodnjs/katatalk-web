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

export async function refundCreditIfJobFailed(
  user: AuthenticatedUser,
  jobId: string,
  cost: number = DEFAULT_ANALYSIS_COST
): Promise<void> {
  const sb = getSupabaseAdmin();
  const userId = walletSubjectFromAuthUser(user);
  const { error } = await sb.rpc("refund_credit_for_analysis", {
    p_user_id: userId,
    p_analysis_job_id: jobId,
    p_amount: cost,
  });
  if (error) {
    console.error("[creditService] refund_credit_for_analysis", error.message);
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
};

export async function insertAnalysisJobQueued(args: {
  jobId: string;
  profileId: string;
  fileName: string;
  language: string;
  creditLogId: string | null;
  creditCost?: number;
}): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("analysis_jobs").insert({
    id: args.jobId,
    user_id: args.profileId,
    status: "queued",
    file_name: args.fileName,
    language: args.language,
    credit_cost: args.creditCost ?? 1,
    credit_log_id: args.creditLogId,
    is_mock: true,
    progress: 0,
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
    Pick<AnalysisJobDbRow, "status" | "progress" | "result" | "error_message" | "completed_at">
  >
): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("analysis_jobs").update(patch).eq("id", jobId);
  if (error) {
    throw new Error(error.message);
  }
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
