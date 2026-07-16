-- KataTalk: opt-in retention expiration for SGF and analysis payloads only.

ALTER TABLE public.analysis_jobs
  ADD COLUMN IF NOT EXISTS data_retention_until timestamptz;

CREATE INDEX IF NOT EXISTS analysis_jobs_retention_due_idx
  ON public.analysis_jobs (data_retention_until)
  WHERE data_purged_at IS NULL AND data_retention_until IS NOT NULL;

CREATE OR REPLACE FUNCTION public.purge_expired_analysis_job_data(
  p_limit integer DEFAULT 100,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE (job_id text, purged boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
BEGIN
  IF p_dry_run THEN
    RETURN QUERY
    SELECT j.id, false
    FROM public.analysis_jobs j
    WHERE j.status IN ('completed', 'failed')
      AND j.data_purged_at IS NULL
      AND j.data_retention_until IS NOT NULL
      AND j.data_retention_until <= now()
    ORDER BY j.data_retention_until ASC
    LIMIT v_limit;
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT j.id
    FROM public.analysis_jobs j
    WHERE j.status IN ('completed', 'failed')
      AND j.data_purged_at IS NULL
      AND j.data_retention_until IS NOT NULL
      AND j.data_retention_until <= now()
    ORDER BY j.data_retention_until ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ), updated AS (
    UPDATE public.analysis_jobs j
    SET
      file_name = NULL,
      sgf_content = NULL,
      sgf_sha256 = NULL,
      sgf_size_bytes = NULL,
      result = NULL,
      data_purged_at = now()
    FROM candidates c
    WHERE j.id = c.id
    RETURNING j.id
  )
  SELECT u.id, true FROM updated u;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_expired_analysis_job_data(integer, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_expired_analysis_job_data(integer, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_expired_analysis_job_data(integer, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_analysis_job_data(integer, boolean) TO service_role;
