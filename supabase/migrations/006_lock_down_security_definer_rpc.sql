-- KataTalk: SECURITY DEFINER RPC 실행 권한 잠금
-- anon / authenticated / PUBLIC 이 크레딧·큐 claim RPC 를 직접 호출하지 못하도록 REVOKE.
-- 서버(Express)는 Supabase service_role JWT 만 사용해 RPC 를 호출해야 함.
-- 기존 함수 본문·RLS 는 변경하지 않음.

-- ─── 001: 크레딧·프로필 RPC ───
REVOKE EXECUTE ON FUNCTION public.ensure_profile_with_signup_bonus(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_profile_with_signup_bonus(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ensure_profile_with_signup_bonus(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_profile_with_signup_bonus(text, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.spend_credit_for_analysis(text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.spend_credit_for_analysis(text, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.spend_credit_for_analysis(text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.spend_credit_for_analysis(text, text, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.refund_credit_for_analysis(text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refund_credit_for_analysis(text, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.refund_credit_for_analysis(text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credit_for_analysis(text, text, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.add_credits_from_stripe(text, integer, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_credits_from_stripe(text, integer, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.add_credits_from_stripe(text, integer, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.add_credits_from_stripe(text, integer, text, text, text) TO service_role;

-- ─── 002: 결제 provider 중립 충전 RPC ───
REVOKE EXECUTE ON FUNCTION public.add_credits_from_payment(text, integer, text, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_credits_from_payment(text, integer, text, text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.add_credits_from_payment(text, integer, text, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.add_credits_from_payment(text, integer, text, text, text, text, text, text) TO service_role;

-- ─── 004: 분석 job claim RPC ───
REVOKE EXECUTE ON FUNCTION public.claim_next_analysis_job() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_next_analysis_job() FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_next_analysis_job() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_analysis_job() TO service_role;
