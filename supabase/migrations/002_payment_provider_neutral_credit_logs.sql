-- Provider 중립 결제 메타데이터 (stripe_* 컬럼은 과거 Stripe 전용 — 삭제하지 않음)
-- 신규 충전 기록은 payment_* 및 idempotency_key = 'payment:<provider>:<event_or_order>' 권장

ALTER TABLE public.credit_logs
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS payment_event_id text,
  ADD COLUMN IF NOT EXISTS payment_order_id text,
  ADD COLUMN IF NOT EXISTS payment_checkout_id text;

CREATE INDEX IF NOT EXISTS credit_logs_payment_event_idx ON public.credit_logs (payment_provider, payment_event_id);
CREATE INDEX IF NOT EXISTS credit_logs_payment_order_idx ON public.credit_logs (payment_provider, payment_order_id);

COMMENT ON COLUMN public.credit_logs.stripe_event_id IS 'legacy: Stripe 전용 이벤트 id (과거 데이터 호환)';
COMMENT ON COLUMN public.credit_logs.stripe_session_id IS 'legacy: Stripe Checkout session id (과거 데이터 호환)';
COMMENT ON COLUMN public.credit_logs.payment_provider IS '결제사 식별자 (예: toss, lemonsqueezy)';
COMMENT ON COLUMN public.credit_logs.payment_event_id IS '웹훅/이벤트 단위 고유 id (idempotency 보조)';
COMMENT ON COLUMN public.credit_logs.payment_order_id IS '주문/결제 건 id';
COMMENT ON COLUMN public.credit_logs.payment_checkout_id IS '체크아웃 세션 id (결제사별)';

-- ─── RPC: add_credits_from_payment (provider 중립 idempotency) ───
CREATE OR REPLACE FUNCTION public.add_credits_from_payment(
  p_user_id text,
  p_amount integer,
  p_idempotency_key text,
  p_payment_provider text,
  p_payment_event_id text,
  p_payment_order_id text,
  p_payment_checkout_id text,
  p_description text
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
  IF p_amount IS NULL OR p_amount < 1 THEN
    RETURN jsonb_build_object('ok', false, 'duplicate', false, 'credits', NULL);
  END IF;

  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RETURN jsonb_build_object('ok', false, 'duplicate', false, 'credits', NULL, 'error', 'MISSING_IDEMPOTENCY_KEY');
  END IF;

  SELECT id INTO v_existing FROM public.credit_logs WHERE idempotency_key = p_idempotency_key LIMIT 1;
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
    payment_provider,
    payment_event_id,
    payment_order_id,
    payment_checkout_id,
    idempotency_key,
    metadata
  )
  VALUES (
    p_user_id,
    p_amount,
    'refill',
    COALESCE(p_description, '결제 충전'),
    NULL,
    NULL,
    p_payment_provider,
    p_payment_event_id,
    p_payment_order_id,
    p_payment_checkout_id,
    p_idempotency_key,
    jsonb_build_object(
      'payment_provider', p_payment_provider,
      'payment_event_id', p_payment_event_id,
      'payment_order_id', p_payment_order_id
    )
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'credits', v_credits, 'log_id', v_log_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_credits_from_payment(
  text, integer, text, text, text, text, text, text
) TO service_role;
