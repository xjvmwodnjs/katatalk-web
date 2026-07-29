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

SELECT public.__ci_assert_true(
  EXISTS (
    SELECT 1
    FROM public.analysis_jobs
    WHERE id = 'upgrade-failed-job'
      AND status = 'failed'
      AND failure_worker_id IS NULL
      AND failure_attempt_count IS NULL
  )
    AND (SELECT credits FROM public.profiles WHERE id = 'upgrade-failed') = 5
    AND (SELECT count(*) FROM public.credit_logs WHERE idempotency_key = 'refund:upgrade-failed-job') = 1,
  '012 did not preserve a legacy failed/refunded row'
);

WITH response AS (
  SELECT public.fail_analysis_job_and_refund_with_lease(
    'upgrade-valid-job', 'upgrade-worker-valid', 1, 'KATAGO_TIMEOUT', 'upgrade valid'
  ) AS body
)
SELECT public.__ci_assert_true(
  body ->> 'code' = 'FAILED_AND_REFUNDED',
  'valid 011 running job did not finalize after upgrade'
)
FROM response;
SELECT public.__ci_assert_true(
  (SELECT credits FROM public.profiles WHERE id = 'upgrade-valid') = 5
    AND (SELECT count(*) FROM public.credit_logs WHERE idempotency_key = 'refund:upgrade-valid-job') = 1,
  'valid upgrade finalization has an incorrect wallet or refund'
);

WITH response AS (
  SELECT public.fail_analysis_job_and_refund_with_lease(
    'upgrade-refunded-job', 'upgrade-worker-refunded', 1, 'KATAGO_TIMEOUT', 'upgrade split refund'
  ) AS body
)
SELECT public.__ci_assert_true(
  body ->> 'code' = 'FAILED_ALREADY_REFUNDED',
  'preexisting canonical refund did not converge after upgrade'
)
FROM response;
SELECT public.__ci_assert_true(
  (SELECT credits FROM public.profiles WHERE id = 'upgrade-refunded') = 5
    AND (SELECT count(*) FROM public.credit_logs WHERE idempotency_key = 'refund:upgrade-refunded-job') = 1,
  'upgrade convergence double-refunded the wallet'
);

SELECT public.__ci_assert_true(
  public.claim_next_analysis_job('upgrade-sweeper', 1) IS NULL,
  'upgrade poison sweep unexpectedly returned a job'
);
SELECT public.__ci_assert_true(
  EXISTS (
    SELECT 1
    FROM public.analysis_job_finalization_failures
    WHERE analysis_job_id = 'upgrade-poison-job'
      AND lease_worker_id = 'upgrade-worker-poison'
      AND lease_attempt_count = 3
      AND failure_code = 'LEDGER_INVARIANT'
      AND resolved_at IS NULL
  ),
  '011 poison row was not quarantined after upgrade'
);

UPDATE public.analysis_jobs AS j
SET credit_log_id = l.id
FROM public.credit_logs AS l
WHERE j.id = 'upgrade-poison-job'
  AND l.idempotency_key = 'usage:upgrade-poison-job';

WITH response AS (
  SELECT public.fail_analysis_job_and_refund_with_lease(
    f.analysis_job_id,
    f.lease_worker_id,
    f.lease_attempt_count,
    'MAX_ATTEMPTS_EXCEEDED',
    'upgrade reconciliation'
  ) AS body
  FROM public.analysis_job_finalization_failures AS f
  WHERE f.analysis_job_id = 'upgrade-poison-job'
)
SELECT public.__ci_assert_true(
  body ->> 'code' = 'FAILED_AND_REFUNDED',
  'upgrade poison row did not recover with its stored lease'
)
FROM response;
SELECT public.__ci_assert_true(
  (SELECT status FROM public.analysis_jobs WHERE id = 'upgrade-poison-job') = 'failed'
    AND (SELECT credits FROM public.profiles WHERE id = 'upgrade-poison') = 5
    AND EXISTS (
      SELECT 1
      FROM public.analysis_job_finalization_failures
      WHERE analysis_job_id = 'upgrade-poison-job'
        AND resolved_at IS NOT NULL
    ),
  'upgrade poison recovery did not resolve atomically'
);

ROLLBACK;
