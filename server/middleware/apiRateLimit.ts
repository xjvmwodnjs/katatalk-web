/**
 * API rate limiting (in-memory; 단일 인스턴스 기준).
 * 멀티 인스턴스·수평 확장 시 Redis/Upstash 등 외부 저장소 기반 limiter 필요.
 *
 * Vitest 기본: server/vitestSetup 에서 NODE_ENV=test + VITEST_RATE_LIMIT_OFF 로만 비활성화.
 * production 에서는 VITEST_RATE_LIMIT_OFF 가 있어도 rate limit 을 끄지 않는다.
 */
import rateLimit from "express-rate-limit";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { walletSubjectFromAuthUser } from "../creditService";

export const RATE_LIMIT_JSON = {
  success: false as const,
  code: "RATE_LIMITED" as const,
  message: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
};

/** 테스트 전용 bypass (NODE_ENV=test 일 때만) */
export function isRateLimitVitestBypassActive(): boolean {
  return process.env.NODE_ENV === "test" && process.env.VITEST_RATE_LIMIT_OFF === "true";
}

function rateLimitDisabled(): boolean {
  return isRateLimitVitestBypassActive();
}

function bypassWhenDisabled(mw: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (rateLimitDisabled()) {
      next();
      return;
    }
    mw(req, res, next);
  };
}

function ipKey(req: Request): string {
  return req.ip ?? "unknown";
}

function limitHandler(_req: Request, res: Response): void {
  res.status(429).json(RATE_LIMIT_JSON);
}

/** POST /api/analyze — IP당 1분 10회 */
export const analyzePostIpLimit = bypassWhenDisabled(
  rateLimit({
    windowMs: 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => `analyze-post-ip:${ipKey(req)}`,
    handler: limitHandler,
  })
);

/** POST /api/analyze — 사용자당 1분 5회 (인증 후) */
export const analyzePostUserLimit = bypassWhenDisabled(
  rateLimit({
    windowMs: 60_000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const u = req.katatalkUser;
      if (!u) return `analyze-post-user:anon:${ipKey(req)}`;
      return `analyze-post-user:${walletSubjectFromAuthUser(u)}`;
    },
    handler: limitHandler,
  })
);

/** GET /api/analyze/:jobId — 사용자당 1분 120회 */
export const analyzeGetUserLimit = bypassWhenDisabled(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const u = req.katatalkUser;
      if (!u) return `analyze-get:anon:${ipKey(req)}`;
      return `analyze-get:${walletSubjectFromAuthUser(u)}`;
    },
    handler: limitHandler,
  })
);

/** POST /api/billing/create-checkout — IP당 10분 20회 */
export const billingCheckoutIpLimit = bypassWhenDisabled(
  rateLimit({
    windowMs: 600_000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => `checkout-ip:${ipKey(req)}`,
    handler: limitHandler,
  })
);

/** POST /api/billing/create-checkout — 사용자당 10분 5회 */
export const billingCheckoutUserLimit = bypassWhenDisabled(
  rateLimit({
    windowMs: 600_000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const u = req.katatalkUser;
      if (!u) return `checkout-user:anon:${ipKey(req)}`;
      return `checkout-user:${walletSubjectFromAuthUser(u)}`;
    },
    handler: limitHandler,
  })
);

/** GET /api/credits/me — 사용자당 1분 60회 */
export const creditsMeUserLimit = bypassWhenDisabled(
  rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const u = req.katatalkUser;
      if (!u) return `credits-me:anon:${ipKey(req)}`;
      return `credits-me:${walletSubjectFromAuthUser(u)}`;
    },
    handler: limitHandler,
  })
);

/** GET /api/credits/logs — 사용자당 1분 30회 */
export const creditsLogsUserLimit = bypassWhenDisabled(
  rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const u = req.katatalkUser;
      if (!u) return `credits-logs:anon:${ipKey(req)}`;
      return `credits-logs:${walletSubjectFromAuthUser(u)}`;
    },
    handler: limitHandler,
  })
);
