INSERT INTO public.profiles (id, credits)
VALUES
  ('concurrent-replay', 5),
  ('concurrent-completion-wins', 5),
  ('concurrent-failure-wins', 5);

SELECT public.enqueue_paid_analysis_job(
  'concurrent-replay', 'concurrent-replay-job', 2, NULL, 'ko', '(;GM[1])', 'concurrent-replay', 8, true, NULL
);
SELECT (public.claim_next_analysis_job('worker-concurrent-replay', 900)).id;

SELECT public.enqueue_paid_analysis_job(
  'concurrent-completion-wins', 'concurrent-completion-wins-job', 2, NULL, 'ko', '(;GM[1])', 'concurrent-completion-wins', 8, true, NULL
);
SELECT (public.claim_next_analysis_job('worker-concurrent-completion', 900)).id;

SELECT public.enqueue_paid_analysis_job(
  'concurrent-failure-wins', 'concurrent-failure-wins-job', 2, NULL, 'ko', '(;GM[1])', 'concurrent-failure-wins', 8, true, NULL
);
SELECT (public.claim_next_analysis_job('worker-concurrent-failure', 900)).id;
