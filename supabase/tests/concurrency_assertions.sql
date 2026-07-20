DO $assertions$
DECLARE
  v_status text;
  v_refunds integer;
  v_credits integer;
BEGIN
  IF (SELECT credits FROM public.profiles WHERE id = 'concurrent-replay') <> 5
    OR (SELECT count(*) FROM public.credit_logs WHERE idempotency_key = 'refund:concurrent-replay-job') <> 1
    OR (SELECT status FROM public.analysis_jobs WHERE id = 'concurrent-replay-job') <> 'failed'
  THEN
    RAISE EXCEPTION 'concurrent same-lease replay violated exactly-once refund';
  END IF;

  SELECT status INTO v_status
  FROM public.analysis_jobs
  WHERE id = 'concurrent-completion-wins-job';
  SELECT count(*) INTO v_refunds
  FROM public.credit_logs
  WHERE idempotency_key = 'refund:concurrent-completion-wins-job';
  SELECT credits INTO v_credits
  FROM public.profiles
  WHERE id = 'concurrent-completion-wins';

  IF v_status <> 'completed' OR v_refunds <> 0 OR v_credits <> 3 THEN
    RAISE EXCEPTION 'completion-first race did not preserve completed/no-refund state';
  END IF;

  SELECT status INTO v_status
  FROM public.analysis_jobs
  WHERE id = 'concurrent-failure-wins-job';
  SELECT count(*) INTO v_refunds
  FROM public.credit_logs
  WHERE idempotency_key = 'refund:concurrent-failure-wins-job';
  SELECT credits INTO v_credits
  FROM public.profiles
  WHERE id = 'concurrent-failure-wins';

  IF v_status <> 'failed' OR v_refunds <> 1 OR v_credits <> 5 THEN
    RAISE EXCEPTION 'failure-first race did not preserve failed/exact-refund state';
  END IF;
END;
$assertions$;

DELETE FROM public.analysis_jobs
WHERE id IN (
  'concurrent-replay-job',
  'concurrent-completion-wins-job',
  'concurrent-failure-wins-job'
);
DELETE FROM public.profiles
WHERE id IN ('concurrent-replay', 'concurrent-completion-wins', 'concurrent-failure-wins');
