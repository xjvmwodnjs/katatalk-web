import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import {
  AUTH_DEPENDENCY_UNAVAILABLE_CODE,
  AUTH_DEPENDENCY_UNAVAILABLE_MESSAGE,
} from "./authErrors";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireAuthAvailability = t.middleware(async opts => {
  if (opts.ctx.authError === AUTH_DEPENDENCY_UNAVAILABLE_CODE) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: AUTH_DEPENDENCY_UNAVAILABLE_MESSAGE,
    });
  }
  return opts.next();
});

export const authOptionalProcedure = t.procedure.use(requireAuthAvailability);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = authOptionalProcedure.use(requireUser);

export const adminProcedure = authOptionalProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
