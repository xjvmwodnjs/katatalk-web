-- KataTalk: external analysis Worker liveness and last successful completion.
-- This is deliberately separate from analysis_jobs leases: an idle Worker is healthy.

CREATE TABLE IF NOT EXISTS public.analysis_worker_instances (
  instance_id uuid PRIMARY KEY,
  worker_id text NOT NULL,
  engine text NOT NULL CHECK (engine IN ('mock', 'katago')),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz
);

CREATE INDEX IF NOT EXISTS analysis_worker_instances_engine_heartbeat_idx
  ON public.analysis_worker_instances (engine, last_heartbeat_at DESC);

ALTER TABLE public.analysis_worker_instances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.analysis_worker_instances FROM PUBLIC;
REVOKE ALL ON TABLE public.analysis_worker_instances FROM anon;
REVOKE ALL ON TABLE public.analysis_worker_instances FROM authenticated;

CREATE OR REPLACE FUNCTION public.report_analysis_worker(
  p_instance_id uuid,
  p_worker_id text,
  p_engine text,
  p_success boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_instance_id IS NULL OR NULLIF(trim(p_worker_id), '') IS NULL THEN
    RAISE EXCEPTION 'analysis Worker instance_id and worker_id are required';
  END IF;
  IF p_engine NOT IN ('mock', 'katago') THEN
    RAISE EXCEPTION 'unsupported analysis Worker engine';
  END IF;

  INSERT INTO public.analysis_worker_instances (
    instance_id, worker_id, engine, last_success_at
  ) VALUES (
    p_instance_id, trim(p_worker_id), p_engine,
    CASE WHEN p_success THEN now() ELSE NULL END
  )
  ON CONFLICT (instance_id) DO UPDATE
  SET
    last_heartbeat_at = now(),
    last_success_at = CASE
      WHEN p_success THEN now()
      ELSE public.analysis_worker_instances.last_success_at
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_analysis_worker_health(
  p_engine text,
  p_stale_seconds integer DEFAULT 60
)
RETURNS TABLE (
  observed_at timestamptz,
  live_instances integer,
  last_heartbeat_at timestamptz,
  last_success_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stale_seconds integer := GREATEST(COALESCE(p_stale_seconds, 60), 1);
BEGIN
  IF p_engine NOT IN ('mock', 'katago') THEN
    RAISE EXCEPTION 'unsupported analysis Worker engine';
  END IF;

  RETURN QUERY
  SELECT
    now(),
    COUNT(*) FILTER (
      WHERE i.last_heartbeat_at >= now() - make_interval(secs => v_stale_seconds)
    )::integer,
    MAX(i.last_heartbeat_at),
    MAX(i.last_success_at)
  FROM public.analysis_worker_instances i
  WHERE i.engine = p_engine;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.report_analysis_worker(uuid, text, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.report_analysis_worker(uuid, text, text, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.report_analysis_worker(uuid, text, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.report_analysis_worker(uuid, text, text, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_analysis_worker_health(text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_analysis_worker_health(text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_analysis_worker_health(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_analysis_worker_health(text, integer) TO service_role;
