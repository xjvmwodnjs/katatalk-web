import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { isMockAnalysisAllowed, validateProductionDeploymentEnv } from "./_core/env";

describe("validateProductionDeploymentEnv", () => {
  let backup: NodeJS.ProcessEnv;

  beforeEach(() => {
    backup = { ...process.env };
  });

  afterEach(() => {
    process.env = backup;
  });

  function minimalProdBase(): void {
    process.env.NODE_ENV = "production";
    process.env.AUTH_PROVIDER = "clerk";
    process.env.VITE_AUTH_PROVIDER = "clerk";
    process.env.VITE_CLERK_PUBLISHABLE_KEY = "pk_test_placeholder_not_real";
    process.env.JWT_SECRET = "vitest-jwt-secret-minimum-32-characters-long-x";
    process.env.CLERK_SECRET_KEY = "sk_test_placeholder_not_real";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service_role_placeholder";
    process.env.ANALYSIS_WORKER_MODE = "external";
    delete process.env.KATATALK_ATOMIC_ENQUEUE;
    process.env.LEMONSQUEEZY_API_KEY = "lemon_key";
    process.env.LEMONSQUEEZY_STORE_ID = "123";
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET = "whsec_placeholder_32chars______";
    process.env.LEMONSQUEEZY_CREDIT_PACK_STARTER_VARIANT_ID = "v1";
    process.env.LEMONSQUEEZY_CREDIT_PACK_STANDARD_VARIANT_ID = "v2";
    process.env.LEMONSQUEEZY_CREDIT_PACK_PRO_VARIANT_ID = "v3";
    process.env.APP_BASE_URL = "https://app.example.com";
  }

  it("no-op when NODE_ENV is not production", () => {
    process.env.NODE_ENV = "test";
    expect(() => validateProductionDeploymentEnv()).not.toThrow();
  });

  it("throws when AUTH_PROVIDER is local-dev in production", () => {
    minimalProdBase();
    process.env.AUTH_PROVIDER = "local-dev";
    expect(() => validateProductionDeploymentEnv()).toThrow(/AUTH_PROVIDER=clerk/);
  });

  it("throws when APP_BASE_URL is http://localhost", () => {
    minimalProdBase();
    process.env.APP_BASE_URL = "http://localhost:3000";
    expect(() => validateProductionDeploymentEnv()).toThrow(/localhost/);
  });

  it("throws when LEMONSQUEEZY_API_KEY is missing", () => {
    minimalProdBase();
    delete process.env.LEMONSQUEEZY_API_KEY;
    expect(() => validateProductionDeploymentEnv()).toThrow(/LEMONSQUEEZY_API_KEY/);
  });

  it("throws when VITE_CLERK_PUBLISHABLE_KEY is missing", () => {
    minimalProdBase();
    delete process.env.VITE_CLERK_PUBLISHABLE_KEY;
    expect(() => validateProductionDeploymentEnv()).toThrow(/VITE_CLERK_PUBLISHABLE_KEY/);
  });

  it("requires the external analysis worker in production", () => {
    minimalProdBase();
    process.env.ANALYSIS_WORKER_MODE = "inline";
    expect(() => validateProductionDeploymentEnv()).toThrow(/ANALYSIS_WORKER_MODE=external/);

    delete process.env.ANALYSIS_WORKER_MODE;
    expect(() => validateProductionDeploymentEnv()).toThrow(/ANALYSIS_WORKER_MODE/);
  });

  it("rejects disabling atomic enqueue in production", () => {
    minimalProdBase();
    process.env.KATATALK_ATOMIC_ENQUEUE = "false";
    expect(() => validateProductionDeploymentEnv()).toThrow(/KATATALK_ATOMIC_ENQUEUE=false/);
  });

  it("allows atomic enqueue when enabled or left at its safe default", () => {
    minimalProdBase();
    process.env.KATATALK_ATOMIC_ENQUEUE = "true";
    expect(() => validateProductionDeploymentEnv()).not.toThrow();

    delete process.env.KATATALK_ATOMIC_ENQUEUE;
    expect(() => validateProductionDeploymentEnv()).not.toThrow();
  });

  it("passes with minimal valid production env", () => {
    minimalProdBase();
    expect(() => validateProductionDeploymentEnv()).not.toThrow();
  });
});

describe("isMockAnalysisAllowed", () => {
  let backup: NodeJS.ProcessEnv;

  beforeEach(() => {
    backup = { ...process.env };
  });

  afterEach(() => {
    process.env = backup;
  });

  it("allows mock when not production", () => {
    process.env.NODE_ENV = "test";
    delete process.env.KATATALK_ALLOW_MOCK_ANALYSIS;
    expect(isMockAnalysisAllowed()).toBe(true);
  });

  it("disallows mock in production unless KATATALK_ALLOW_MOCK_ANALYSIS=true", () => {
    process.env.NODE_ENV = "production";
    process.env.KATATALK_ALLOW_MOCK_ANALYSIS = "false";
    expect(isMockAnalysisAllowed()).toBe(false);
    process.env.KATATALK_ALLOW_MOCK_ANALYSIS = "true";
    expect(isMockAnalysisAllowed()).toBe(true);
  });
});
