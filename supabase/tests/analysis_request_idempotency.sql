BEGIN;

SELECT public.ensure_profile_with_signup_bonus('__idempotency_user_a__', NULL, NULL);
SELECT public.add_credits_from_payment(
  '__idempotency_user_a__',
  8,
  '__idempotency_funding_a__',
  'ci',
  '__idempotency_funding_event_a__',
  NULL,
  NULL,
  'idempotency fixture funding'
);

DO $idempotency_contract$
DECLARE
  v_first jsonb;
  v_replay jsonb;
  v_conflict jsonb;
  v_denied jsonb;
  v_credits integer;
  v_index integer;
BEGIN
  v_first := public.enqueue_paid_analysis_job_v2(
    '__idempotency_user_a__',
    '__idempotency_original_job__',
    'idempotency-request-a-0001',
    pg_catalog.repeat('a', 64),
    2,
    'game.sgf',
    'ko',
    '(;GM[1]SZ[19];B[pd])',
    pg_catalog.repeat('b', 64),
    20,
    false,
    NULL,
    NULL
  );
  IF v_first->>'code' <> 'OK'
    OR v_first->>'job_id' <> '__idempotency_original_job__'
    OR (v_first->>'replayed')::boolean
  THEN
    RAISE EXCEPTION 'first idempotent enqueue failed: %', v_first;
  END IF;

  FOR v_index IN 1..100 LOOP
    v_replay := public.enqueue_paid_analysis_job_v2(
      '__idempotency_user_a__',
      '__idempotency_retry_job_' || v_index::text,
      'idempotency-request-a-0001',
      pg_catalog.repeat('a', 64),
      2,
      'game.sgf',
      'ko',
      '(;GM[1]SZ[19];B[pd])',
      pg_catalog.repeat('b', 64),
      20,
      false,
      NULL,
      NULL
    );
    IF v_replay->>'code' <> 'ALREADY_ENQUEUED'
      OR v_replay->>'job_id' <> '__idempotency_original_job__'
      OR NOT (v_replay->>'replayed')::boolean
    THEN
      RAISE EXCEPTION 'replay % failed: %', v_index, v_replay;
    END IF;
  END LOOP;

  v_conflict := public.enqueue_paid_analysis_job_v2(
    '__idempotency_user_a__',
    '__idempotency_conflicting_job__',
    'idempotency-request-a-0001',
    pg_catalog.repeat('c', 64),
    2,
    'game.sgf',
    'en',
    '(;GM[1]SZ[19];B[pd])',
    pg_catalog.repeat('b', 64),
    20,
    false,
    NULL,
    NULL
  );
  IF v_conflict->>'code' <> 'IDEMPOTENCY_CONFLICT' THEN
    RAISE EXCEPTION 'fingerprint conflict was accepted: %', v_conflict;
  END IF;

  -- An admission change must not hide a previously committed request.
  v_replay := public.enqueue_paid_analysis_job_v2(
    '__idempotency_user_a__',
    '__idempotency_denied_replay_job__',
    'idempotency-request-a-0001',
    pg_catalog.repeat('a', 64),
    2,
    'game.sgf',
    'ko',
    '(;GM[1]SZ[19];B[pd])',
    pg_catalog.repeat('b', 64),
    20,
    false,
    'MOCK_ANALYSIS_DISABLED',
    NULL
  );
  IF v_replay->>'code' <> 'ALREADY_ENQUEUED' THEN
    RAISE EXCEPTION 'admission blocked exact replay: %', v_replay;
  END IF;

  v_denied := public.enqueue_paid_analysis_job_v2(
    '__idempotency_user_a__',
    '__idempotency_denied_new_job__',
    'idempotency-request-a-0002',
    pg_catalog.repeat('d', 64),
    2,
    'game.sgf',
    'ko',
    '(;GM[1]SZ[19];B[dd])',
    pg_catalog.repeat('e', 64),
    20,
    false,
    'MOCK_ANALYSIS_DISABLED',
    NULL
  );
  IF v_denied->>'code' <> 'MOCK_ANALYSIS_DISABLED' THEN
    RAISE EXCEPTION 'new denied request was admitted: %', v_denied;
  END IF;

  SELECT credits INTO v_credits
  FROM public.profiles
  WHERE id = '__idempotency_user_a__';
  IF v_credits <> 8 THEN
    RAISE EXCEPTION 'expected exactly one debit (credits=8), got %', v_credits;
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.analysis_jobs WHERE user_id = '__idempotency_user_a__') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one analysis job';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
    FROM public.credit_logs
    WHERE user_id = '__idempotency_user_a__' AND type = 'usage'
  ) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one usage ledger row';
  END IF;
END;
$idempotency_contract$;

-- Request IDs are scoped to one wallet owner, not globally.
SELECT public.ensure_profile_with_signup_bonus('__idempotency_user_b__', NULL, NULL);
DO $owner_scope$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.enqueue_paid_analysis_job_v2(
    '__idempotency_user_b__',
    '__idempotency_owner_b_job__',
    'idempotency-request-a-0001',
    pg_catalog.repeat('f', 64),
    1,
    'other.sgf',
    'ja',
    '(;GM[1]SZ[19];B[dd])',
    pg_catalog.repeat('1', 64),
    20,
    false,
    NULL,
    NULL
  );
  IF v_result->>'code' <> 'OK' THEN
    RAISE EXCEPTION 'owner-scoped request id was rejected: %', v_result;
  END IF;
END;
$owner_scope$;

-- Independently prove the physical owner/request unique index, rather than
-- relying only on profile-row serialization inside the RPC.
DO $unique_index_contract$
DECLARE
  v_constraint_name text;
BEGIN
  BEGIN
    INSERT INTO public.analysis_jobs (
      id, user_id, request_id, request_fingerprint, status
    ) VALUES (
      '__idempotency_duplicate_index_probe__',
      '__idempotency_user_a__',
      'idempotency-request-a-0001',
      pg_catalog.repeat('9', 64),
      'queued'
    );
    RAISE EXCEPTION 'owner/request duplicate insert unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
      IF v_constraint_name <> 'analysis_jobs_user_request_id_unique' THEN
        RAISE EXCEPTION 'unexpected unique constraint rejected probe: %', v_constraint_name;
      END IF;
  END;
END;
$unique_index_contract$;

ROLLBACK;
