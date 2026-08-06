-- Provide one narrow, operator-invoked repair path for a quarantined
-- max-attempt finalization whose analysis_jobs.credit_log_id was lost. This
-- migration intentionally does not become a general credit-ledger repair API.

CREATE OR REPLACE FUNCTION public.reconcile_analysis_job_finalization(
  p_analysis_job_id text,
  p_apply boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $reconcile$
DECLARE
  v_job public.analysis_jobs%ROWTYPE;
  v_failure public.analysis_job_finalization_failures%ROWTYPE;
  v_usage public.credit_logs%ROWTYPE;
  v_refund public.credit_logs%ROWTYPE;
  v_usage_count bigint;
  v_refund_count bigint;
  v_job_log_count bigint;
  v_ledger_sum bigint;
  v_profile_credits integer;
  v_finalization jsonb;
BEGIN
  IF NULLIF(pg_catalog.btrim(p_analysis_job_id), '') IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'INVALID_ARGUMENT',
      'applied', false
    );
  END IF;

  -- Keep the lock order compatible with the wallet RPCs: job, quarantine,
  -- profile. The profile lock serializes legacy spend/refund/payment writes
  -- before this function inspects the ledger.
  SELECT * INTO v_job
  FROM public.analysis_jobs AS j
  WHERE j.id = p_analysis_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'NOT_FOUND',
      'applied', false
    );
  END IF;

  SELECT * INTO v_failure
  FROM public.analysis_job_finalization_failures AS f
  WHERE f.analysis_job_id = v_job.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'NOT_RECONCILABLE',
      'applied', false
    );
  END IF;

  PERFORM 1
  FROM public.profiles AS p
  WHERE p.id = v_job.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'LEDGER_INVARIANT',
      'applied', false
    );
  END IF;

  SELECT p.credits INTO v_profile_credits
  FROM public.profiles AS p
  WHERE p.id = v_job.user_id;

  SELECT COALESCE(pg_catalog.sum(l.amount), 0)
  INTO v_ledger_sum
  FROM public.credit_logs AS l
  WHERE l.user_id = v_job.user_id;

  IF v_profile_credits IS DISTINCT FROM v_ledger_sum THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'LEDGER_INVARIANT',
      'applied', false
    );
  END IF;

  SELECT pg_catalog.count(*) INTO v_usage_count
  FROM public.credit_logs AS l
  WHERE l.analysis_job_id = v_job.id
    AND l.type = 'usage';

  SELECT * INTO v_usage
  FROM public.credit_logs AS l
  WHERE l.idempotency_key = 'usage:' || v_job.id
  FOR SHARE;

  IF v_usage_count <> 1
    OR NOT FOUND
    OR v_usage.type <> 'usage'
    OR v_usage.user_id <> v_job.user_id
    OR v_usage.analysis_job_id IS DISTINCT FROM v_job.id
    OR v_usage.amount <> -v_job.credit_cost
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'LEDGER_INVARIANT',
      'applied', false
    );
  END IF;

  SELECT pg_catalog.count(*) INTO v_refund_count
  FROM public.credit_logs AS l
  WHERE l.analysis_job_id = v_job.id
    AND l.type = 'refund';

  IF v_refund_count > 1 THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'LEDGER_INVARIANT',
      'applied', false
    );
  END IF;

  SELECT * INTO v_refund
  FROM public.credit_logs AS l
  WHERE l.idempotency_key = 'refund:' || v_job.id
  FOR SHARE;

  IF (v_refund_count = 0 AND FOUND)
    OR (
      v_refund_count = 1
      AND (
        NOT FOUND
        OR v_refund.type <> 'refund'
        OR v_refund.user_id <> v_job.user_id
        OR v_refund.analysis_job_id IS DISTINCT FROM v_job.id
        OR v_refund.amount <> v_job.credit_cost
      )
    )
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'LEDGER_INVARIANT',
      'applied', false
    );
  END IF;

  SELECT pg_catalog.count(*) INTO v_job_log_count
  FROM public.credit_logs AS l
  WHERE l.analysis_job_id = v_job.id;

  IF v_job_log_count <> 1 + v_refund_count THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'LEDGER_INVARIANT',
      'applied', false
    );
  END IF;

  -- A response may have been lost after the underlying lease-fenced finalizer
  -- committed. Recognize only the exact terminal, resolved, canonical state.
  IF v_failure.resolved_at IS NOT NULL
    AND v_failure.failure_code = 'LEDGER_INVARIANT'
    AND NULLIF(pg_catalog.btrim(v_failure.lease_worker_id), '') IS NOT NULL
    AND v_job.status = 'failed'
    AND v_job.failure_worker_id IS NOT DISTINCT FROM v_failure.lease_worker_id
    AND v_job.failure_attempt_count IS NOT DISTINCT FROM v_failure.lease_attempt_count
    AND v_job.credit_log_id IS NOT DISTINCT FROM v_usage.id
    AND v_refund_count = 1
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'code', 'ALREADY_RECONCILED',
      'applied', false
    );
  END IF;

  IF v_failure.resolved_at IS NOT NULL
    OR v_failure.failure_code <> 'LEDGER_INVARIANT'
    OR NULLIF(pg_catalog.btrim(v_failure.lease_worker_id), '') IS NULL
    OR v_job.status <> 'running'
    OR v_job.credit_cost <= 0
    OR v_job.locked_by IS DISTINCT FROM v_failure.lease_worker_id
    OR v_job.attempt_count IS DISTINCT FROM v_failure.lease_attempt_count
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'NOT_RECONCILABLE',
      'applied', false
    );
  END IF;

  IF v_job.credit_log_id IS NOT NULL
    AND v_job.credit_log_id IS DISTINCT FROM v_usage.id
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'LINK_ALREADY_SET',
      'applied', false
    );
  END IF;

  IF NOT p_apply THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'code', 'PREVIEW_READY',
      'applied', false
    );
  END IF;

  IF v_job.credit_log_id IS NULL THEN
    UPDATE public.analysis_jobs AS j
    SET credit_log_id = v_usage.id
    WHERE j.id = v_job.id
      AND j.credit_log_id IS NULL;
  END IF;

  v_finalization := public.fail_analysis_job_and_refund_with_lease(
    v_job.id,
    v_failure.lease_worker_id,
    v_failure.lease_attempt_count,
    'MAX_ATTEMPTS_EXCEEDED',
    'operator reconciliation'
  );

  IF COALESCE((v_finalization ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'RECONCILIATION_FINALIZER_DECLINED';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'code', 'RECONCILED',
    'applied', true
  );
END;
$reconcile$;

-- Harden the new privileged RPC against pre-existing ownership and ACL drift.
DO $migration$
DECLARE
  v_application_owner name;
  v_grantee name;
  v_signature text := 'public.reconcile_analysis_job_finalization(text, boolean)';
BEGIN
  SELECT pg_catalog.pg_get_userbyid(c.relowner)
  INTO v_application_owner
  FROM pg_catalog.pg_class AS c
  WHERE c.oid = 'public.profiles'::pg_catalog.regclass;

  IF v_application_owner IS NULL THEN
    RAISE EXCEPTION 'could not resolve the application table owner';
  END IF;

  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %s OWNER TO %I',
    v_signature,
    v_application_owner
  );
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION %s SET search_path = pg_catalog',
    v_signature
  );

  FOR v_grantee IN
    SELECT pg_catalog.pg_get_userbyid(a.grantee)
    FROM pg_catalog.pg_proc AS p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) AS a
    WHERE p.oid = v_signature::pg_catalog.regprocedure
      AND a.privilege_type = 'EXECUTE'
      AND a.grantee <> 0
      AND a.grantee <> p.proowner
      AND a.grantee <> 'service_role'::pg_catalog.regrole
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION %s FROM %I',
      v_signature,
      v_grantee
    );
  END LOOP;

  EXECUTE pg_catalog.format(
    'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
    v_signature
  );
  EXECUTE pg_catalog.format(
    'GRANT EXECUTE ON FUNCTION %s TO service_role',
    v_signature
  );
END;
$migration$;

-- The Worker writes this table only through its SECURITY DEFINER claim RPC;
-- operations status and reconciliation need no direct service-role mutation.
REVOKE ALL ON TABLE public.analysis_job_finalization_failures
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.analysis_job_finalization_failures TO service_role;
