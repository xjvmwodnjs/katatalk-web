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
  /** Stripe — 서버 전용 secret, 프론트 번들에 포함 금지 */
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  /** Checkout line_items — 서버에서만 사용 (클라이언트가 price id를 보내지 않음) */
  stripeBasicPriceId: process.env.STRIPE_BASIC_PRICE_ID ?? "",
  stripePremiumPriceId: process.env.STRIPE_PREMIUM_PRICE_ID ?? "",
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

  if (ENV.isProduction && !ENV.databaseUrl?.trim()) {
    throw new Error(
      "운영(production) 환경에서는 크레딧·사용자 영속화를 위해 DATABASE_URL 이 필요합니다."
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
