-- KataTalk: analysis_jobs worker lease / stale running recovery / attempt limits
-- claim_next_analysis_job 시그니처 변경: (p_worker_id, p_stale_seconds) — 004 의 무인자 버전은 DROP 후 대체

ALTER TABLE public.analysis_jobs
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text;

COMMENT ON COLUMN public.analysis_jobs.locked_at IS 'Worker claim 시각; running stale 판단에 사용';
COMMENT ON COLUMN public.analysis_jobs.locked_by IS 'claim_next_analysis_job 에 전달된 worker 식별자';
COMMENT ON COLUMN public.analysis_jobs.attempt_count IS 'claim(처리 시작) 횟수; stale 재claim 시 증가';
COMMENT ON COLUMN public.analysis_jobs.max_attempts IS 'attempt_count 가 이 값 이상이면 stale running 은 failed 전환만(추가 claim 불가)';
COMMENT ON COLUMN public.analysis_jobs.next_retry_at IS 'queued 재시도 대기 종료 시각(null 이면 즉시 claim 가능)';
COMMENT ON COLUMN public.analysis_jobs.last_error_code IS '실패·중단 시 짧은 코드(예: MAX_ATTEMPTS_EXCEEDED)';

ALTER TABLE public.analysis_jobs
  DROP CONSTRAINT IF EXISTS analysis_jobs_max_attempts_positive;
ALTER TABLE public.analysis_jobs
  ADD CONSTRAINT analysis_jobs_max_attempts_positive CHECK (max_attempts >= 1);

ALTER TABLE public.analysis_jobs
  DROP CONSTRAINT IF EXISTS analysis_jobs_attempt_count_nonnegative;
ALTER TABLE public.analysis_jobs
  ADD CONSTRAINT analysis_jobs_attempt_count_nonnegative CHECK (attempt_count >= 0);

-- 기존 running 행에 잠금 시각이 없으면 즉시 stale 로 간주되므로 updated_at 기준으로 backfill
UPDATE public.analysis_jobs j
SET
  locked_at = COALESCE(j.locked_at, j.updated_at, j.created_at),
  locked_by = COALESCE(j.locked_by, '007_backfill')
WHERE j.status = 'running'
  AND j.locked_at IS NULL;

DROP FUNCTION IF EXISTS public.claim_next_analysis_job();

CREATE OR REPLACE FUNCTION public.claim_next_analysis_job(
  p_worker_id text,
  p_stale_seconds integer DEFAULT 900
)
RETURNS public.analysis_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.analysis_jobs;
  v_id text;
  v_wid text;
  v_stale interval;
  v_rec record;
BEGIN
  v_wid := COALESCE(NULLIF(trim(p_worker_id), ''), 'unknown');
  IF p_stale_seconds IS NULL OR p_stale_seconds < 1 THEN
    v_stale := interval '900 seconds';
  ELSE
    v_stale := make_interval(secs => p_stale_seconds);
  END IF;

  -- stale running 이고 시도 상한에 도달한 job: failed 로 전환 후 환불( idempotent refund RPC )
  FOR v_rec IN
    WITH u AS (
      UPDATE public.analysis_jobs j
      SET
        status = 'failed',
        progress = NULL,
        error_message = 'MAX_ATTEMPTS_EXCEEDED: worker lease exhausted',
        last_error_code = 'MAX_ATTEMPTS_EXCEEDED',
        completed_at = now(),
        locked_at = NULL,
        locked_by = NULL,
        next_retry_at = NULL
      WHERE j.status = 'running'
        AND (j.locked_at IS NULL OR j.locked_at < now() - v_stale)
        AND j.attempt_count >= j.max_attempts
      RETURNING j.id AS id, j.user_id AS user_id, j.credit_cost AS credit_cost
    )
    SELECT * FROM u
  LOOP
    PERFORM public.refund_credit_for_analysis(
      v_rec.user_id,
      v_rec.id,
      GREATEST(COALESCE(v_rec.credit_cost, 1), 1)
    );
  END LOOP;

  SELECT aj.id
  INTO v_id
  FROM public.analysis_jobs aj
  WHERE
    (
      aj.status = 'queued'
      AND (aj.next_retry_at IS NULL OR aj.next_retry_at <= now())
      AND aj.attempt_count < aj.max_attempts
    )
    OR
    (
      aj.status = 'running'
      AND (aj.locked_at IS NULL OR aj.locked_at < now() - v_stale)
      AND aj.attempt_count < aj.max_attempts
    )
  ORDER BY aj.created_at ASC
  LIMIT 1
  FOR UPDATE OF aj SKIP LOCKED;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.analysis_jobs j
  SET
    status = 'running',
    progress = GREATEST(COALESCE(j.progress, 0), 1),
    locked_at = now(),
    locked_by = v_wid,
    attempt_count = j.attempt_count + 1,
    completed_at = NULL,
    error_message = NULL,
    last_error_code = NULL
  WHERE j.id = v_id
  RETURNING * INTO STRICT r;

  RETURN r;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_next_analysis_job(text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_next_analysis_job(text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_next_analysis_job(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_analysis_job(text, integer) TO service_role;
