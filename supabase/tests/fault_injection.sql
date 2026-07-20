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

CREATE FUNCTION public.__ci_raise_failpoint()
RETURNS trigger
LANGUAGE plpgsql
AS $failpoint$
BEGIN
  RAISE EXCEPTION 'CI_FAILPOINT:%', TG_ARGV[0];
END;
$failpoint$;

INSERT INTO public.profiles (id, credits)
VALUES ('fault-profile', 5), ('fault-ledger', 5), ('fault-job', 5);

SELECT public.enqueue_paid_analysis_job(
  'fault-profile', 'fault-profile-job', 2, NULL, 'ko', '(;GM[1])', 'hash-fp', 8, true, NULL
);
SELECT public.__ci_assert_true(
  (SELECT (public.claim_next_analysis_job('worker-fault-profile', 900)).id) = 'fault-profile-job',
  'profile failpoint fixture was not claimed'
);
SELECT public.enqueue_paid_analysis_job(
  'fault-ledger', 'fault-ledger-job', 2, NULL, 'ko', '(;GM[1])', 'hash-fl', 8, true, NULL
);
SELECT public.__ci_assert_true(
  (SELECT (public.claim_next_analysis_job('worker-fault-ledger', 900)).id) = 'fault-ledger-job',
  'ledger failpoint fixture was not claimed'
);
SELECT public.enqueue_paid_analysis_job(
  'fault-job', 'fault-job-job', 2, NULL, 'ko', '(;GM[1])', 'hash-fj', 8, true, NULL
);
SELECT public.__ci_assert_true(
  (SELECT (public.claim_next_analysis_job('worker-fault-job', 900)).id) = 'fault-job-job',
  'job failpoint fixture was not claimed'
);

CREATE TRIGGER __ci_fail_after_profile_update
AFTER UPDATE OF credits ON public.profiles
FOR EACH ROW
WHEN (NEW.id = 'fault-profile' AND NEW.credits > OLD.credits)
EXECUTE FUNCTION public.__ci_raise_failpoint('profile');

DO $test$
BEGIN
  BEGIN
    PERFORM public.fail_analysis_job_and_refund_with_lease(
      'fault-profile-job', 'worker-fault-profile', 1, 'KATAGO_TIMEOUT', 'fault profile'
    );
    RAISE EXCEPTION 'CI_EXPECTED_FAILPOINT_NOT_RAISED:profile';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'CI_FAILPOINT:profile%' THEN
      RAISE;
    END IF;
  END;
END;
$test$;

DROP TRIGGER __ci_fail_after_profile_update ON public.profiles;

CREATE TRIGGER __ci_fail_after_refund_insert
AFTER INSERT ON public.credit_logs
FOR EACH ROW
WHEN (NEW.idempotency_key = 'refund:fault-ledger-job')
EXECUTE FUNCTION public.__ci_raise_failpoint('ledger');

DO $test$
BEGIN
  BEGIN
    PERFORM public.fail_analysis_job_and_refund_with_lease(
      'fault-ledger-job', 'worker-fault-ledger', 1, 'KATAGO_TIMEOUT', 'fault ledger'
    );
    RAISE EXCEPTION 'CI_EXPECTED_FAILPOINT_NOT_RAISED:ledger';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'CI_FAILPOINT:ledger%' THEN
      RAISE;
    END IF;
  END;
END;
$test$;

DROP TRIGGER __ci_fail_after_refund_insert ON public.credit_logs;

CREATE TRIGGER __ci_fail_after_job_update
AFTER UPDATE OF status ON public.analysis_jobs
FOR EACH ROW
WHEN (NEW.id = 'fault-job-job' AND NEW.status = 'failed')
EXECUTE FUNCTION public.__ci_raise_failpoint('job');

DO $test$
BEGIN
  BEGIN
    PERFORM public.fail_analysis_job_and_refund_with_lease(
      'fault-job-job', 'worker-fault-job', 1, 'KATAGO_TIMEOUT', 'fault job'
    );
    RAISE EXCEPTION 'CI_EXPECTED_FAILPOINT_NOT_RAISED:job';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'CI_FAILPOINT:job%' THEN
      RAISE;
    END IF;
  END;
END;
$test$;

SELECT public.__ci_assert_true(
  NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id IN ('fault-profile', 'fault-ledger', 'fault-job')
      AND credits <> 3
  ),
  'a failpoint left a partial wallet increment'
);

SELECT public.__ci_assert_true(
  NOT EXISTS (
    SELECT 1
    FROM public.credit_logs
    WHERE idempotency_key IN (
      'refund:fault-profile-job',
      'refund:fault-ledger-job',
      'refund:fault-job-job'
    )
  ),
  'a failpoint left a partial refund ledger row'
);

SELECT public.__ci_assert_true(
  NOT EXISTS (
    SELECT 1
    FROM public.analysis_jobs
    WHERE id IN ('fault-profile-job', 'fault-ledger-job', 'fault-job-job')
      AND (
        status <> 'running'
        OR locked_by IS NULL
        OR failure_worker_id IS NOT NULL
        OR failure_attempt_count IS NOT NULL
      )
  ),
  'a failpoint left a partial terminal job state'
);

ROLLBACK;
