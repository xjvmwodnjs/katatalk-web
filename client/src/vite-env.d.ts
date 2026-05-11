/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_PROVIDER?: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_APP_ID?: string;
  readonly VITE_OAUTH_PORTAL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
