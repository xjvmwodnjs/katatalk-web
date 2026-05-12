-- KataTalk: Clerk userId 기반 profiles + credit_logs + analysis_jobs + RPC
-- Supabase SQL Editor 또는 supabase db push 로 적용

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── profiles ───
CREATE TABLE IF NOT EXISTS public.profiles (
  id text PRIMARY KEY,
  email text,
  name text,
  credits integer NOT NULL DEFAULT 2,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─── credit_logs ───
CREATE TABLE IF NOT EXISTS public.credit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  amount integer NOT NULL,
  type text NOT NULL,
  description text,
  stripe_event_id text,
  stripe_session_id text,
  analysis_job_id text,
  idempotency_key text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_logs_type_check CHECK (
    type IN ('signup_bonus', 'refill', 'usage', 'refund', 'admin_adjustment')
  ),
  CONSTRAINT credit_logs_idempotency_key_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS credit_logs_user_created_idx ON public.credit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_logs_stripe_event_idx ON public.credit_logs (stripe_event_id);
CREATE INDEX IF NOT EXISTS credit_logs_stripe_session_idx ON public.credit_logs (stripe_session_id);
CREATE INDEX IF NOT EXISTS credit_logs_idempotency_idx ON public.credit_logs (idempotency_key);

-- ─── analysis_jobs ───
CREATE TABLE IF NOT EXISTS public.analysis_jobs (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  status text NOT NULL,
  file_name text,
  language text,
  credit_cost integer NOT NULL DEFAULT 1,
  credit_log_id uuid REFERENCES public.credit_logs (id) ON DELETE SET NULL,
  result jsonb,
  error_message text,
  is_mock boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT analysis_jobs_status_check CHECK (
    status IN ('queued', 'running', 'completed', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS analysis_jobs_user_created_idx ON public.analysis_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analysis_jobs_status_created_idx ON public.analysis_jobs (status, created_at);

-- ─── updated_at trigger ───
CREATE OR REPLACE FUNCTION public.katatalk_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.katatalk_set_updated_at();

DROP TRIGGER IF EXISTS analysis_jobs_set_updated_at ON public.analysis_jobs;
CREATE TRIGGER analysis_jobs_set_updated_at
  BEFORE UPDATE ON public.analysis_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.katatalk_set_updated_at();

-- ─── RLS (클라이언트 직접 접근 없음 — 서비스 롤은 RLS 우회) ───
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;

-- ─── RPC: ensure_profile_with_signup_bonus ───
CREATE OR REPLACE FUNCTION public.ensure_profile_with_signup_bonus(
  p_user_id text,
  p_email text,
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits integer;
  v_bonus_rows integer := 0;
BEGIN
  INSERT INTO public.profiles (id, email, name, credits)
  VALUES (p_user_id, p_email, p_name, 2)
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    name = COALESCE(EXCLUDED.name, public.profiles.name),
    updated_at = now();

  INSERT INTO public.credit_logs (
    user_id,
    amount,
    type,
    description,
    idempotency_key,
    metadata
  )
  VALUES (
    p_user_id,
    2,
    'signup_bonus',
    '가입 보너스 크레딧',
    'signup_bonus:' || p_user_id,
    NULL
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_bonus_rows = ROW_COUNT;
  SELECT credits INTO v_credits FROM public.profiles WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'credits',
    v_credits,
    'signup_bonus_rows',
    v_bonus_rows
  );
END;
$$;

-- ─── RPC: spend_credit_for_analysis ───
CREATE OR REPLACE FUNCTION public.spend_credit_for_analysis(
  p_user_id text,
  p_analysis_job_id text,
  p_cost integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_credits integer;
  v_log_id uuid;
BEGIN
  IF p_cost IS NULL OR p_cost < 1 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_COST', 'credits', NULL, 'log_id', NULL);
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND', 'credits', NULL, 'log_id', NULL);
  END IF;

  SELECT id INTO v_existing
  FROM public.credit_logs
  WHERE idempotency_key = 'usage:' || p_analysis_job_id
  LIMIT 1;

  IF FOUND THEN
    SELECT credits INTO v_credits FROM public.profiles WHERE id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_SPENT', 'credits', v_credits, 'log_id', v_existing);
  END IF;

  UPDATE public.profiles
  SET credits = credits - p_cost, updated_at = now()
  WHERE id = p_user_id AND credits >= p_cost
  RETURNING credits INTO v_credits;

  IF NOT FOUND THEN
    SELECT credits INTO v_credits FROM public.profiles WHERE id = p_user_id;
    RETURN jsonb_build_object(
      'ok',
      false,
      'code',
      'INSUFFICIENT_CREDITS',
      'credits',
      v_credits,
      'log_id',
      NULL
    );
  END IF;

  INSERT INTO public.credit_logs (
    user_id,
    amount,
    type,
    description,
    analysis_job_id,
    idempotency_key,
    metadata
  )
  VALUES (
    p_user_id,
    -p_cost,
    'usage',
    'SGF 분석 차감',
    p_analysis_job_id,
    'usage:' || p_analysis_job_id,
    NULL
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object('ok', true, 'code', 'OK', 'credits', v_credits, 'log_id', v_log_id);
END;
$$;

-- ─── RPC: refund_credit_for_analysis ───
CREATE OR REPLACE FUNCTION public.refund_credit_for_analysis(
  p_user_id text,
  p_analysis_job_id text,
  p_amount integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dup uuid;
  v_credits integer;
  v_log_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount < 1 THEN
    RETURN jsonb_build_object('ok', false, 'credits', NULL, 'log_id', NULL);
  END IF;

  SELECT id INTO v_dup
  FROM public.credit_logs
  WHERE idempotency_key = 'refund:' || p_analysis_job_id
  LIMIT 1;

  IF FOUND THEN
    SELECT credits INTO v_credits FROM public.profiles WHERE id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'credits', v_credits, 'log_id', v_dup);
  END IF;

  SELECT id INTO v_dup
  FROM public.credit_logs
  WHERE analysis_job_id = p_analysis_job_id AND type = 'usage'
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT credits INTO v_credits FROM public.profiles WHERE id = p_user_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_SPEND', 'credits', v_credits, 'log_id', NULL);
  END IF;

  UPDATE public.profiles
  SET credits = credits + p_amount, updated_at = now()
  WHERE id = p_user_id
  RETURNING credits INTO v_credits;

  INSERT INTO public.credit_logs (
    user_id,
    amount,
    type,
    description,
    analysis_job_id,
    idempotency_key,
    metadata
  )
  VALUES (
    p_user_id,
    p_amount,
    'refund',
    '분석 실패 환불',
    p_analysis_job_id,
    'refund:' || p_analysis_job_id,
    jsonb_build_object('reason', 'analysis_job_failed')
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'credits', v_credits, 'log_id', v_log_id);
END;
$$;

-- ─── RPC: add_credits_from_stripe ───
CREATE OR REPLACE FUNCTION public.add_credits_from_stripe(
  p_user_id text,
  p_amount integer,
  p_stripe_event_id text,
  p_stripe_session_id text,
  p_description text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_existing uuid;
  v_credits integer;
  v_log_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount < 1 THEN
    RETURN jsonb_build_object('ok', false, 'duplicate', false, 'credits', NULL);
  END IF;

  v_key := 'stripe:' || COALESCE(p_stripe_event_id, p_stripe_session_id);

  SELECT id INTO v_existing FROM public.credit_logs WHERE idempotency_key = v_key LIMIT 1;
  IF FOUND THEN
    SELECT credits INTO v_credits FROM public.profiles WHERE id = p_user_id;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'credits', v_credits, 'log_id', v_existing);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'duplicate', false, 'credits', NULL, 'error', 'PROFILE_NOT_FOUND');
  END IF;

  UPDATE public.profiles
  SET credits = credits + p_amount, updated_at = now()
  WHERE id = p_user_id
  RETURNING credits INTO v_credits;

  INSERT INTO public.credit_logs (
    user_id,
    amount,
    type,
    description,
    stripe_event_id,
    stripe_session_id,
    idempotency_key,
    metadata
  )
  VALUES (
    p_user_id,
    p_amount,
    'refill',
    COALESCE(p_description, 'Stripe 결제 충전'),
    p_stripe_event_id,
    p_stripe_session_id,
    v_key,
    NULL
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'credits', v_credits, 'log_id', v_log_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_profile_with_signup_bonus(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.spend_credit_for_analysis(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_credit_for_analysis(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_credits_from_stripe(text, integer, text, text, text) TO service_role;
