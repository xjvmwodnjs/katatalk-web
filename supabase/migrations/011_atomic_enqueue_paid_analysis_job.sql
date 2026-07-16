-- Atomically debit credits and create the queued analysis job.
-- Apply after 010_analysis_job_retention.sql.

CREATE OR REPLACE FUNCTION public.enqueue_paid_analysis_job(
  p_user_id text,
  p_analysis_job_id text,
  p_cost integer,
  p_file_name text,
  p_language text,
  p_sgf_content text,
  p_sgf_sha256 text,
  p_sgf_size_bytes integer,
  p_is_mock boolean,
  p_data_retention_until timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits integer;
  v_log_id uuid;
  v_existing_job public.analysis_jobs%ROWTYPE;
BEGIN
  IF p_cost IS NULL OR p_cost < 1 OR nullif(trim(p_analysis_job_id), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ARGUMENT');
  END IF;

  SELECT * INTO v_existing_job
  FROM public.analysis_jobs
  WHERE id = p_analysis_job_id;
  IF FOUND THEN
    IF v_existing_job.user_id <> p_user_id OR v_existing_job.credit_log_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'JOB_ID_CONFLICT');
    END IF;
    SELECT credits INTO v_credits FROM public.profiles WHERE id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_ENQUEUED', 'credits', v_credits, 'log_id', v_existing_job.credit_log_id);
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  END IF;

  UPDATE public.profiles
  SET credits = credits - p_cost, updated_at = now()
  WHERE id = p_user_id AND credits >= p_cost
  RETURNING credits INTO v_credits;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_CREDITS');
  END IF;

  INSERT INTO public.credit_logs (user_id, amount, type, description, analysis_job_id, idempotency_key, metadata)
  VALUES (p_user_id, -p_cost, 'usage', 'SGF analysis charge', p_analysis_job_id, 'usage:' || p_analysis_job_id, NULL)
  RETURNING id INTO v_log_id;

  INSERT INTO public.analysis_jobs (
    id, user_id, status, file_name, language, credit_cost, credit_log_id,
    is_mock, progress, sgf_content, sgf_sha256, sgf_size_bytes, data_retention_until
  ) VALUES (
    p_analysis_job_id, p_user_id, 'queued', p_file_name, p_language, p_cost, v_log_id,
    COALESCE(p_is_mock, true), 0, p_sgf_content, p_sgf_sha256, p_sgf_size_bytes, p_data_retention_until
  );

  RETURN jsonb_build_object('ok', true, 'code', 'OK', 'credits', v_credits, 'log_id', v_log_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_paid_analysis_job(text, text, integer, text, text, text, text, integer, boolean, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_paid_analysis_job(text, text, integer, text, text, text, text, integer, boolean, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.enqueue_paid_analysis_job(text, text, integer, text, text, text, text, integer, boolean, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_paid_analysis_job(text, text, integer, text, text, text, text, integer, boolean, timestamptz) TO service_role;
