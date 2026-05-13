-- KataTalk: analysis_jobs queued 행을 원자적으로 claim (running) — 다중 worker 안전
-- Supabase SQL Editor 또는 마이그레이션 파이프라인으로 적용 후 README 체크리스트 반영

CREATE OR REPLACE FUNCTION public.claim_next_analysis_job()
RETURNS public.analysis_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.analysis_jobs;
  v_id text;
BEGIN
  SELECT aj.id
  INTO v_id
  FROM public.analysis_jobs aj
  WHERE aj.status = 'queued'
  ORDER BY aj.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.analysis_jobs j
  SET
    status = 'running',
    progress = GREATEST(COALESCE(j.progress, 0), 1)
  WHERE j.id = v_id
  RETURNING * INTO STRICT r;

  RETURN r;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_next_analysis_job() TO service_role;
