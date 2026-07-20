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

-- Paid enqueue, exact-lease failure/refund, and response-loss replay.
INSERT INTO public.profiles (id, credits) VALUES ('fresh-paid', 5);
WITH response AS (
  SELECT public.enqueue_paid_analysis_job(
    'fresh-paid', 'fresh-paid-job', 2, 'paid.sgf', 'ko', '(;GM[1])', 'hash-paid', 8, true, NULL
  ) AS body
)
SELECT public.__ci_assert_true(
  body ->> 'code' = 'OK' AND (body ->> 'credits')::integer = 3,
  'paid enqueue response is not OK/3 credits'
)
FROM response;

SELECT public.__ci_assert_true(
  (SELECT (public.claim_next_analysis_job('worker-paid', 900)).id) = 'fresh-paid-job',
  'paid job was not claimed'
);

WITH response AS (
  SELECT public.fail_analysis_job_and_refund_with_lease(
    'fresh-paid-job', 'worker-paid', 1, 'KATAGO_TIMEOUT', 'private engine diagnostics'
  ) AS body
)
SELECT public.__ci_assert_true(
  (body ->> 'ok')::boolean
    AND body ->> 'code' = 'FAILED_AND_REFUNDED'
    AND (body ->> 'credits')::integer = 5,
  'paid finalization did not atomically fail and refund'
)
FROM response;

SELECT public.__ci_assert_true(
  (SELECT credits FROM public.profiles WHERE id = 'fresh-paid') = 5
    AND (SELECT count(*) FROM public.credit_logs WHERE idempotency_key = 'refund:fresh-paid-job') = 1
    AND EXISTS (
      SELECT 1
      FROM public.credit_logs
      WHERE idempotency_key = 'refund:fresh-paid-job'
        AND user_id = 'fresh-paid'
        AND analysis_job_id = 'fresh-paid-job'
        AND amount = 2
        AND type = 'refund'
    )
    AND EXISTS (
      SELECT 1
      FROM public.analysis_jobs
      WHERE id = 'fresh-paid-job'
        AND status = 'failed'
        AND locked_by IS NULL
        AND locked_at IS NULL
        AND failure_worker_id = 'worker-paid'
        AND failure_attempt_count = 1
        AND error_message = 'Analysis timed out. Please try again.'
        AND error_message NOT LIKE '%private%'
    ),
  'paid finalization state or public error message is inconsistent'
);

WITH response AS (
  SELECT public.fail_analysis_job_and_refund_with_lease(
    'fresh-paid-job', 'worker-paid', 1, 'KATAGO_TIMEOUT', 'lost response replay'
  ) AS body
)
SELECT public.__ci_assert_true(
  (body ->> 'ok')::boolean
    AND body ->> 'code' = 'ALREADY_FAILED'
    AND (body ->> 'duplicate')::boolean,
  'same-lease replay was not idempotent'
)
FROM response;

SELECT public.__ci_assert_true(
  (SELECT credits FROM public.profiles WHERE id = 'fresh-paid') = 5
    AND (SELECT count(*) FROM public.credit_logs WHERE idempotency_key = 'refund:fresh-paid-job') = 1,
  'same-lease replay changed wallet or refund cardinality'
);

-- A stale/different lease must not mutate the running job or wallet.
INSERT INTO public.profiles (id, credits) VALUES ('fresh-stale', 5);
SELECT public.enqueue_paid_analysis_job(
  'fresh-stale', 'fresh-stale-job', 2, NULL, 'ko', '(;GM[1])', 'hash-stale', 8, true, NULL
);
SELECT public.__ci_assert_true(
  (SELECT (public.claim_next_analysis_job('worker-current', 900)).id) = 'fresh-stale-job',
  'stale-lease fixture was not claimed'
);
WITH response AS (
  SELECT public.fail_analysis_job_and_refund_with_lease(
    'fresh-stale-job', 'worker-old', 1, 'KATAGO_TIMEOUT', 'stale'
  ) AS body
)
SELECT public.__ci_assert_true(body ->> 'code' = 'LEASE_LOST', 'stale lease was accepted')
FROM response;
SELECT public.__ci_assert_true(
  (SELECT credits FROM public.profiles WHERE id = 'fresh-stale') = 3
    AND (SELECT status FROM public.analysis_jobs WHERE id = 'fresh-stale-job') = 'running'
    AND NOT EXISTS (
      SELECT 1 FROM public.credit_logs WHERE idempotency_key = 'refund:fresh-stale-job'
    ),
  'stale lease changed job or ledger state'
);

