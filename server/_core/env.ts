export type AuthProviderName = "local-dev" | "legacy-manus" | "supabase" | "clerk";

function readAuthProvider(): AuthProviderName {
  const raw = process.env.AUTH_PROVIDER?.trim();
  if (raw === "local-dev" || raw === "legacy-manus" || raw === "supabase" || raw === "clerk") {
    return raw;
  }
  return process.env.NODE_ENV === "production" ? "legacy-manus" : "local-dev";
}

export const ENV = {
  authProvider: readAuthProvider(),
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "",
  /** Clerk 서버 전용 — 프론트 번들에 포함 금지 */
  clerkSecretKey: process.env.CLERK_SECRET_KEY ?? "",
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

const LOCAL_DEV_FALLBACK_JWT_SECRET =
  "local-dev-only-insecure-secret-do-not-use-in-production";

export function getJwtSecret() {
  if (ENV.cookieSecret) {
    return ENV.cookieSecret;
  }
  if (!ENV.isProduction) {
    console.warn(
      "[env] JWT_SECRET 미설정 — 로컬 전용 고정값 사용. 운영 전 .env 에 설정하세요."
    );
    return LOCAL_DEV_FALLBACK_JWT_SECRET;
  }
  throw new Error("JWT_SECRET is required. Set it in .env before starting the server.");
}

export function validateServerEnv() {
  getJwtSecret();

  if (ENV.isProduction && ENV.authProvider === "local-dev") {
    console.warn(
      "[Auth] AUTH_PROVIDER=local-dev 는 데모용입니다. 상용 배포에 사용하지 마세요."
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
        "AUTH_PROVIDER=supabase 일 때 SUPABASE_URL 및 SUPABASE_ANON_KEY(또는 VITE_*)가 필요합니다."
      );
    }
  }

  if (ENV.isProduction && ENV.authProvider === "supabase" && !ENV.databaseUrl) {
    throw new Error("프로덕션 supabase 모드는 DATABASE_URL 이 필요합니다.");
  }

  if (ENV.authProvider === "supabase" && !ENV.databaseUrl && !ENV.isProduction) {
    console.warn("[env] supabase 모드인데 DATABASE_URL 없음 — 사용자 동기화가 실패할 수 있습니다.");
  }

  if (ENV.authProvider === "clerk") {
    if (!ENV.clerkSecretKey) {
      throw new Error("AUTH_PROVIDER=clerk 일 때 CLERK_SECRET_KEY 가 필요합니다.");
    }
  }

  if (ENV.authProvider === "clerk" && !ENV.databaseUrl?.trim() && !ENV.isProduction) {
    console.warn(
      "[env] clerk 모드인데 DATABASE_URL 없음 — Clerk 인증은 동작하며 사용자 행은 DB 연결 후 동기화됩니다."
    );
  }
}
