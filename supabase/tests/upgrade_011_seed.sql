-- Representative committed state from an installation that has reached 011
-- but not the atomic failure/refund migration.
INSERT INTO public.profiles (id, credits)
VALUES
  ('upgrade-valid', 5),
  ('upgrade-refunded', 5),
  ('upgrade-failed', 5),
  ('upgrade-poison', 5);

INSERT INTO public.credit_logs (
  user_id, amount, type, description, idempotency_key
) VALUES
  ('upgrade-valid', 5, 'admin_adjustment', 'CI opening balance', 'ci-opening:upgrade-valid'),
  ('upgrade-refunded', 5, 'admin_adjustment', 'CI opening balance', 'ci-opening:upgrade-refunded'),
  ('upgrade-failed', 5, 'admin_adjustment', 'CI opening balance', 'ci-opening:upgrade-failed'),
  ('upgrade-poison', 5, 'admin_adjustment', 'CI opening balance', 'ci-opening:upgrade-poison');

SELECT public.enqueue_paid_analysis_job(
  'upgrade-valid', 'upgrade-valid-job', 2, NULL, 'ko', '(;GM[1])', 'upgrade-valid', 8, true, NULL
);
SELECT (public.claim_next_analysis_job('upgrade-worker-valid', 900)).id;

SELECT public.enqueue_paid_analysis_job(
  'upgrade-refunded', 'upgrade-refunded-job', 2, NULL, 'ko', '(;GM[1])', 'upgrade-refunded', 8, true, NULL
);
SELECT (public.claim_next_analysis_job('upgrade-worker-refunded', 900)).id;
SELECT public.refund_credit_for_analysis('upgrade-refunded', 'upgrade-refunded-job', 2);

SELECT public.enqueue_paid_analysis_job(
  'upgrade-failed', 'upgrade-failed-job', 2, NULL, 'ko', '(;GM[1])', 'upgrade-failed', 8, true, NULL
);
SELECT (public.claim_next_analysis_job('upgrade-worker-failed', 900)).id;
SELECT public.refund_credit_for_analysis('upgrade-failed', 'upgrade-failed-job', 2);
UPDATE public.analysis_jobs
SET
  status = 'failed',
  progress = NULL,
  error_message = 'legacy failed state',
  completed_at = pg_catalog.now(),
  locked_at = NULL,
  locked_by = NULL
WHERE id = 'upgrade-failed-job';

SELECT public.enqueue_paid_analysis_job(
  'upgrade-poison', 'upgrade-poison-job', 2, NULL, 'ko', '(;GM[1])', 'upgrade-poison', 8, true, NULL
);
SELECT (public.claim_next_analysis_job('upgrade-worker-poison', 900)).id;
UPDATE public.analysis_jobs
SET
  credit_log_id = NULL,
  attempt_count = 3,
  max_attempts = 3,
  locked_at = pg_catalog.now() - interval '1 hour'
WHERE id = 'upgrade-poison-job';

-- Prove that 013 removes drifted grants to a role outside the owner/service
-- boundary instead of only revoking the three canonical client roles.
GRANT EXECUTE ON FUNCTION public.enqueue_paid_analysis_job(
  text, text, integer, text, text, text, text, integer, boolean, timestamptz
) TO ci_rogue_runtime;
GRANT DELETE ON TABLE public.analysis_jobs TO ci_rogue_runtime;
GRANT UPDATE ON TABLE public.katatalk_schema_migrations TO ci_rogue_runtime;
GRANT CREATE ON SCHEMA public TO ci_rogue_runtime;
