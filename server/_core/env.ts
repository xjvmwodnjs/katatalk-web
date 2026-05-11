export type AuthProviderName = "local-dev" | "legacy-manus" | "supabase" | "clerk";

function readAuthProvider(): AuthProviderName {
  const raw = process.env.AUTH_PROVIDER?.trim();
  const isProd = process.env.NODE_ENV === "production";
  if (raw === "local-dev" || raw === "legacy-manus" || raw === "supabase" || raw === "clerk") {
    if (isProd && (raw === "local-dev" || raw === "legacy-manus")) {
      throw new Error(
        "AUTH_PROVIDER=local-dev 또는 legacy-manus 는 운영(production) 환경에서 사용할 수 없습니다."
      );
    }
    return raw;
  }
  if (isProd) {
    throw new Error(
      "운영(production) 환경에서는 AUTH_PROVIDER 를 명시적으로 설정해야 합니다. (예: AUTH_PROVIDER=clerk)"
    );
  }
  return "local-dev";
}

export const ENV = {
  authProvider: readAuthProvider(),
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
  /** 서버 전용 서비스 롤 — VITE_ 접두사 금지, 클라이언트에 노출 금지 */
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
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
  /** Toss — client key 는 프론트 SDK용으로 노출될 수 있음(문서 참고). secret 은 서버 전용, VITE_ 접두사 금지 */
  tossClientKey: process.env.TOSS_CLIENT_KEY ?? "",
  tossSecretKey: process.env.TOSS_SECRET_KEY ?? "",
  tossWebhookSecret: process.env.TOSS_WEBHOOK_SECRET ?? "",
  tossSuccessUrl: process.env.TOSS_SUCCESS_URL ?? "",
  tossFailUrl: process.env.TOSS_FAIL_URL ?? "",
  /** Lemon Squeezy — API 키·웹훅 시크릿은 서버 전용 */
  lemonsqueezyApiKey: process.env.LEMONSQUEEZY_API_KEY ?? "",
  lemonsqueezyStoreId: process.env.LEMONSQUEEZY_STORE_ID ?? "",
  lemonsqueezyWebhookSecret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "",
  lemonsqueezyCreditPackStarterVariantId:
    process.env.LEMONSQUEEZY_CREDIT_PACK_STARTER_VARIANT_ID ?? "",
  lemonsqueezyCreditPackStandardVariantId:
    process.env.LEMONSQUEEZY_CREDIT_PACK_STANDARD_VARIANT_ID ?? "",
  lemonsqueezyCreditPackProVariantId: process.env.LEMONSQUEEZY_CREDIT_PACK_PRO_VARIANT_ID ?? "",
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
};

const LOCAL_DEV_FALLBACK_JWT_SECRET =
  "local-dev-only-insecure-secret-do-not-use-in-production";

export function getJwtSecret() {
  const trimmed = ENV.cookieSecret.trim();
  if (trimmed) {
    return trimmed;
  }
  if (!ENV.isProduction && ENV.authProvider === "local-dev") {
    console.warn(
      "[env] JWT_SECRET 미설정 — local-dev 전용 고정값 사용. Clerk 등 다른 AUTH_PROVIDER 에서는 JWT_SECRET 이 필요합니다."
    );
    return LOCAL_DEV_FALLBACK_JWT_SECRET;
  }
  throw new Error(
    "JWT_SECRET 이 필요합니다. AUTH_PROVIDER=local-dev 가 아닌 경우 .env 에 JWT_SECRET 을 설정하세요."
  );
}

export function validateServerEnv() {
  getJwtSecret();

  if (ENV.isProduction) {
    if (!ENV.supabaseUrl.trim() || !ENV.supabaseServiceRoleKey.trim()) {
      throw new Error(
        "운영(production) 환경에서는 크레딧·작업 기록을 위해 SUPABASE_URL 및 SUPABASE_SERVICE_ROLE_KEY가 필요합니다."
      );
    }
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
      "[env] clerk 모드인데 DATABASE_URL 없음 — MySQL users 동기화는 생략되며, Clerk 인증·Supabase profiles 크레딧은 동작할 수 있습니다."
    );
  }

  if (!ENV.isProduction && (!ENV.supabaseUrl.trim() || !ENV.supabaseServiceRoleKey.trim())) {
    console.warn(
      "[env] SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음 — 크레딧·분석 과금 API는 해당 기능 호출 시 한국어 안내와 함께 실패할 수 있습니다."
    );
  }
}
