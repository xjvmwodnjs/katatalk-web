import type { RequestHandler } from "express";

/**
 * Baseline headers that are safe for the Web service's current Clerk/Vite
 * integration. A Content-Security-Policy is intentionally not guessed here:
 * it needs a staged inventory of Clerk and payment-provider origins first.
 */
export function createBaselineSecurityHeaders(opts?: {
  isProduction?: boolean;
}): RequestHandler {
  const isProduction = opts?.isProduction === true;
  return (_req, res, next) => {
    res.removeHeader("X-Powered-By");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()"
    );
    if (isProduction) {
      // Do not include subdomains until their HTTPS inventory is verified.
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    }
    next();
  };
}
