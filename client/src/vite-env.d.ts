/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_PROVIDER?: string;
  /** 표시·참고용. 실제 Checkout price 는 서버 STRIPE_*_PRICE_ID 만 사용 */
  readonly VITE_STRIPE_BASIC_PRICE_ID?: string;
  readonly VITE_STRIPE_PREMIUM_PRICE_ID?: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_APP_ID?: string;
  readonly VITE_OAUTH_PORTAL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
