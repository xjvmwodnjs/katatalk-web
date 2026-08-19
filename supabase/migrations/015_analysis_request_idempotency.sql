-- Client-visible idempotency for paid analysis submission.
-- A lost HTTP 202 can be replayed without creating a second job or debit.

SET lock_timeout = '5s';

ALTER TABLE public.analysis_jobs
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS request_fingerprint text;

ALTER TABLE public.analysis_jobs
  DROP CONSTRAINT IF EXISTS analysis_jobs_request_id_pair;
ALTER TABLE public.analysis_jobs
  ADD CONSTRAINT analysis_jobs_request_id_pair CHECK (
    (request_id IS NULL AND request_fingerprint IS NULL)
    OR (
      request_id IS NOT NULL
      AND request_fingerprint IS NOT NULL
      AND char_length(request_id) BETWEEN 16 AND 128
      AND request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$'
      AND request_fingerprint ~ '^[0-9a-f]{64}$'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS analysis_jobs_user_request_id_unique
  ON public.analysis_jobs (user_id, request_id)
  WHERE request_id IS NOT NULL;

COMMENT ON COLUMN public.analysis_jobs.request_id IS
  'Opaque client submission id, unique within one wallet subject; contains no user data.';
COMMENT ON COLUMN public.analysis_jobs.request_fingerprint IS
  'Server SHA-256 over the admitted SGF hash and language; detects request-id payload conflicts.';

-- Keep the v1 overload from migration 011 during rolling deploys. New Web
-- instances use an explicitly named v2 RPC; old instances can drain without
-- seeing a missing-function error. The v1 RPC is removed only in a later,
-- separately gated migration after every Web instance has moved to v2.
CREATE FUNCTION public.enqueue_paid_analysis_job_v2(
  p_user_id text,
  p_analysis_job_id text,
  p_request_id text,
  p_request_fingerprint text,
  p_cost integer,
  p_file_name text,
  p_language text,
  p_sgf_content text,
  p_sgf_sha256 text,
  p_sgf_size_bytes integer,
  p_is_mock boolean,
  p_admission_code text,
  p_data_retention_until timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_credits integer;
  v_log_id uuid;
  v_existing_job public.analysis_jobs%ROWTYPE;
BEGIN
  IF p_cost IS NULL OR p_cost < 1
    OR nullif(pg_catalog.btrim(p_user_id), '') IS NULL
    OR nullif(pg_catalog.btrim(p_analysis_job_id), '') IS NULL
    OR p_request_id IS NULL
    OR pg_catalog.char_length(p_request_id) NOT BETWEEN 16 AND 128
    OR p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$'
    OR p_request_fingerprint IS NULL
    OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_language NOT IN ('ko', 'en', 'ja', 'zh')
    OR p_sgf_content IS NULL
    OR p_sgf_sha256 IS NULL
    OR p_sgf_sha256 !~ '^[0-9a-f]{64}$'
    OR p_sgf_size_bytes IS NULL
    OR p_sgf_size_bytes < 1
    OR p_sgf_size_bytes <> pg_catalog.octet_length(
      pg_catalog.convert_to(p_sgf_content, 'UTF8')
    )
    OR (
      p_admission_code IS NOT NULL
      AND p_admission_code NOT IN (
        'ANALYSIS_IDEMPOTENCY_UNAVAILABLE',
        'KATAGO_INLINE_FORBIDDEN',
        'MOCK_ANALYSIS_DISABLED'
      )
    )
  THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INVALID_ARGUMENT');
  END IF;

  -- Serializing on the wallet row makes same-user concurrent replays exact.
  SELECT credits INTO v_credits
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  END IF;

  SELECT * INTO v_existing_job
  FROM public.analysis_jobs
  WHERE user_id = p_user_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing_job.request_fingerprint <> p_request_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object(
        'ok', false,
        'code', 'IDEMPOTENCY_CONFLICT'
      );
    END IF;
    IF v_existing_job.credit_log_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.credit_logs AS l
      WHERE l.id = v_existing_job.credit_log_id
        AND l.user_id = v_existing_job.user_id
        AND l.analysis_job_id = v_existing_job.id
        AND l.type = 'usage'
        AND l.amount = -v_existing_job.credit_cost
    ) THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'LEDGER_INVARIANT');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'ok', true,
      'code', 'ALREADY_ENQUEUED',
      'credits', v_credits,
      'log_id', v_existing_job.credit_log_id,
      'job_id', v_existing_job.id,
      'job_status', v_existing_job.status,
      'replayed', true
    );
  END IF;

  -- Admission is checked after exact replay, but before any debit or insert.
  IF p_admission_code IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', p_admission_code
    );
  END IF;

  SELECT * INTO v_existing_job
  FROM public.analysis_jobs
  WHERE id = p_analysis_job_id;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'JOB_ID_CONFLICT');
  END IF;

  UPDATE public.profiles
  SET credits = credits - p_cost, updated_at = pg_catalog.now()
  WHERE id = p_user_id AND credits >= p_cost
  RETURNING credits INTO v_credits;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_CREDITS');
  END IF;

  INSERT INTO public.credit_logs (
    user_id, amount, type, description, analysis_job_id, idempotency_key, metadata
  ) VALUES (
    p_user_id, -p_cost, 'usage', 'SGF analysis charge', p_analysis_job_id,
    'usage:' || p_analysis_job_id, NULL
  )
  RETURNING id INTO v_log_id;

  INSERT INTO public.analysis_jobs (
    id, user_id, request_id, request_fingerprint, status, file_name, language,
    credit_cost, credit_log_id, is_mock, progress, sgf_content, sgf_sha256,
    sgf_size_bytes, data_retention_until
  ) VALUES (
    p_analysis_job_id, p_user_id, p_request_id, p_request_fingerprint, 'queued',
    p_file_name, p_language, p_cost, v_log_id, COALESCE(p_is_mock, true), 0,
    p_sgf_content, p_sgf_sha256, p_sgf_size_bytes, p_data_retention_until
  );

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'code', 'OK',
    'credits', v_credits,
    'log_id', v_log_id,
    'job_id', p_analysis_job_id,
    'job_status', 'queued',
    'replayed', false
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'JOB_ID_CONFLICT');
END;
$$;

-- Match migration 013's portable ownership rule instead of assuming the
-- hosted database owner is named `postgres`.
DO $function_acl$
DECLARE
  v_application_owner name;
  v_grantee name;
  v_signature text :=
    'public.enqueue_paid_analysis_job_v2(text, text, text, text, integer, text, text, text, text, integer, boolean, text, timestamp with time zone)';
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
$function_acl$;

RESET lock_timeout;
