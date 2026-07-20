-- Atomically finalize an analysis failure and refund its internal credits.
-- Apply after 011_atomic_enqueue_paid_analysis_job.sql, before deploying the matching Worker.

ALTER TABLE public.analysis_jobs
  ADD COLUMN IF NOT EXISTS failure_worker_id text,
  ADD COLUMN IF NOT EXISTS failure_attempt_count integer;

COMMENT ON COLUMN public.analysis_jobs.failure_worker_id IS
  'Worker lease owner that atomically finalized this job as failed';
COMMENT ON COLUMN public.analysis_jobs.failure_attempt_count IS
  'Worker lease attempt that atomically finalized this job as failed';

ALTER TABLE public.analysis_jobs
  DROP CONSTRAINT IF EXISTS analysis_jobs_failure_lease_pair;
ALTER TABLE public.analysis_jobs
  ADD CONSTRAINT analysis_jobs_failure_lease_pair CHECK (
    (failure_worker_id IS NULL AND failure_attempt_count IS NULL)
    OR
    (NULLIF(pg_catalog.btrim(failure_worker_id), '') IS NOT NULL AND failure_attempt_count >= 1)
  );

-- A ledger invariant failure must not make every claim repeatedly lock and
-- reprocess the same oldest max-attempt rows. Quarantine it durably for an
-- operator-led reconciliation with the original finalizing lease.
CREATE TABLE IF NOT EXISTS public.analysis_job_finalization_failures (
  analysis_job_id text PRIMARY KEY
    REFERENCES public.analysis_jobs(id) ON DELETE CASCADE,
  lease_worker_id text,
  lease_attempt_count integer NOT NULL CHECK (lease_attempt_count >= 1),
  failure_code text NOT NULL,
  first_failed_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  last_failed_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  resolved_at timestamptz
);

COMMENT ON TABLE public.analysis_job_finalization_failures IS
  'Durable quarantine for max-attempt jobs whose atomic failure finalization was declined';

ALTER TABLE public.analysis_job_finalization_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.analysis_job_finalization_failures FROM PUBLIC;
REVOKE ALL ON TABLE public.analysis_job_finalization_failures FROM anon;
REVOKE ALL ON TABLE public.analysis_job_finalization_failures FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.analysis_job_finalization_failures TO service_role;

