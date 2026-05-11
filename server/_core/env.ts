export type AuthProviderName = "local-dev" | "legacy-manus" | "supabase";

function readAuthProvider(): AuthProviderName {
  const raw = process.env.AUTH_PROVIDER?.trim();
  if (raw === "local-dev" || raw === "legacy-manus" || raw === "supabase") {
    return raw;
  }
  return process.env.NODE_ENV === "production" ? "legacy-manus" : "local-dev";
}

export const ENV = {
  authProvider: readAuthProvider(),
  /** 서버 전용 Supabase 프로젝트 URL (프론트 VITE_*와 동일 값을 넣어도 됨) */
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
  /** 서버에서 JWT 검증용 anon key만 사용. service_role은 사용하지 않음 */
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "",
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  enableLegacyManusStorage: process.env.ENABLE_LEGACY_MANUS_STORAGE === "true",
  localDevUserEmail: process.env.LOCAL_DEV_USER_EMAIL ?? "dev@katatalk.local",
  localDevUserName: process.env.LOCAL_DEV_USER_NAME ?? "Local Developer",
};

/** Only used when `JWT_SECRET` is unset in non-production (see `getJwtSecret`). */
const LOCAL_DEV_FALLBACK_JWT_SECRET =
  "local-dev-only-insecure-secret-do-not-use-in-production";

export function getJwtSecret() {
  if (ENV.cookieSecret) {
    return ENV.cookieSecret;
  }
  if (!ENV.isProduction) {
    console.warn(
      "[env] JWT_SECRET is unset. Using a fixed local-dev secret. Copy .env.example to .env and set JWT_SECRET for production-like signing."
    );
    return LOCAL_DEV_FALLBACK_JWT_SECRET;
  }
  throw new Error("JWT_SECRET is required. Set it in .env before starting the server.");
}

export function validateServerEnv() {
  getJwtSecret();

  if (ENV.isProduction && ENV.authProvider === "local-dev") {
    console.warn(
      "[Auth] AUTH_PROVIDER=local-dev is for local demos only. Do not deploy this configuration commercially."
    );
  }

  if (ENV.authProvider === "legacy-manus" && (!ENV.appId || !ENV.oAuthServerUrl)) {
    throw new Error(
      "AUTH_PROVIDER=legacy-manus requires VITE_APP_ID and OAUTH_SERVER_URL. Use AUTH_PROVIDER=local-dev for local development."
    );
  }

  if (ENV.authProvider === "supabase") {
    if (!ENV.supabaseUrl || !ENV.supabaseAnonKey) {
      throw new Error(
        "AUTH_PROVIDER=supabase 일 때 SUPABASE_URL(또는 VITE_SUPABASE_URL)과 SUPABASE_ANON_KEY(또는 VITE_SUPABASE_ANON_KEY)가 필요합니다."
      );
    }
  }

  if (ENV.isProduction && ENV.authProvider === "supabase" && !ENV.databaseUrl) {
    throw new Error(
      "프로덕션에서 AUTH_PROVIDER=supabase는 사용자 동기화를 위해 DATABASE_URL이 필요합니다."
    );
  }

  if (ENV.authProvider === "supabase" && !ENV.databaseUrl && !ENV.isProduction) {
    console.warn(
      "[env] Supabase 모드인데 DATABASE_URL이 없습니다. 사용자 upsert가 되지 않아 Bearer 검증 후에도 로그인이 실패할 수 있습니다."
    );
  }
}
