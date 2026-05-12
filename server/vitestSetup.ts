/**
 * Vitest 전역 설정 — 서버 모듈이 로드되기 전에 최소 env 를 채우고 Supabase Admin 을 모킹한다.
 */
import { vi } from "vitest";

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

function queryBuilder(table: string) {
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
      if (table === "analysis_jobs") {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    insert() {
      return Promise.resolve({ error: null });
    },
  };
  return builder;
}

vi.mock("./_core/supabaseAdmin", () => {
  const mockRpc = vi.fn(
    async (
      name: string,
      args?: Record<string, unknown>
    ): Promise<{ data: unknown; error: null }> => {
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
      if (name === "refund_credit_for_analysis") {
        return { data: { ok: true, duplicate: false }, error: null };
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

  const mockFrom = vi.fn((table: string) => queryBuilder(table));

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