CREATE OR REPLACE FUNCTION public.fail_analysis_job_and_refund_with_lease(
  p_analysis_job_id text,
  p_locked_by text,
  p_attempt_count integer,
  p_error_code text,
  p_error_message text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_job public.analysis_jobs%ROWTYPE;
  v_usage public.credit_logs%ROWTYPE;
  v_refund public.credit_logs%ROWTYPE;
  v_worker_id text;
  v_error_code text;
  v_error_message text;
  v_refund_key text;
  v_credits integer;
  v_refund_id uuid;
  v_refund_preexisting boolean := false;
BEGIN
  v_worker_id := NULLIF(pg_catalog.btrim(p_locked_by), '');
  v_error_code := pg_catalog.upper(
    COALESCE(NULLIF(pg_catalog.btrim(p_error_code), ''), 'ANALYSIS_FAILED')
  );
  IF v_error_code !~ '^[A-Z][A-Z0-9_]{1,127}$' THEN
    v_error_code := 'ANALYSIS_FAILED';
  END IF;
  -- analysis_jobs is user-readable. Persist only allowlisted public messages;
  -- detailed engine diagnostics stay in restricted Worker logs.
  v_error_message := CASE v_error_code
    WHEN 'KATAGO_TIMEOUT' THEN 'Analysis timed out. Please try again.'
    WHEN 'SGF_PARSE_FAILED' THEN 'The game record could not be analyzed.'
    WHEN 'KATAGO_QUERY_BUILD_FAILED' THEN 'The game record could not be analyzed.'
    ELSE 'Analysis failed. Please try again.'
  END;

  IF NULLIF(pg_catalog.btrim(p_analysis_job_id), '') IS NULL
    OR v_worker_id IS NULL
    OR p_attempt_count IS NULL
    OR p_attempt_count < 1
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'INVALID_ARGUMENT',
      'duplicate', false,
      'refunded', false
    );
  END IF;

  SELECT * INTO v_job
  FROM public.analysis_jobs AS j
  WHERE j.id = p_analysis_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'NOT_FOUND',
      'duplicate', false,
      'refunded', false
    );
  END IF;

  v_refund_key := 'refund:' || v_job.id;

  -- A successful response may have been lost. Only the exact finalizing lease
  -- receives the idempotent terminal response.
  IF v_job.status = 'failed' THEN
    IF v_job.failure_worker_id IS DISTINCT FROM v_worker_id
      OR v_job.failure_attempt_count IS DISTINCT FROM p_attempt_count
    THEN
      RETURN pg_catalog.jsonb_build_object(
        'ok', false,
        'code', 'ALREADY_FAILED',
        'duplicate', false,
        'refunded', false
      );
    END IF;

    IF v_job.credit_cost > 0 THEN
      SELECT * INTO v_refund
      FROM public.credit_logs AS l
      WHERE l.idempotency_key = v_refund_key
      LIMIT 1;

      IF NOT FOUND
        OR v_refund.type <> 'refund'
        OR v_refund.user_id <> v_job.user_id
        OR v_refund.analysis_job_id IS DISTINCT FROM v_job.id
        OR v_refund.amount <> v_job.credit_cost
      THEN
        RETURN pg_catalog.jsonb_build_object(
          'ok', false,
          'code', 'LEDGER_INVARIANT',
          'duplicate', true,
          'refunded', false
        );
      END IF;
      v_refund_id := v_refund.id;
    END IF;

    SELECT p.credits INTO v_credits
    FROM public.profiles AS p
    WHERE p.id = v_job.user_id;

    UPDATE public.analysis_job_finalization_failures AS f
    SET resolved_at = pg_catalog.now()
    WHERE f.analysis_job_id = v_job.id
      AND f.resolved_at IS NULL;

    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'code', 'ALREADY_FAILED',
      'duplicate', true,
      'refunded', v_job.credit_cost > 0,
      'refund_log_id', v_refund_id,
      'credits', v_credits
    );
  END IF;

  IF v_job.status = 'completed' THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'ALREADY_COMPLETED',
      'duplicate', false,
      'refunded', false
    );
  END IF;

  IF v_job.status <> 'running' THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'INVALID_STATE',
      'duplicate', false,
      'refunded', false
    );
  END IF;

  IF v_job.locked_by IS DISTINCT FROM v_worker_id
    OR v_job.attempt_count IS DISTINCT FROM p_attempt_count
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'LEASE_LOST',
      'duplicate', false,
      'refunded', false
    );
  END IF;

  IF v_job.credit_cost < 0 THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'LEDGER_INVARIANT',
      'duplicate', false,
      'refunded', false
    );
  END IF;

  IF v_job.credit_cost > 0 THEN
    SELECT * INTO v_usage
    FROM public.credit_logs AS l
    WHERE l.id = v_job.credit_log_id
    FOR SHARE;

    IF NOT FOUND
      OR v_usage.type <> 'usage'
      OR v_usage.user_id <> v_job.user_id
      OR v_usage.analysis_job_id IS DISTINCT FROM v_job.id
      OR v_usage.amount <> -v_job.credit_cost
    THEN
      RETURN pg_catalog.jsonb_build_object(
        'ok', false,
        'code', 'LEDGER_INVARIANT',
        'duplicate', false,
        'refunded', false
      );
    END IF;

    -- An old Worker may have committed the refund before this migration. If so,
    -- validate it and converge the job state without incrementing twice.
    SELECT * INTO v_refund
    FROM public.credit_logs AS l
    WHERE l.idempotency_key = v_refund_key
    LIMIT 1;

    IF FOUND THEN
      IF v_refund.type <> 'refund'
        OR v_refund.user_id <> v_job.user_id
        OR v_refund.analysis_job_id IS DISTINCT FROM v_job.id
        OR v_refund.amount <> v_job.credit_cost
      THEN
        RETURN pg_catalog.jsonb_build_object(
          'ok', false,
          'code', 'LEDGER_INVARIANT',
          'duplicate', false,
          'refunded', false
        );
      END IF;
      v_refund_id := v_refund.id;
      v_refund_preexisting := true;
      SELECT p.credits INTO v_credits
      FROM public.profiles AS p
      WHERE p.id = v_job.user_id;
      IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
          'ok', false,
          'code', 'PROFILE_NOT_FOUND',
          'duplicate', false,
          'refunded', false
        );
      END IF;
    ELSE
      PERFORM 1
      FROM public.profiles AS p
      WHERE p.id = v_job.user_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
          'ok', false,
          'code', 'PROFILE_NOT_FOUND',
          'duplicate', false,
          'refunded', false
        );
      END IF;

      -- Close the race with the legacy refund RPC, which also locks profiles
      -- before inserting its idempotency key.
      SELECT * INTO v_refund
      FROM public.credit_logs AS l
      WHERE l.idempotency_key = v_refund_key
      LIMIT 1;

      IF FOUND THEN
        IF v_refund.type <> 'refund'
          OR v_refund.user_id <> v_job.user_id
          OR v_refund.analysis_job_id IS DISTINCT FROM v_job.id
          OR v_refund.amount <> v_job.credit_cost
        THEN
          RETURN pg_catalog.jsonb_build_object(
            'ok', false,
            'code', 'LEDGER_INVARIANT',
            'duplicate', false,
            'refunded', false
          );
        END IF;
        v_refund_id := v_refund.id;
        v_refund_preexisting := true;
        SELECT p.credits INTO v_credits
        FROM public.profiles AS p
        WHERE p.id = v_job.user_id;
      ELSE
        UPDATE public.profiles AS p
        SET credits = p.credits + v_job.credit_cost,
            updated_at = pg_catalog.now()
        WHERE p.id = v_job.user_id
        RETURNING p.credits INTO v_credits;

        INSERT INTO public.credit_logs (
          user_id,
          amount,
          type,
          description,
          analysis_job_id,
          idempotency_key,
          metadata
        ) VALUES (
          v_job.user_id,
          v_job.credit_cost,
          'refund',
          'Atomic analysis failure refund',
          v_job.id,
          v_refund_key,
          pg_catalog.jsonb_build_object(
            'reason', 'analysis_job_failed',
            'error_code', v_error_code,
            'worker_id', v_worker_id,
            'attempt_count', p_attempt_count
          )
        )
        RETURNING id INTO v_refund_id;
      END IF;
    END IF;
  ELSE
    SELECT p.credits INTO v_credits
    FROM public.profiles AS p
    WHERE p.id = v_job.user_id;
  END IF;

  UPDATE public.analysis_jobs AS j
  SET
    status = 'failed',
    progress = NULL,
    result = NULL,
    error_message = v_error_message,
    last_error_code = v_error_code,
    completed_at = pg_catalog.now(),
    locked_at = NULL,
    locked_by = NULL,
    next_retry_at = NULL,
    failure_worker_id = v_worker_id,
    failure_attempt_count = p_attempt_count
  WHERE j.id = v_job.id;

  UPDATE public.analysis_job_finalization_failures AS f
  SET resolved_at = pg_catalog.now()
  WHERE f.analysis_job_id = v_job.id
    AND f.resolved_at IS NULL;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'code', CASE
      WHEN v_job.credit_cost = 0 THEN 'FAILED_NO_CHARGE'
      WHEN v_refund_preexisting THEN 'FAILED_ALREADY_REFUNDED'
      ELSE 'FAILED_AND_REFUNDED'
    END,
    'duplicate', v_refund_preexisting,
    'refunded', v_job.credit_cost > 0,
    'refund_log_id', v_refund_id,
    'credits', v_credits
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fail_analysis_job_and_refund_with_lease(text, text, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_analysis_job_and_refund_with_lease(text, text, integer, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.fail_analysis_job_and_refund_with_lease(text, text, integer, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fail_analysis_job_and_refund_with_lease(text, text, integer, text, text) TO service_role;

-- Replace the max-attempt finalizer so it cannot commit failed while silently
-- accepting a declined refund. A damaged ledger row remains running and emits a
-- PostgreSQL warning instead of committing a partial terminal state.
CREATE OR REPLACE FUNCTION public.claim_next_analysis_job(
  p_worker_id text,
  p_stale_seconds integer DEFAULT 900
)
RETURNS public.analysis_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  r public.analysis_jobs;
  v_id text;
  v_wid text;
  v_stale interval;
  v_rec record;
  v_failure jsonb;
BEGIN
  v_wid := COALESCE(NULLIF(pg_catalog.btrim(p_worker_id), ''), 'unknown');
  IF p_stale_seconds IS NULL OR p_stale_seconds < 1 THEN
    v_stale := pg_catalog.make_interval(secs => 900);
  ELSE
    v_stale := pg_catalog.make_interval(secs => p_stale_seconds);
  END IF;

  FOR v_rec IN
    SELECT
      j.id,
      j.locked_by,
      j.attempt_count
    FROM public.analysis_jobs AS j
    WHERE j.status = 'running'
      AND (j.locked_at IS NULL OR j.locked_at < pg_catalog.now() - v_stale)
      AND j.attempt_count >= j.max_attempts
      AND NOT EXISTS (
        SELECT 1
        FROM public.analysis_job_finalization_failures AS f
        WHERE f.analysis_job_id = j.id
          AND f.resolved_at IS NULL
      )
    ORDER BY j.created_at ASC
    LIMIT 100
    FOR UPDATE OF j SKIP LOCKED
  LOOP
    v_failure := public.fail_analysis_job_and_refund_with_lease(
      v_rec.id,
      v_rec.locked_by,
      v_rec.attempt_count,
      'MAX_ATTEMPTS_EXCEEDED',
      'MAX_ATTEMPTS_EXCEEDED: worker lease exhausted'
    );
    IF COALESCE((v_failure ->> 'ok')::boolean, false) IS NOT TRUE THEN
      INSERT INTO public.analysis_job_finalization_failures AS f (
        analysis_job_id,
        lease_worker_id,
        lease_attempt_count,
        failure_code
      ) VALUES (
        v_rec.id,
        v_rec.locked_by,
        v_rec.attempt_count,
        COALESCE(v_failure ->> 'code', 'UNKNOWN')
      )
      ON CONFLICT (analysis_job_id) DO UPDATE
      SET
        lease_worker_id = EXCLUDED.lease_worker_id,
        lease_attempt_count = EXCLUDED.lease_attempt_count,
        failure_code = EXCLUDED.failure_code,
        last_failed_at = pg_catalog.now(),
        occurrence_count = f.occurrence_count + 1,
        resolved_at = NULL;

      RAISE WARNING 'atomic max-attempt finalization declined for job %, code=%',
        v_rec.id,
        COALESCE(v_failure ->> 'code', 'UNKNOWN');
    END IF;
  END LOOP;

  SELECT j.id
  INTO v_id
  FROM public.analysis_jobs AS j
  WHERE
    (
      j.status = 'queued'
      AND (j.next_retry_at IS NULL OR j.next_retry_at <= pg_catalog.now())
      AND j.attempt_count < j.max_attempts
    )
    OR
    (
      j.status = 'running'
      AND (j.locked_at IS NULL OR j.locked_at < pg_catalog.now() - v_stale)
      AND j.attempt_count < j.max_attempts
    )
  ORDER BY j.created_at ASC
  LIMIT 1
  FOR UPDATE OF j SKIP LOCKED;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.analysis_jobs AS j
  SET
    status = 'running',
    progress = GREATEST(COALESCE(j.progress, 0), 1),
    locked_at = pg_catalog.now(),
    locked_by = v_wid,
    attempt_count = j.attempt_count + 1,
    completed_at = NULL,
    error_message = NULL,
    last_error_code = NULL,
    failure_worker_id = NULL,
    failure_attempt_count = NULL
  WHERE j.id = v_id
  RETURNING * INTO STRICT r;

  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_analysis_job(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_next_analysis_job(text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.claim_next_analysis_job(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_analysis_job(text, integer) TO service_role;
