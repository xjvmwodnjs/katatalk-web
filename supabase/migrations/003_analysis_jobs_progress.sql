-- 진행률(폴링 UI용). 실패 시에는 NULL 허용.
ALTER TABLE public.analysis_jobs
  ADD COLUMN IF NOT EXISTS progress integer;

COMMENT ON COLUMN public.analysis_jobs.progress IS 'queued/running 동안 0–100; failed 시 NULL 가능';
