-- KataTalk: analysis_jobs 에 SGF 원문·무결성 메타 저장 (MVP — 운영 규모 확대 시 Storage 분리 검토)

ALTER TABLE public.analysis_jobs
  ADD COLUMN IF NOT EXISTS sgf_content text,
  ADD COLUMN IF NOT EXISTS sgf_sha256 text,
  ADD COLUMN IF NOT EXISTS sgf_size_bytes integer;

COMMENT ON COLUMN public.analysis_jobs.sgf_content IS 'MVP: 검증된 SGF 전체 텍스트. 대용량 시 Supabase Storage/S3 등으로 이전 예정';
COMMENT ON COLUMN public.analysis_jobs.sgf_sha256 IS 'UTF-8 바이트 기준 SHA-256 hex (중복·디버깅용)';
COMMENT ON COLUMN public.analysis_jobs.sgf_size_bytes IS 'UTF-8 인코딩 바이트 길이';