-- Completion wins must reject failure and never create a refund.
INSERT INTO public.profiles (id, credits) VALUES ('fresh-completed', 5);
SELECT public.enqueue_paid_analysis_job(
  'fresh-completed', 'fresh-completed-job', 2, NULL, 'ko', '(;GM[1])', 'hash-completed', 8, true, NULL
);
SELECT public.__ci_assert_true(
  (SELECT (public.claim_next_analysis_job('worker-completed', 900)).id) = 'fresh-completed-job',
  'completed fixture was not claimed'
);
UPDATE public.analysis_jobs
SET status = 'completed', result = '{}'::jsonb, completed_at = pg_catalog.now(), locked_at = NULL, locked_by = NULL
WHERE id = 'fresh-completed-job';
WITH response AS (
  SELECT public.fail_analysis_job_and_refund_with_lease(
    'fresh-completed-job', 'worker-completed', 1, 'KATAGO_TIMEOUT', 'late failure'
  ) AS body
)
SELECT public.__ci_assert_true(body ->> 'code' = 'ALREADY_COMPLETED', 'completed job accepted failure')
FROM response;
SELECT public.__ci_assert_true(
  (SELECT credits FROM public.profiles WHERE id = 'fresh-completed') = 3
    AND NOT EXISTS (
      SELECT 1 FROM public.credit_logs WHERE idempotency_key = 'refund:fresh-completed-job'
    ),
  'completed job received a refund'
);

-- A free running job fails without manufacturing a refund.
INSERT INTO public.profiles (id, credits) VALUES ('fresh-free', 2);
INSERT INTO public.analysis_jobs (
  id, user_id, status, credit_cost, is_mock, locked_by, locked_at, attempt_count, max_attempts
)
VALUES (
  'fresh-free-job', 'fresh-free', 'running', 0, true, 'worker-free', pg_catalog.now(), 1, 3
);
WITH response AS (
  SELECT public.fail_analysis_job_and_refund_with_lease(
    'fresh-free-job', 'worker-free', 1, 'SGF_PARSE_FAILED', 'private parser details'
  ) AS body
)
SELECT public.__ci_assert_true(
  body ->> 'code' = 'FAILED_NO_CHARGE' AND NOT (body ->> 'refunded')::boolean,
  'free job finalization response is wrong'
)
FROM response;
SELECT public.__ci_assert_true(
  (SELECT credits FROM public.profiles WHERE id = 'fresh-free') = 2
    AND (SELECT status FROM public.analysis_jobs WHERE id = 'fresh-free-job') = 'failed'
    AND NOT EXISTS (
      SELECT 1 FROM public.credit_logs WHERE idempotency_key = 'refund:fresh-free-job'
    ),
  'free job changed wallet or created a refund'
);

-- A corrupt debit link must fail closed and leave the job running.
INSERT INTO public.profiles (id, credits) VALUES ('fresh-broken', 5);
SELECT public.enqueue_paid_analysis_job(
  'fresh-broken', 'fresh-broken-job', 2, NULL, 'ko', '(;GM[1])', 'hash-broken', 8, true, NULL
);
SELECT public.__ci_assert_true(
  (SELECT (public.claim_next_analysis_job('worker-broken', 900)).id) = 'fresh-broken-job',
  'broken-ledger fixture was not claimed'
);
UPDATE public.analysis_jobs SET credit_log_id = NULL WHERE id = 'fresh-broken-job';
WITH response AS (
  SELECT public.fail_analysis_job_and_refund_with_lease(
    'fresh-broken-job', 'worker-broken', 1, 'KATAGO_TIMEOUT', 'broken ledger'
  ) AS body
)
SELECT public.__ci_assert_true(body ->> 'code' = 'LEDGER_INVARIANT', 'broken ledger did not fail closed')
FROM response;
SELECT public.__ci_assert_true(
  (SELECT credits FROM public.profiles WHERE id = 'fresh-broken') = 3
    AND (SELECT status FROM public.analysis_jobs WHERE id = 'fresh-broken-job') = 'running'
    AND NOT EXISTS (
      SELECT 1 FROM public.credit_logs WHERE idempotency_key = 'refund:fresh-broken-job'
    ),
  'broken ledger partially finalized'
);

-- Converge a legacy split refund without incrementing the wallet twice.
INSERT INTO public.profiles (id, credits) VALUES ('fresh-legacy', 5);
SELECT public.enqueue_paid_analysis_job(
  'fresh-legacy', 'fresh-legacy-job', 2, NULL, 'ko', '(;GM[1])', 'hash-legacy', 8, true, NULL
);
SELECT public.__ci_assert_true(
  (SELECT (public.claim_next_analysis_job('worker-legacy', 900)).id) = 'fresh-legacy-job',
  'legacy-refund fixture was not claimed'
);
SELECT public.refund_credit_for_analysis('fresh-legacy', 'fresh-legacy-job', 2);
WITH response AS (
  SELECT public.fail_analysis_job_and_refund_with_lease(
    'fresh-legacy-job', 'worker-legacy', 1, 'KATAGO_TIMEOUT', 'legacy convergence'
  ) AS body
)
SELECT public.__ci_assert_true(
  body ->> 'code' = 'FAILED_ALREADY_REFUNDED'
    AND (body ->> 'duplicate')::boolean,
  'legacy refund did not converge'
)
FROM response;
SELECT public.__ci_assert_true(
  (SELECT credits FROM public.profiles WHERE id = 'fresh-legacy') = 5
    AND (SELECT count(*) FROM public.credit_logs WHERE idempotency_key = 'refund:fresh-legacy-job') = 1
    AND (SELECT status FROM public.analysis_jobs WHERE id = 'fresh-legacy-job') = 'failed',
  'legacy convergence double-refunded or failed to finalize'
);

ROLLBACK;
