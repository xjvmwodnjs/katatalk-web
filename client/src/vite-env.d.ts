/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_PROVIDER?: string;
  /** Toss 프론트 SDK 연동 시(선택). Secret 은 서버 전용 TOSS_SECRET_KEY */
  readonly VITE_TOSS_CLIENT_KEY?: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_APP_ID?: string;
  readonly VITE_OAUTH_PORTAL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
