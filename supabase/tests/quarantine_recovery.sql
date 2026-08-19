BEGIN;

CREATE FUNCTION public.__ci_assert_true(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $assertion$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CI assertion failed: %', p_message;
  END IF;
END;
$assertion$;

INSERT INTO public.profiles (id, credits)
VALUES ('quarantine-poison', 5), ('quarantine-next', 5);

INSERT INTO public.credit_logs (
  user_id, amount, type, description, idempotency_key
) VALUES (
  'quarantine-poison', 5, 'admin_adjustment', 'CI opening balance', 'ci-opening:quarantine-poison'
);

SELECT public.enqueue_paid_analysis_job(
  'quarantine-poison', 'quarantine-poison-job', 2, NULL, 'ko', '(;GM[1])', 'hash-poison', 8, true, NULL
);
SELECT public.__ci_assert_true(
  (SELECT (public.claim_next_analysis_job('worker-poison', 900)).id) = 'quarantine-poison-job',
  'poison fixture was not claimed'
);
UPDATE public.analysis_jobs
SET
  credit_log_id = NULL,
  attempt_count = 3,
  max_attempts = 3,
  locked_at = pg_catalog.now() - interval '1 hour'
WHERE id = 'quarantine-poison-job';

SELECT public.enqueue_paid_analysis_job(
  'quarantine-next', 'quarantine-next-job', 1, NULL, 'ko', '(;GM[1])', 'hash-next', 8, true, NULL
);

-- The poison row is quarantined, while the next healthy queued job still
-- advances in the same claim call.
SELECT public.__ci_assert_true(
  (SELECT (public.claim_next_analysis_job('worker-sweeper', 1)).id) = 'quarantine-next-job',
  'poison row blocked the next healthy claim'
);

SELECT public.__ci_assert_true(
  EXISTS (
    SELECT 1
    FROM public.analysis_job_finalization_failures
    WHERE analysis_job_id = 'quarantine-poison-job'
      AND lease_worker_id = 'worker-poison'
      AND lease_attempt_count = 3
      AND failure_code = 'LEDGER_INVARIANT'
      AND occurrence_count = 1
      AND resolved_at IS NULL
  )
    AND (SELECT status FROM public.analysis_jobs WHERE id = 'quarantine-poison-job') = 'running'
    AND (SELECT credits FROM public.profiles WHERE id = 'quarantine-poison') = 3
    AND NOT EXISTS (
      SELECT 1 FROM public.credit_logs WHERE idempotency_key = 'refund:quarantine-poison-job'
    ),
  'poison row quarantine did not fail closed'
);

CREATE TEMP TABLE __ci_quarantine_snapshot AS
SELECT last_failed_at, occurrence_count
FROM public.analysis_job_finalization_failures
WHERE analysis_job_id = 'quarantine-poison-job';

-- No queued or reclaimable healthy row remains. The unresolved poison row must
-- be excluded instead of repeatedly increasing its occurrence counter.
SELECT public.__ci_assert_true(
  public.claim_next_analysis_job('worker-sweeper-2', 1) IS NULL,
  'unexpected job was returned on the second claim'
);
SELECT public.__ci_assert_true(
  EXISTS (
    SELECT 1
    FROM public.analysis_job_finalization_failures AS current
    CROSS JOIN __ci_quarantine_snapshot AS previous
    WHERE current.analysis_job_id = 'quarantine-poison-job'
      AND current.occurrence_count = previous.occurrence_count
      AND current.last_failed_at = previous.last_failed_at
  ),
  'unresolved poison row was repeatedly finalized'
);

-- The reconciliation RPC previews without writing, then restores only the
-- canonical usage link and invokes the exact stored lease atomically.
WITH response AS (
  SELECT public.reconcile_analysis_job_finalization(
    'quarantine-poison-job', false
  ) AS body
)
SELECT public.__ci_assert_true(
  body ->> 'code' = 'PREVIEW_READY'
    AND (body ->> 'applied')::boolean IS FALSE
    AND (SELECT credit_log_id FROM public.analysis_jobs WHERE id = 'quarantine-poison-job') IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.credit_logs WHERE idempotency_key = 'refund:quarantine-poison-job'
    ),
  'reconciliation preview wrote or did not accept the poison row'
)
FROM response;

-- Refuse a mismatched link and wallet drift with no repair side effects.
UPDATE public.analysis_jobs AS j
SET credit_log_id = l.id
FROM public.credit_logs AS l
WHERE j.id = 'quarantine-poison-job'
  AND l.idempotency_key = 'usage:quarantine-next-job';
SELECT public.__ci_assert_true(
  (public.reconcile_analysis_job_finalization('quarantine-poison-job', false) ->> 'code') = 'LINK_ALREADY_SET'
    AND (SELECT status FROM public.analysis_jobs WHERE id = 'quarantine-poison-job') = 'running',
  'reconciliation accepted a wrong pre-existing link'
);
UPDATE public.analysis_jobs
SET credit_log_id = NULL
WHERE id = 'quarantine-poison-job';
UPDATE public.profiles SET credits = credits + 1 WHERE id = 'quarantine-poison';
SELECT public.__ci_assert_true(
  (public.reconcile_analysis_job_finalization('quarantine-poison-job', false) ->> 'code') = 'LEDGER_INVARIANT'
    AND (SELECT credit_log_id FROM public.analysis_jobs WHERE id = 'quarantine-poison-job') IS NULL,
  'reconciliation accepted wallet drift'
);
UPDATE public.profiles SET credits = credits - 1 WHERE id = 'quarantine-poison';

WITH response AS (
  SELECT public.reconcile_analysis_job_finalization(
    'quarantine-poison-job', true
  ) AS body
)
SELECT public.__ci_assert_true(
  body ->> 'code' = 'RECONCILED'
    AND (body ->> 'applied')::boolean IS TRUE,
  'reconciliation did not atomically finalize the poison row'
)
FROM response;

SELECT public.__ci_assert_true(
  (SELECT status FROM public.analysis_jobs WHERE id = 'quarantine-poison-job') = 'failed'
    AND (SELECT credits FROM public.profiles WHERE id = 'quarantine-poison') = 5
    AND (SELECT count(*) FROM public.credit_logs WHERE idempotency_key = 'refund:quarantine-poison-job') = 1
    AND EXISTS (
      SELECT 1
      FROM public.analysis_job_finalization_failures
      WHERE analysis_job_id = 'quarantine-poison-job'
        AND resolved_at IS NOT NULL
    ),
  'quarantine recovery did not atomically resolve and refund'
);

SELECT public.__ci_assert_true(
  (public.reconcile_analysis_job_finalization('quarantine-poison-job', true) ->> 'code') = 'ALREADY_RECONCILED'
    AND (SELECT count(*) FROM public.credit_logs WHERE idempotency_key = 'refund:quarantine-poison-job') = 1,
  'reconciliation response-loss replay was not idempotent'
);

ROLLBACK;
