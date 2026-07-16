// =============================================================
// GET /api/credits/me | /api/credits/logs — Clerk 인증 + Supabase
// =============================================================

import { Router, type Request, type Response } from "express";
import { SupabaseAdminUnavailableError } from "./_core/supabaseAdmin";
import { ensureProfileForClerkUser, getCreditLogs, walletSubjectFromAuthUser } from "./creditService";
import { ANALYZE_AUTH_REQUIRED_MESSAGE, requireAnalyzeAuth } from "./middleware/requireAnalyzeAuth";
import { creditsLogsUserLimit, creditsMeUserLimit } from "./middleware/apiRateLimit";

const creditsRouter = Router();

type PublicCreditLogRow = Pick<
  Awaited<ReturnType<typeof getCreditLogs>>[number],
  "amount" | "type" | "description" | "payment_provider" | "created_at"
>;

function toPublicCreditLogRow(log: Awaited<ReturnType<typeof getCreditLogs>>[number]): PublicCreditLogRow {
  return {
    amount: log.amount,
    type: log.type,
    description: log.description,
    payment_provider: log.payment_provider,
    created_at: log.created_at,
  };
}

function handleSupabaseCreditError(res: Response, e: unknown): void {
  if (e instanceof SupabaseAdminUnavailableError) {
    res.status(503).json({
      success: false,
      code: "SUPABASE_CREDIT_UNAVAILABLE",
      message: e.message,
    });
    return;
  }
  console.error("[credits]", e);
  res.status(500).json({
    success: false,
    message: "크레딧 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  });
}

creditsRouter.get("/api/credits/me", requireAnalyzeAuth, creditsMeUserLimit, (req: Request, res: Response) => {
  void (async () => {
    const user = req.katatalkUser;
    if (!user) {
      res.status(401).json({ success: false, message: ANALYZE_AUTH_REQUIRED_MESSAGE });
      return;
    }
    try {
      const r = await ensureProfileForClerkUser(user);
      res.json({
        credits: r.credits,
        userId: walletSubjectFromAuthUser(user),
      });
    } catch (e) {
      handleSupabaseCreditError(res, e);
    }
  })();
});

creditsRouter.get("/api/credits/logs", requireAnalyzeAuth, creditsLogsUserLimit, (req: Request, res: Response) => {
  void (async () => {
    const user = req.katatalkUser;
    if (!user) {
      res.status(401).json({ success: false, message: ANALYZE_AUTH_REQUIRED_MESSAGE });
      return;
    }
    try {
      await ensureProfileForClerkUser(user);
      const logs = await getCreditLogs(walletSubjectFromAuthUser(user), 20);
      res.json({ logs: logs.map(toPublicCreditLogRow) });
    } catch (e) {
      handleSupabaseCreditError(res, e);
    }
  })();
});

export { creditsRouter };
