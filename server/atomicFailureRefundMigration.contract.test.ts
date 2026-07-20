import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../supabase/migrations/012_atomic_failure_refund.sql", import.meta.url), "utf8");

describe("012_atomic_failure_refund migration contract", () => {
  it("derives refund identity and amount from the locked job instead of caller input", () => {
    const signature = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.fail_analysis_job_and_refund_with_lease"), migration.indexOf("RETURNS jsonb"));
    expect(signature).toContain("p_analysis_job_id text");
    expect(signature).toContain("p_locked_by text");
    expect(signature).toContain("p_attempt_count integer");
    expect(signature).not.toContain("p_user_id");
    expect(signature).not.toContain("p_amount");
    expect(migration).toContain("v_usage.amount <> -v_job.credit_cost");
    expect(migration).toContain("v_usage.user_id <> v_job.user_id");
    expect(migration).toContain("v_usage.analysis_job_id IS DISTINCT FROM v_job.id");
  });

  it("locks job and profile and performs refund ledger plus terminal update in one RPC", () => {
    expect(migration).toMatch(/FROM public\.analysis_jobs AS j[\s\S]*FOR UPDATE;/);
    expect(migration).toMatch(/FROM public\.profiles AS p[\s\S]*FOR UPDATE;/);
    expect(migration).toContain("UPDATE public.profiles AS p");
    expect(migration).toContain("INSERT INTO public.credit_logs");
    expect(migration).toContain("UPDATE public.analysis_jobs AS j");
    expect(migration).toContain("failure_worker_id = v_worker_id");
    expect(migration).toContain("failure_attempt_count = p_attempt_count");
  });

  it("is a hardened SECURITY DEFINER function restricted to service_role", () => {
    expect(migration).toContain("SECURITY DEFINER\nSET search_path = pg_catalog");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.fail_analysis_job_and_refund_with_lease(text, text, integer, text, text) FROM PUBLIC");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.fail_analysis_job_and_refund_with_lease(text, text, integer, text, text) FROM anon");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.fail_analysis_job_and_refund_with_lease(text, text, integer, text, text) FROM authenticated");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.fail_analysis_job_and_refund_with_lease(text, text, integer, text, text) TO service_role");
  });

  it("routes max-attempt finalization through the same atomic command", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.claim_next_analysis_job");
    expect(migration).toContain("v_failure := public.fail_analysis_job_and_refund_with_lease(");
    expect(migration).not.toContain("PERFORM public.refund_credit_for_analysis(");
    expect(migration).toContain("atomic max-attempt finalization declined");
  });

  it("durably quarantines declined max-attempt finalizations", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.analysis_job_finalization_failures");
    expect(migration).toContain("ALTER TABLE public.analysis_job_finalization_failures ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON TABLE public.analysis_job_finalization_failures FROM PUBLIC");
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE ON TABLE public.analysis_job_finalization_failures TO service_role");
    expect(migration).toContain("INSERT INTO public.analysis_job_finalization_failures AS f");
    expect(migration).toMatch(/NOT EXISTS \([\s\S]*f\.resolved_at IS NULL[\s\S]*\)/);
    expect(migration).toContain("SET resolved_at = pg_catalog.now()");
  });
});
