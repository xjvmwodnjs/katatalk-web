-- KataTalk: user-requested purge of SGF and analysis payloads while preserving billing audit rows.

ALTER TABLE public.analysis_jobs
  ADD COLUMN IF NOT EXISTS data_purged_at timestamptz;

COMMENT ON COLUMN public.analysis_jobs.data_purged_at IS
  'User-requested or retention-policy purge time. SGF, result, filename, and SGF integrity metadata are cleared.';

CREATE INDEX IF NOT EXISTS analysis_jobs_data_purged_idx
  ON public.analysis_jobs (data_purged_at)
  WHERE data_purged_at IS NOT NULL;
