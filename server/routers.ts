import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";

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
      const subscription = await db.getUserSubscription(ctx.user.id);
      return subscription ?? {
        subscriptionTier: "free" as const,
        remainingAnalysisCount: 2,
        maxAnalysisCount: 3,
        subscriptionStartDate: null,
        preferredLanguage: "ko",
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
      const subscription = await db.getUserSubscription(ctx.user.id);
      const remaining = subscription?.remainingAnalysisCount ?? 0;
      return { canAnalyze: remaining > 0, remaining };
    }),

    /** Start a new analysis (decrements credit) */
    start: protectedProcedure
      .input(z.object({
        fileName: z.string().max(255),
        language: z.enum(["ko", "en", "zh", "ja"]).default("ko"),
      }))
      .mutation(async ({ ctx, input }) => {
        // Check remaining credits
        const canUse = await db.decrementAnalysisCount(ctx.user.id);
        if (!canUse) {
          throw new Error("분석 횟수가 소진되었습니다. 구독을 업그레이드해 주세요.");
        }

        // Create analysis record
        const analysisId = await db.createAnalysis({
          userId: ctx.user.id,
          fileName: input.fileName,
          language: input.language,
          status: "pending",
        });

        return { analysisId, success: true };
      }),

    /** Get user's analysis history */
    history: protectedProcedure.query(async ({ ctx }) => {
      return db.getUserAnalysisHistory(ctx.user.id);
    }),
  }),
});

export type AppRouter = typeof appRouter;
