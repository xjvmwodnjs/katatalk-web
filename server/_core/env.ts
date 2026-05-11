export type AuthProviderName = "local-dev" | "legacy-manus";

function readAuthProvider(): AuthProviderName {
  const raw = process.env.AUTH_PROVIDER?.trim();
  if (raw === "local-dev" || raw === "legacy-manus") return raw;
  return process.env.NODE_ENV === "production" ? "legacy-manus" : "local-dev";
}

export const ENV = {
  authProvider: readAuthProvider(),
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

export function getJwtSecret() {
  if (!ENV.cookieSecret) {
    throw new Error("JWT_SECRET is required. Set it in .env before starting the server.");
  }
  return ENV.cookieSecret;
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
}
