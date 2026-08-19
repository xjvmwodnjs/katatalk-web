export type AuthProviderName =
  | "local-dev"
  | "legacy-manus"
  | "supabase"
  | "clerk";

function readAuthProvider(): AuthProviderName {
  const raw = process.env.AUTH_PROVIDER?.trim();
  const isProd = process.env.NODE_ENV === "production";
  if (raw === "local-dev" || raw === "legacy-manus") {
    if (isProd) {
      throw new Error(
        "AUTH_PROVIDER=local-dev 또는 legacy-manus 는 운영(production) 환경에서 사용할 수 없습니다."
      );
    }
    return raw;
  }
  if (raw === "supabase") {
    if (isProd) {
      throw new Error(
        "AUTH_PROVIDER=supabase(Legacy Supabase Auth) 는 운영(production) 환경에서 사용할 수 없습니다."
      );
    }
    return "supabase";
  }
  if (raw === "clerk") {
    return "clerk";
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
  supabaseAnonKey:
    process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "",
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
  lemonsqueezyCreditPackProVariantId:
    process.env.LEMONSQUEEZY_CREDIT_PACK_PRO_VARIANT_ID ?? "",
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
};

const LOCAL_DEV_FALLBACK_JWT_SECRET =
  "local-dev-only-insecure-secret-do-not-use-in-production";

function requireProdNonEmpty(name: string, value: string | undefined): string {
  const t = value?.trim();
  if (!t) {
    throw new Error(`운영(production) 환경 변수가 누락되었습니다: ${name}`);
  }
  return t;
}

/**
 * NODE_ENV=production 일 때 필수 변수·정책 검증. 값은 로그에 넣지 않고 변수명만 안내.
 */
export function validateProductionDeploymentEnv(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  requireProdNonEmpty("AUTH_PROVIDER", process.env.AUTH_PROVIDER);
  if (process.env.AUTH_PROVIDER?.trim() !== "clerk") {
    throw new Error(
      "운영(production)에서는 AUTH_PROVIDER=clerk 만 허용됩니다."
    );
  }

  requireProdNonEmpty("VITE_AUTH_PROVIDER", process.env.VITE_AUTH_PROVIDER);
  if (process.env.VITE_AUTH_PROVIDER?.trim() !== "clerk") {
    throw new Error(
      "운영(production)에서는 VITE_AUTH_PROVIDER=clerk 가 필요합니다."
    );
  }
  requireProdNonEmpty(
    "VITE_CLERK_PUBLISHABLE_KEY",
    process.env.VITE_CLERK_PUBLISHABLE_KEY
  );

  requireProdNonEmpty("CLERK_SECRET_KEY", process.env.CLERK_SECRET_KEY);
  requireProdNonEmpty("JWT_SECRET", process.env.JWT_SECRET);

  requireProdNonEmpty("SUPABASE_URL", process.env.SUPABASE_URL);
  requireProdNonEmpty(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const analysisWorkerMode = requireProdNonEmpty(
    "ANALYSIS_WORKER_MODE",
    process.env.ANALYSIS_WORKER_MODE
  ).toLowerCase();
  if (analysisWorkerMode !== "external") {
    throw new Error(
      "운영(production)에서는 ANALYSIS_WORKER_MODE=external 만 허용됩니다."
    );
  }
  if (process.env.KATATALK_ATOMIC_ENQUEUE?.trim().toLowerCase() === "false") {
    throw new Error(
      "운영(production)에서는 KATATALK_ATOMIC_ENQUEUE=false 를 사용할 수 없습니다."
    );
  }
  if (
    process.env.ANALYSIS_IDEMPOTENCY_KEY_REQUIRED?.trim().toLowerCase() !==
    "true"
  ) {
    throw new Error(
      "운영(production)에서는 ANALYSIS_IDEMPOTENCY_KEY_REQUIRED=true 가 필요합니다."
    );
  }

  requireProdNonEmpty("LEMONSQUEEZY_API_KEY", process.env.LEMONSQUEEZY_API_KEY);
  requireProdNonEmpty(
    "LEMONSQUEEZY_STORE_ID",
    process.env.LEMONSQUEEZY_STORE_ID
  );
  requireProdNonEmpty(
    "LEMONSQUEEZY_WEBHOOK_SECRET",
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET
  );
  requireProdNonEmpty(
    "LEMONSQUEEZY_CREDIT_PACK_STARTER_VARIANT_ID",
    process.env.LEMONSQUEEZY_CREDIT_PACK_STARTER_VARIANT_ID
  );
  requireProdNonEmpty(
    "LEMONSQUEEZY_CREDIT_PACK_STANDARD_VARIANT_ID",
    process.env.LEMONSQUEEZY_CREDIT_PACK_STANDARD_VARIANT_ID
  );
  requireProdNonEmpty(
    "LEMONSQUEEZY_CREDIT_PACK_PRO_VARIANT_ID",
    process.env.LEMONSQUEEZY_CREDIT_PACK_PRO_VARIANT_ID
  );

  const baseUrl = requireProdNonEmpty("APP_BASE_URL", process.env.APP_BASE_URL);
  const lower = baseUrl.toLowerCase();
  if (
    lower.startsWith("http://localhost") ||
    lower.startsWith("http://127.0.0.1")
  ) {
    throw new Error(
      "운영(production) APP_BASE_URL 은 http://localhost 또는 loopback 을 사용할 수 없습니다."
    );
  }
  if (!lower.startsWith("https://")) {
    throw new Error(
      "운영(production) APP_BASE_URL 은 https:// 로 시작해야 합니다."
    );
  }
}

/**
 * Validate the separately deployed analysis worker. The worker only needs the
 * queue/database contract, not browser authentication or payment secrets.
 */
export function validateProductionAnalysisWorkerEnv(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  requireProdNonEmpty("SUPABASE_URL", process.env.SUPABASE_URL);
  requireProdNonEmpty(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const mode = requireProdNonEmpty(
    "ANALYSIS_WORKER_MODE",
    process.env.ANALYSIS_WORKER_MODE
  ).toLowerCase();
  if (mode !== "external") {
    throw new Error(
      "운영(production) Worker에서는 ANALYSIS_WORKER_MODE=external 만 허용됩니다."
    );
  }
  if (process.env.KATATALK_ATOMIC_ENQUEUE?.trim().toLowerCase() === "false") {
    throw new Error(
      "운영(production) Worker에서는 KATATALK_ATOMIC_ENQUEUE=false 를 사용할 수 없습니다."
    );
  }
}

/** Production 에서만 mock 분석 허용 여부를 KATATALK_ALLOW_MOCK_ANALYSIS 로 제어 */
export function isMockAnalysisAllowed(): boolean {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  if (nodeEnv !== "production") {
    return true;
  }
  return process.env.KATATALK_ALLOW_MOCK_ANALYSIS?.trim() === "true";
}

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
    validateProductionDeploymentEnv();
  }

  if (
    ENV.authProvider === "legacy-manus" &&
    (!ENV.appId || !ENV.oAuthServerUrl)
  ) {
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

  if (
    ENV.authProvider === "supabase" &&
    !ENV.databaseUrl &&
    !ENV.isProduction
  ) {
    console.warn(
      "[env] supabase 모드인데 DATABASE_URL 없음 — 사용자 동기화가 실패할 수 있습니다."
    );
  }

  if (ENV.authProvider === "clerk") {
    if (!ENV.clerkSecretKey) {
      throw new Error(
        "AUTH_PROVIDER=clerk 일 때 CLERK_SECRET_KEY 가 필요합니다."
      );
    }
  }

  if (
    ENV.authProvider === "clerk" &&
    !ENV.databaseUrl?.trim() &&
    !ENV.isProduction
  ) {
    console.warn(
      "[env] clerk 모드인데 DATABASE_URL 없음 — MySQL users 동기화는 생략되며, Clerk 인증·Supabase profiles 크레딧은 동작할 수 있습니다."
    );
  }

  if (
    !ENV.isProduction &&
    (!ENV.supabaseUrl.trim() || !ENV.supabaseServiceRoleKey.trim())
  ) {
    console.warn(
      "[env] SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음 — 크레딧·분석 과금 API는 해당 기능 호출 시 한국어 안내와 함께 실패할 수 있습니다."
    );
  }
}
