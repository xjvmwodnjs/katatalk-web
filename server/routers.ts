import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import { getWalletBalance } from "./creditService";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── User Profile & Subscription ───
  profile: router({
    /** Get current user's subscription info */
    getSubscription: protectedProcedure.query(async ({ ctx }) => {
      const balance = await getWalletBalance(ctx.user);
      const row = await db.getUserSubscription(ctx.user.id);
      return {
        subscriptionTier: "free" as const,
        remainingAnalysisCount: balance,
        maxAnalysisCount: 999,
        subscriptionStartDate: null,
        preferredLanguage: row?.preferredLanguage ?? ctx.user.preferredLanguage ?? "ko",
        creditBalance: balance,
      };
    }),

    /** Update preferred language */
    updateLanguage: protectedProcedure
      .input(z.object({ language: z.enum(["ko", "en", "zh", "ja"]) }))
      .mutation(async ({ ctx, input }) => {
        await db.updatePreferredLanguage(ctx.user.id, input.language);
        return { success: true };
      }),
  }),

  // ─── Analysis ───
  analysis: router({
    /** Check if user can perform analysis (has remaining credits) */
    canAnalyze: protectedProcedure.query(async ({ ctx }) => {
      const remaining = await getWalletBalance(ctx.user);
      return { canAnalyze: remaining > 0, remaining };
    }),

    /** @deprecated 크레딧 차감·분석은 POST /api/analyze 만 사용한다. */
    start: protectedProcedure
      .input(z.object({
        fileName: z.string().max(255),
        language: z.enum(["ko", "en", "zh", "ja"]).default("ko"),
      }))
      .mutation(() => {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "기보 분석은 POST /api/analyze multipart 업로드로만 제공됩니다. (tRPC analysis.start 는 사용하지 않습니다.)",
        });
      }),

    /** Get user's analysis history */
    history: protectedProcedure.query(async ({ ctx }) => {
      return db.getUserAnalysisHistory(ctx.user.id);
    }),
  }),
});

export type AppRouter = typeof appRouter;
